#![no_std]
//! AEGIS On-Chain Authorization Contract (Deliverable 1).
//!
//! Principle: *agents create intents; governance decides settlement.*
//! The decision is produced and stored **on-chain**, so it cannot be written after the
//! payment by the very service that submitted that payment.

mod error;
mod types;

#[cfg(test)]
mod test;

pub use error::Error;
pub use types::*;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, String};

/// TTL for persistent entries. A decision must stay readable for the whole lifetime of
/// the evidence — if the entry is archived, the "readable from the contract ID alone"
/// claim breaks.
const BUMP_THRESHOLD: u32 = 518_400; // ~30 days
const BUMP_AMOUNT: u32 = 1_036_800; // ~60 days

#[contract]
pub struct AuthorizationContract;

#[contractimpl]
impl AuthorizationContract {
    pub fn init(env: Env, owner: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(Error::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&DataKey::Owner, &owner);
        Self::extend_instance(&env);
        Ok(())
    }

    // ---------- lifecycle, owner-gated ----------

    pub fn set_operator(env: Env, operator: Address) -> Result<(), Error> {
        Self::extend_instance(&env);
        Self::require_owner(&env)?;
        env.storage().instance().set(&DataKey::Operator, &operator);
        Ok(())
    }

    pub fn register_agent(env: Env, policy: Policy) -> Result<u32, Error> {
        Self::extend_instance(&env);
        Self::require_owner(&env)?;
        Self::put_policy(&env, policy)
    }

    /// Bump the version. Existing decisions keep their own `policy_version` (§6.3).
    pub fn set_policy(env: Env, mut policy: Policy) -> Result<u32, Error> {
        Self::extend_instance(&env);
        Self::require_owner(&env)?;
        let current = Self::policy_of(&env, &policy.agent)?;
        policy.version = current.version + 1;
        Self::put_policy(&env, policy)
    }

    pub fn revoke_agent(env: Env, agent: Address) -> Result<(), Error> {
        Self::extend_instance(&env);
        Self::require_owner(&env)?;
        let mut p = Self::policy_of(&env, &agent)?;
        p.status = AgentStatus::Revoked;
        // Written through the SAME path as every other policy write, so the TTL bump
        // cannot be forgotten here — README: "extend_ttl on every write to a persistent
        // entry". A revoked policy that is allowed to expire would silently un-revoke.
        Self::put_policy(&env, p)?;
        Ok(())
    }

    // ---------- main path ----------

    /// Evaluate an intent against the active policy version and STORE the decision on-chain.
    ///
    /// **Idempotent on `intent_hash`**: calling again returns the original decision, creates
    /// no new decision and raises no error (SOW §5.2 scenario 7 + §6.3). The "single-use"
    /// property lives at SETTLEMENT, guarded by the `settled` flag — see DECISIONS.md #1.
    ///
    /// `caller` must be the owner or the configured operator and must sign; `agent` must
    /// sign independently. `caller` is NOT part of `canonical_intent`, so it never enters
    /// `intent_hash`, `decision_id` or `memo_hash`.
    pub fn authorize(
        env: Env,
        caller: Address,
        intent_hash: BytesN<32>,
        agent: Address,
        service_id: String,
        asset: Address,
        amount: i128,
    ) -> Result<Decision, Error> {
        Self::extend_instance(&env);
        Self::require_caller(&env, &caller)?;
        // A SEPARATE property from the caller check above, deliberately not folded into it:
        // the agent authorizes its own spend. A leaked operator key therefore still cannot
        // impersonate another agent.
        agent.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // Idempotency: intent_hash already seen -> return the existing decision.
        if let Some(id) = env
            .storage()
            .persistent()
            .get::<_, BytesN<32>>(&DataKey::IntentIndex(intent_hash.clone()))
        {
            return Self::get_decision(env, id);
        }

        let policy = Self::policy_of(&env, &agent)?;
        let (mut verdict, mut reason) = Self::evaluate(&env, &policy, &service_id, &asset, amount);

        // Only charge the window when the verdict is actually Approved, and let the charge
        // itself veto (C-2). `evaluate` has already cleared `cumulative_window_cap`, so this
        // branch is unreachable from here — it exists so the cap is enforced where the budget
        // is SPENT, not only where it is judged, for every present and future call site.
        if verdict == Verdict::Approved && !Self::charge_window(&env, &policy, amount) {
            verdict = Verdict::Rejected;
            reason = ReasonCode::WindowCapExceeded;
        }

        let decision_id = Self::derive_decision_id(&env, &intent_hash, policy.version);
        let decision = Decision {
            decision_id: decision_id.clone(),
            intent_hash: intent_hash.clone(),
            agent: agent.clone(),
            service_id,
            asset,
            amount,
            policy_version: policy.version,
            // Never resolved yet — `resolve()` is the only writer of this field.
            resolved_policy_version: None,
            verdict,
            reason_code: reason,
            // Written ONCE, here. `resolve()` rewrites `reason_code` only, so the escalation
            // that produced this decision stays on the chain even after an approval.
            original_reason_code: reason,
            ledger_seq: env.ledger().sequence(),
            resolved: false,
            settled: false,
        };

        Self::put_decision(&env, &decision);
        env.storage()
            .persistent()
            .set(&DataKey::IntentIndex(intent_hash.clone()), &decision_id);
        Self::extend(&env, &DataKey::IntentIndex(intent_hash));

        DecisionEvent {
            agent,
            decision: decision.clone(),
        }
        .publish(&env);

        Ok(decision)
    }

    /// Human approver path. **owner-only** and **terminal** (§6.3).
    pub fn resolve(env: Env, decision_id: BytesN<32>, approve: bool) -> Result<Decision, Error> {
        Self::extend_instance(&env);
        Self::require_owner(&env)?;
        let mut d = Self::get_decision(env.clone(), decision_id)?;

        // Terminal: once resolved, never resolve again, whatever the current verdict is.
        if d.resolved {
            return Err(Error::AlreadyResolved);
        }
        if d.verdict != Verdict::RequiresApproval {
            return Err(Error::NotPendingApproval);
        }

        // Read once, before the branch, so BOTH paths can record which version was current
        // when the owner acted — that is what makes `resolved == resolved_policy_version
        // .is_some()` an invariant a reader can check.
        let policy = Self::policy_of(&env, &d.agent)?;
        d.resolved_policy_version = Some(policy.version);

        if approve {
            // C-2: RE-JUDGE under the policy that is current NOW. The decision froze its own
            // version at `authorize` time, but the owner is approving it today — a revocation
            // or a lowered cap in between must not be bypassable through the approval path
            // (SOW §5.2 scenario 6: "revocation takes effect immediately").
            let (verdict, reason) =
                Self::evaluate(&env, &policy, &d.service_id, &d.asset, d.amount);

            if verdict == Verdict::Rejected {
                // The current policy refuses it — record the refusal with the reason
                // `evaluate` produced rather than rubber-stamping an Approved.
                d.verdict = Verdict::Rejected;
                d.reason_code = reason;
            } else if Self::charge_window(&env, &policy, d.amount) {
                // `RequiresApproval` here means the intent still merely trips the approval
                // threshold — and THIS CALL is that approval, so it counts as a pass.
                d.verdict = Verdict::Approved;
                d.reason_code = ReasonCode::Ok;
            } else {
                d.verdict = Verdict::Rejected;
                d.reason_code = ReasonCode::WindowCapExceeded;
            }

            // `policy_version` deliberately KEEPS the version that produced this decision,
            // even though the re-judgement above ran against a possibly newer one.
            // `decision_id = sha256(tag || intent_hash || policy_version_be)` (DECISIONS.md #4)
            // and `memo_hash` both bind this field, so rewriting it would make `decision_id`
            // un-recomputable from public data and break §6.3 ("existing decisions keep their
            // own policy_version"). The version the re-judgement actually ran under is
            // recorded ALONGSIDE it, in `resolved_policy_version`, which no hash binds.
        } else {
            d.verdict = Verdict::Rejected;
            d.reason_code = ReasonCode::OwnerRejected;
        }
        // Only `reason_code` is ever rewritten here — `original_reason_code` keeps the code
        // `authorize()` recorded, so the escalation survives whichever way this goes.
        d.resolved = true;

        Self::put_decision(&env, &d);
        ResolvedEvent {
            agent: d.agent.clone(),
            decision: d.clone(),
        }
        .publish(&env);
        Ok(d)
    }

    /// Called by the executor right before submitting. Guards against double-settle.
    ///
    /// `caller` must be the owner or the configured operator, and must sign.
    pub fn mark_settled(
        env: Env,
        caller: Address,
        decision_id: BytesN<32>,
    ) -> Result<Decision, Error> {
        Self::extend_instance(&env);
        Self::require_caller(&env, &caller)?;
        let mut d = Self::get_decision(env.clone(), decision_id)?;
        if d.verdict != Verdict::Approved {
            return Err(Error::NotApproved);
        }
        if d.settled {
            return Err(Error::AlreadySettled);
        }
        // C-3: an approval granted BEFORE the owner revoked the agent must not still be
        // settleable afterwards — SOW §5.2 scenario 6 promises revocation takes effect
        // immediately, and settlement is the last on-chain gate before the money moves.
        if Self::policy_of(&env, &d.agent)?.status == AgentStatus::Revoked {
            return Err(Error::AgentRevoked);
        }
        d.settled = true;
        Self::put_decision(&env, &d);
        Ok(d)
    }

    // ---------- views: the console reads these DIRECTLY over RPC ----------

    pub fn get_decision(env: Env, decision_id: BytesN<32>) -> Result<Decision, Error> {
        Self::extend_instance(&env);
        env.storage()
            .persistent()
            .get(&DataKey::Decision(decision_id))
            .ok_or(Error::DecisionNotFound)
    }

    pub fn decision_by_intent(env: Env, intent_hash: BytesN<32>) -> Result<Decision, Error> {
        Self::extend_instance(&env);
        let id: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::IntentIndex(intent_hash))
            .ok_or(Error::DecisionNotFound)?;
        Self::get_decision(env, id)
    }

    /// EFFECTIVE window state (tumbling reset already applied).
    pub fn get_window(env: Env, agent: Address) -> Result<WindowState, Error> {
        Self::extend_instance(&env);
        let policy = Self::policy_of(&env, &agent)?;
        let now = env.ledger().timestamp();
        let key = DataKey::Window(agent);
        Ok(
            match env.storage().persistent().get::<_, WindowState>(&key) {
                Some(w) if now < w.window_start + policy.window_seconds => w,
                _ => WindowState {
                    window_start: now,
                    spent: 0,
                },
            },
        )
    }

    pub fn get_policy(env: Env, agent: Address) -> Result<Policy, Error> {
        Self::extend_instance(&env);
        Self::policy_of(&env, &agent)
    }

    /// `sha256(intent_hash || policy_version_be || decision_id)` computed ON CHAIN.
    /// The verifier compares this against the transaction's real MEMO_HASH.
    pub fn memo_hash(env: Env, decision_id: BytesN<32>) -> Result<BytesN<32>, Error> {
        Self::extend_instance(&env);
        let d = Self::get_decision(env.clone(), decision_id)?;
        let mut pre = Bytes::new(&env);
        pre.append(&Bytes::from_slice(&env, &d.intent_hash.to_array()));
        pre.append(&Bytes::from_slice(&env, &d.policy_version.to_be_bytes()));
        pre.append(&Bytes::from_slice(&env, &d.decision_id.to_array()));
        Ok(env.crypto().sha256(&pre).into())
    }

    // ---------- internals ----------

    fn evaluate(
        env: &Env,
        policy: &Policy,
        service_id: &String,
        asset: &Address,
        amount: i128,
    ) -> (Verdict, ReasonCode) {
        if policy.status == AgentStatus::Revoked {
            return (Verdict::Rejected, ReasonCode::AgentRevoked);
        }
        if !policy.allowed_services.contains(service_id) {
            return (Verdict::Rejected, ReasonCode::ServiceNotAllowed);
        }
        if asset != &policy.allowed_asset {
            return (Verdict::Rejected, ReasonCode::AssetMismatch);
        }
        if amount > policy.per_intent_cap {
            return (Verdict::Rejected, ReasonCode::CapExceeded);
        }
        if Self::window_spent(env, policy) + amount > policy.cumulative_window_cap {
            return (Verdict::Rejected, ReasonCode::WindowCapExceeded);
        }
        if amount > policy.approval_threshold {
            return (Verdict::RequiresApproval, ReasonCode::PendingApproval);
        }
        (Verdict::Approved, ReasonCode::Ok)
    }

    /// Tumbling window: entering a new epoch means spent = 0. No history is walked.
    fn window_spent(env: &Env, policy: &Policy) -> i128 {
        let now = env.ledger().timestamp();
        match env
            .storage()
            .persistent()
            .get::<_, WindowState>(&DataKey::Window(policy.agent.clone()))
        {
            Some(w) if now < w.window_start + policy.window_seconds => w.spent,
            _ => 0,
        }
    }

    /// Adds `amount` to the agent's tumbling window.
    ///
    /// Returns `false` and writes NOTHING when the charge would push the agent past
    /// `cumulative_window_cap` (C-2). Enforcing the cap here — and not only in
    /// `evaluate` — means the budget cannot be overspent by any path that reaches the
    /// spend without re-judging first.
    fn charge_window(env: &Env, policy: &Policy, amount: i128) -> bool {
        let now = env.ledger().timestamp();
        let key = DataKey::Window(policy.agent.clone());
        let current = env.storage().persistent().get::<_, WindowState>(&key);
        let (window_start, spent) = match current {
            Some(w) if now < w.window_start + policy.window_seconds => (w.window_start, w.spent),
            _ => (now, 0),
        };
        let next_spent = spent + amount;
        if next_spent > policy.cumulative_window_cap {
            return false;
        }
        env.storage().persistent().set(
            &key,
            &WindowState {
                window_start,
                spent: next_spent,
            },
        );
        Self::extend(env, &key);
        true
    }

    fn derive_decision_id(env: &Env, intent_hash: &BytesN<32>, version: u32) -> BytesN<32> {
        let mut pre = Bytes::new(env);
        pre.append(&Bytes::from_slice(env, b"AEGIS-DECISION-v1"));
        pre.append(&Bytes::from_slice(env, &intent_hash.to_array()));
        pre.append(&Bytes::from_slice(env, &version.to_be_bytes()));
        env.crypto().sha256(&pre).into()
    }

    fn put_policy(env: &Env, policy: Policy) -> Result<u32, Error> {
        let version = policy.version;
        let key = DataKey::Policy(policy.agent.clone());
        env.storage().persistent().set(&key, &policy);
        Self::extend(env, &key);
        Ok(version)
    }

    fn policy_of(env: &Env, agent: &Address) -> Result<Policy, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Policy(agent.clone()))
            .ok_or(Error::AgentNotRegistered)
    }

    fn put_decision(env: &Env, d: &Decision) {
        let key = DataKey::Decision(d.decision_id.clone());
        env.storage().persistent().set(&key, d);
        Self::extend(env, &key);
    }

    /// Instance storage holds `Owner` and `Operator`. If the instance entry is archived
    /// EVERY entry point fails, which destroys the "readable from the contract ID alone"
    /// claim — so it is bumped on every entry point, reads included, not only on writes.
    fn extend_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    fn extend(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, BUMP_THRESHOLD, BUMP_AMOUNT);
    }

    fn owner(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(Error::NotInitialized)
    }

    fn require_owner(env: &Env) -> Result<(), Error> {
        Self::owner(env)?.require_auth();
        Ok(())
    }

    /// The delegated caller for `authorize` / `mark_settled`: the **owner OR the operator**
    /// when one is configured. Neither can change policy through these entry points.
    ///
    /// This is a genuine disjunction, and it is what the `caller: Address` parameter buys.
    /// `Address::require_auth` **traps** rather than returning a bool, and soroban-sdk 27
    /// exposes no "did X sign?" predicate, so "try the owner, then the operator" is not
    /// available — the first miss aborts the whole invocation. The contract must therefore
    /// name exactly ONE address before any authorization runs. Taking that address from the
    /// invocation makes the disjunction a plain equality check *after* the auth:
    ///
    /// 1. `caller.require_auth()` — proves whoever is named actually signed. A third party
    ///    who passes the owner's address here cannot produce the owner's signature, so this
    ///    line traps before any membership check is reached.
    /// 2. compare against owner / operator — a signature from some *other* real account is
    ///    a valid signature, just not a permitted one, and is refused with
    ///    `NotAuthorizedCaller`.
    ///
    /// Before `caller` existed this resolved to operator-if-set-else-owner, which locked the
    /// owner out of both entry points as soon as an operator was configured.
    fn require_caller(env: &Env, caller: &Address) -> Result<(), Error> {
        caller.require_auth();

        if caller == &Self::owner(env)? {
            return Ok(());
        }
        match env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Operator)
        {
            Some(op) if &op == caller => Ok(()),
            _ => Err(Error::NotAuthorizedCaller),
        }
    }
}
