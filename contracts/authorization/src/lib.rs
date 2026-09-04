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
        Ok(())
    }

    // ---------- lifecycle, owner-gated ----------

    pub fn set_operator(env: Env, operator: Address) -> Result<(), Error> {
        Self::require_owner(&env)?;
        env.storage().instance().set(&DataKey::Operator, &operator);
        Ok(())
    }

    pub fn register_agent(env: Env, policy: Policy) -> Result<u32, Error> {
        Self::require_owner(&env)?;
        Self::put_policy(&env, policy)
    }

    /// Bump the version. Existing decisions keep their own `policy_version` (§6.3).
    pub fn set_policy(env: Env, mut policy: Policy) -> Result<u32, Error> {
        Self::require_owner(&env)?;
        let current = Self::policy_of(&env, &policy.agent)?;
        policy.version = current.version + 1;
        Self::put_policy(&env, policy)
    }

    pub fn revoke_agent(env: Env, agent: Address) -> Result<(), Error> {
        Self::require_owner(&env)?;
        let mut p = Self::policy_of(&env, &agent)?;
        p.status = AgentStatus::Revoked;
        env.storage().persistent().set(&DataKey::Policy(agent), &p);
        Ok(())
    }

    // ---------- main path ----------

    /// Evaluate an intent against the active policy version and STORE the decision on-chain.
    ///
    /// **Idempotent on `intent_hash`**: calling again returns the original decision, creates
    /// no new decision and raises no error (SOW §5.2 scenario 7 + §6.3). The "single-use"
    /// property lives at SETTLEMENT, guarded by the `settled` flag — see DECISIONS.md #1.
    pub fn authorize(
        env: Env,
        intent_hash: BytesN<32>,
        agent: Address,
        service_id: String,
        asset: Address,
        amount: i128,
    ) -> Result<Decision, Error> {
        Self::require_caller(&env)?;
        // The agent signs for itself: a leaked operator key still cannot impersonate
        // another agent.
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
        let (verdict, reason) = Self::evaluate(&env, &policy, &service_id, &asset, amount);

        let decision_id = Self::derive_decision_id(&env, &intent_hash, policy.version);
        let decision = Decision {
            decision_id: decision_id.clone(),
            intent_hash: intent_hash.clone(),
            agent: agent.clone(),
            service_id,
            asset,
            amount,
            policy_version: policy.version,
            verdict,
            reason_code: reason,
            ledger_seq: env.ledger().sequence(),
            resolved: false,
            settled: false,
        };

        // Only charge the window when the verdict is actually Approved.
        if verdict == Verdict::Approved {
            Self::charge_window(&env, &policy, amount);
        }

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
        Self::require_owner(&env)?;
        let mut d = Self::get_decision(env.clone(), decision_id)?;

        // Terminal: once resolved, never resolve again, whatever the current verdict is.
        if d.resolved {
            return Err(Error::AlreadyResolved);
        }
        if d.verdict != Verdict::RequiresApproval {
            return Err(Error::NotPendingApproval);
        }

        if approve {
            let policy = Self::policy_of(&env, &d.agent)?;
            Self::charge_window(&env, &policy, d.amount);
            d.verdict = Verdict::Approved;
            d.reason_code = ReasonCode::Ok;
        } else {
            d.verdict = Verdict::Rejected;
            d.reason_code = ReasonCode::OwnerRejected;
        }
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
    pub fn mark_settled(env: Env, decision_id: BytesN<32>) -> Result<Decision, Error> {
        Self::require_caller(&env)?;
        let mut d = Self::get_decision(env.clone(), decision_id)?;
        if d.verdict != Verdict::Approved {
            return Err(Error::NotApproved);
        }
        if d.settled {
            return Err(Error::AlreadySettled);
        }
        d.settled = true;
        Self::put_decision(&env, &d);
        Ok(d)
    }

    // ---------- views: the console reads these DIRECTLY over RPC ----------

    pub fn get_decision(env: Env, decision_id: BytesN<32>) -> Result<Decision, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Decision(decision_id))
            .ok_or(Error::DecisionNotFound)
    }

    pub fn decision_by_intent(env: Env, intent_hash: BytesN<32>) -> Result<Decision, Error> {
        let id: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::IntentIndex(intent_hash))
            .ok_or(Error::DecisionNotFound)?;
        Self::get_decision(env, id)
    }

    /// EFFECTIVE window state (tumbling reset already applied).
    pub fn get_window(env: Env, agent: Address) -> Result<WindowState, Error> {
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
        Self::policy_of(&env, &agent)
    }

    /// `sha256(intent_hash || policy_version_be || decision_id)` computed ON CHAIN.
    /// The verifier compares this against the transaction's real MEMO_HASH.
    pub fn memo_hash(env: Env, decision_id: BytesN<32>) -> Result<BytesN<32>, Error> {
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

    fn charge_window(env: &Env, policy: &Policy, amount: i128) {
        let now = env.ledger().timestamp();
        let key = DataKey::Window(policy.agent.clone());
        let current = env.storage().persistent().get::<_, WindowState>(&key);
        let next = match current {
            Some(w) if now < w.window_start + policy.window_seconds => WindowState {
                window_start: w.window_start,
                spent: w.spent + amount,
            },
            _ => WindowState {
                window_start: now,
                spent: amount,
            },
        };
        env.storage().persistent().set(&key, &next);
        Self::extend(env, &key);
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

    /// owner OR operator. The operator can call `authorize` but cannot change policy.
    fn require_caller(env: &Env) -> Result<(), Error> {
        match env
            .storage()
            .instance()
            .get::<_, Address>(&DataKey::Operator)
        {
            Some(op) => {
                op.require_auth();
                Ok(())
            }
            None => Self::require_owner(env),
        }
    }
}
