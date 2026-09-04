//! Test suite for the 7 scenarios in SOW §5.2 plus the adversarial suite (D1).
//!
//! Note: `mock_all_auths()` is used ONLY for the happy path. The access-control tests
//! deliberately do NOT mock — that is where the tests earn their keep.

use super::*;
use soroban_sdk::{
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    vec, Address, BytesN, Env, IntoVal, String, Val, Vec as SVec,
};

/// 1 asset unit = 10^7 stroops (Stellar uses 7 decimal places)
const UNIT: i128 = 10_000_000;
const CAP: i128 = 1_000 * UNIT;
const WINDOW_CAP: i128 = 5_000 * UNIT;
const THRESHOLD: i128 = 100 * UNIT;
const WINDOW_SECS: u64 = 86_400;

struct Fixture {
    env: Env,
    client: AuthorizationContractClient<'static>,
    owner: Address,
    operator: Address,
    agent: Address,
    usdc: Address,
    other_asset: Address,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();

    let id = env.register(AuthorizationContract, ());
    let client = AuthorizationContractClient::new(&env, &id);

    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let agent = Address::generate(&env);
    let usdc = Address::generate(&env);
    let other_asset = Address::generate(&env);

    client.init(&owner);
    client.set_operator(&operator);
    client.register_agent(&Policy {
        version: 1,
        owner: owner.clone(),
        agent: agent.clone(),
        allowed_services: vec![&env, String::from_str(&env, "svc-api")],
        allowed_asset: usdc.clone(),
        per_intent_cap: CAP,
        cumulative_window_cap: WINDOW_CAP,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    Fixture {
        env,
        client,
        owner,
        operator,
        agent,
        usdc,
        other_asset,
    }
}

fn hash(env: &Env, seed: u8) -> BytesN<32> {
    BytesN::from_array(env, &[seed; 32])
}

fn svc(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ---------- the 7 scenarios from §5.2 ----------

#[test]
fn scenario_1_compliant_intent_is_approved() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 1),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(50 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::Approved);
    assert_eq!(d.reason_code, ReasonCode::Ok);
    assert_eq!(d.policy_version, 1);
    assert!(!d.settled);
}

#[test]
fn scenario_2_exceeds_per_intent_cap() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 2),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(CAP + 1),
    );
    assert_eq!(d.verdict, Verdict::Rejected);
    assert_eq!(d.reason_code, ReasonCode::CapExceeded);
}

#[test]
fn scenario_3_service_not_in_whitelist() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 3),
        &f.agent,
        &svc(&f.env, "svc-unknown"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::Rejected);
    assert_eq!(d.reason_code, ReasonCode::ServiceNotAllowed);
}

#[test]
fn scenario_4_asset_mismatches_policy() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 4),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.other_asset,
        &(10 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::Rejected);
    assert_eq!(d.reason_code, ReasonCode::AssetMismatch);
}

#[test]
fn scenario_5_above_threshold_below_cap_escalates_then_owner_resolves() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 5),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    assert_eq!(d.verdict, Verdict::RequiresApproval);
    assert_eq!(d.reason_code, ReasonCode::PendingApproval);

    let resolved = f.client.resolve(&d.decision_id, &true);
    assert_eq!(resolved.verdict, Verdict::Approved);
    assert_eq!(resolved.reason_code, ReasonCode::Ok);
}

#[test]
fn scenario_6_revoked_agent_is_rejected() {
    let f = setup();
    f.client.revoke_agent(&f.agent);
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 6),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::Rejected);
    assert_eq!(d.reason_code, ReasonCode::AgentRevoked);
}

#[test]
fn scenario_7_replay_returns_original_decision() {
    let f = setup();
    let h = hash(&f.env, 7);
    let first = f.client.authorize(
        &f.owner,
        &h,
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    let again = f.client.authorize(
        &f.owner,
        &h,
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );

    assert_eq!(
        first.decision_id, again.decision_id,
        "replay must return the original decision"
    );
    assert_eq!(
        first.ledger_seq, again.ledger_seq,
        "no new decision may be created"
    );
}

// ---------- adversarial suite ----------

#[test]
fn replay_does_not_increase_window_spend() {
    let f = setup();
    let h = hash(&f.env, 20);
    let amount = 10 * UNIT;

    f.client.authorize(
        &f.owner,
        &h,
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &amount,
    );
    let after_first = f.client.get_window(&f.agent).spent;
    assert_eq!(after_first, amount);

    for _ in 0..5 {
        f.client.authorize(
            &f.owner,
            &h,
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &amount,
        );
    }
    assert_eq!(
        f.client.get_window(&f.agent).spent,
        amount,
        "a replay must NOT recharge the window — otherwise network retries erode the budget"
    );
}

#[test]
fn rejected_decision_does_not_count_toward_window() {
    let f = setup();
    f.client.authorize(
        &f.owner,
        &hash(&f.env, 22),
        &f.agent,
        &svc(&f.env, "svc-unknown"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(f.client.get_window(&f.agent).spent, 0);
}

#[test]
fn requires_approval_counts_toward_window_only_when_owner_approves() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 23),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    assert_eq!(
        f.client.get_window(&f.agent).spent,
        0,
        "pending approval means nothing is spent yet"
    );

    f.client.resolve(&d.decision_id, &true);
    assert_eq!(f.client.get_window(&f.agent).spent, THRESHOLD + 1);
}

#[test]
fn owner_rejection_does_not_count_toward_window() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 24),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    let r = f.client.resolve(&d.decision_id, &false);
    assert_eq!(r.verdict, Verdict::Rejected);
    assert_eq!(r.reason_code, ReasonCode::OwnerRejected);
    assert_eq!(f.client.get_window(&f.agent).spent, 0);
}

#[test]
fn double_resolve_after_rejection_also_fails() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 25),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    f.client.resolve(&d.decision_id, &false);
    assert_eq!(
        f.client.try_resolve(&d.decision_id, &true),
        Err(Ok(Error::AlreadyResolved)),
        "terminal in both directions, not just the approve direction"
    );
}

#[test]
fn cumulative_window_boundary() {
    let f = setup();
    // fill the window with sub-threshold intents
    let each = THRESHOLD;
    let n = (WINDOW_CAP / each) as u8;
    for i in 0..n {
        let d = f.client.authorize(
            &f.owner,
            &hash(&f.env, 100 + i),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &each,
        );
        assert_eq!(d.verdict, Verdict::Approved, "intent {i} must be approved");
    }
    let over = f.client.authorize(
        &f.owner,
        &hash(&f.env, 200),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &each,
    );
    assert_eq!(over.reason_code, ReasonCode::WindowCapExceeded);
}

#[test]
fn window_resets_in_new_epoch() {
    let f = setup();
    let each = THRESHOLD;
    let n = (WINDOW_CAP / each) as u8;
    for i in 0..n {
        f.client.authorize(
            &f.owner,
            &hash(&f.env, 100 + i),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &each,
        );
    }
    f.env.ledger().with_mut(|l| l.timestamp += WINDOW_SECS + 1);
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 201),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &each,
    );
    assert_eq!(
        d.verdict,
        Verdict::Approved,
        "a tumbling window must reset in a new epoch"
    );
}

#[test]
fn double_resolve_fails() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 30),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    f.client.resolve(&d.decision_id, &true);
    assert_eq!(
        f.client.try_resolve(&d.decision_id, &true),
        Err(Ok(Error::AlreadyResolved)),
        "resolve must be terminal"
    );
}

#[test]
fn resolve_on_non_pending_decision_fails() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 31),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(
        f.client.try_resolve(&d.decision_id, &true),
        Err(Ok(Error::NotPendingApproval))
    );
}

#[test]
fn double_settle_fails() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 40),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    f.client.mark_settled(&f.owner, &d.decision_id);
    assert_eq!(
        f.client.try_mark_settled(&f.owner, &d.decision_id),
        Err(Ok(Error::AlreadySettled)),
        "settlement is the single-use step"
    );
}

#[test]
fn cannot_settle_decision_that_is_not_approved() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 41),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(CAP + 1),
    );
    assert_eq!(
        f.client.try_mark_settled(&f.owner, &d.decision_id),
        Err(Ok(Error::NotApproved))
    );
}

#[test]
fn set_policy_bumps_version_and_leaves_existing_decisions_untouched() {
    let f = setup();
    let old = f.client.authorize(
        &f.owner,
        &hash(&f.env, 50),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(old.policy_version, 1);

    f.client.set_policy(&Policy {
        version: 0, // ignored, the contract bumps it itself
        owner: f.owner.clone(),
        agent: f.agent.clone(),
        allowed_services: vec![&f.env, svc(&f.env, "svc-api")],
        allowed_asset: f.usdc.clone(),
        per_intent_cap: CAP,
        cumulative_window_cap: WINDOW_CAP,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    let new = f.client.authorize(
        &f.owner,
        &hash(&f.env, 51),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(new.policy_version, 2);

    let reread = f.client.get_decision(&old.decision_id);
    assert_eq!(
        reread.policy_version, 1,
        "an existing decision must keep its policy_version"
    );
}

#[test]
fn on_chain_memo_hash_matches_sow_formula() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 60),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    let on_chain = f.client.memo_hash(&d.decision_id);

    // sha256(intent_hash || policy_version_be || decision_id)
    let mut pre = Bytes::new(&f.env);
    pre.append(&Bytes::from_slice(&f.env, &d.intent_hash.to_array()));
    pre.append(&Bytes::from_slice(&f.env, &d.policy_version.to_be_bytes()));
    pre.append(&Bytes::from_slice(&f.env, &d.decision_id.to_array()));
    let expected: BytesN<32> = f.env.crypto().sha256(&pre).into();

    assert_eq!(on_chain, expected);
}

#[test]
fn decision_is_readable_by_intent_hash() {
    let f = setup();
    let h = hash(&f.env, 70);
    let d = f.client.authorize(
        &f.owner,
        &h,
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(f.client.decision_by_intent(&h).decision_id, d.decision_id);
}

#[test]
fn unregistered_agent_is_rejected() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(
        f.client.try_authorize(
            &f.owner,
            &hash(&f.env, 80),
            &stranger,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &(10 * UNIT)
        ),
        Err(Ok(Error::AgentNotRegistered))
    );
}

#[test]
fn non_positive_amount_is_rejected() {
    let f = setup();
    assert_eq!(
        f.client.try_authorize(
            &f.owner,
            &hash(&f.env, 81),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &0
        ),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn double_init_fails() {
    let f = setup();
    assert_eq!(
        f.client.try_init(&f.owner),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ---------- access control: NO auth mocking ----------

#[test]
#[should_panic(expected = "Unauthorized")]
fn non_owner_cannot_set_operator() {
    let env = Env::default();
    let id = env.register(AuthorizationContract, ());
    let client = AuthorizationContractClient::new(&env, &id);

    let owner = Address::generate(&env);
    env.mock_all_auths();
    client.init(&owner);

    // From here on NO mocking: the owner's require_auth must fail.
    env.set_auths(&[]);
    client.set_operator(&Address::generate(&env));
}

#[test]
fn operator_can_call_authorize() {
    let f = setup();
    let h = hash(&f.env, 90);
    let service = svc(&f.env, "svc-api");
    let amount = 10 * UNIT;
    let contract = f.client.address.clone();
    let args: SVec<Val> = (
        f.operator.clone(),
        h.clone(),
        f.agent.clone(),
        service.clone(),
        f.usdc.clone(),
        amount,
    )
        .into_val(&f.env);

    // Owner is NOT mocked: only the operator + agent sign.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[
        MockAuth {
            address: &f.operator,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &f.agent,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
    ]);

    let d = f
        .client
        .authorize(&f.operator, &h, &f.agent, &service, &f.usdc, &amount);
    assert_eq!(
        d.verdict,
        Verdict::Approved,
        "the operator must be able to call authorize"
    );
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn operator_cannot_revoke_agent() {
    let f = setup();
    let contract = f.client.address.clone();
    let args: SVec<Val> = (f.agent.clone(),).into_val(&f.env);

    // Only the operator signs — revoke_agent requires the owner.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.operator,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "revoke_agent",
            args,
            sub_invokes: &[],
        },
    }]);

    f.client.revoke_agent(&f.agent);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn operator_cannot_change_policy() {
    let f = setup();
    let contract = f.client.address.clone();
    let policy = Policy {
        version: 0,
        owner: f.owner.clone(),
        agent: f.agent.clone(),
        allowed_services: vec![&f.env, svc(&f.env, "svc-anything")],
        allowed_asset: f.usdc.clone(),
        per_intent_cap: CAP * 1000,
        cumulative_window_cap: WINDOW_CAP * 1000,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    };
    let args: SVec<Val> = (policy.clone(),).into_val(&f.env);

    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.operator,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "set_policy",
            args,
            sub_invokes: &[],
        },
    }]);

    f.client.set_policy(&policy);
}

// ---------- C-2: resolve() re-judges under the CURRENT policy ----------

#[test]
fn resolve_refuses_to_approve_a_revoked_agent() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 120),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(500 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::RequiresApproval);

    f.client.revoke_agent(&f.agent);
    let r = f.client.resolve(&d.decision_id, &true);

    assert_eq!(
        r.verdict,
        Verdict::Rejected,
        "the approval path must not outrank a revocation (SOW §5.2 scenario 6)"
    );
    assert_eq!(r.reason_code, ReasonCode::AgentRevoked);
    assert!(r.resolved, "the attempt is still terminal");
    assert_eq!(f.client.get_window(&f.agent).spent, 0);
}

#[test]
fn resolve_re_evaluates_against_the_newer_policy() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 121),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(500 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::RequiresApproval);

    // The owner tightens the policy while the decision is still pending.
    f.client.set_policy(&Policy {
        version: 0,
        owner: f.owner.clone(),
        agent: f.agent.clone(),
        allowed_services: vec![&f.env, svc(&f.env, "svc-api")],
        allowed_asset: f.usdc.clone(),
        per_intent_cap: UNIT,
        cumulative_window_cap: UNIT,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    let r = f.client.resolve(&d.decision_id, &true);
    assert_eq!(
        r.verdict,
        Verdict::Rejected,
        "approving a stale decision must not spend against a cap that no longer allows it"
    );
    assert_eq!(r.reason_code, ReasonCode::CapExceeded);
    assert_eq!(
        f.client.get_window(&f.agent).spent,
        0,
        "nothing may be charged for a decision the current policy rejects"
    );
}

#[test]
fn resolve_cannot_push_the_window_past_its_cap() {
    let f = setup();
    let pending = f.client.authorize(
        &f.owner,
        &hash(&f.env, 122),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    assert_eq!(pending.verdict, Verdict::RequiresApproval);

    // Fill the window to the brim with ordinary approved intents while it sits pending.
    let each = THRESHOLD;
    let n = (WINDOW_CAP / each) as u8;
    for i in 0..n {
        f.client.authorize(
            &f.owner,
            &hash(&f.env, 130 + i),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &each,
        );
    }
    assert_eq!(f.client.get_window(&f.agent).spent, WINDOW_CAP);

    let r = f.client.resolve(&pending.decision_id, &true);
    assert_eq!(r.verdict, Verdict::Rejected);
    assert_eq!(r.reason_code, ReasonCode::WindowCapExceeded);
    assert_eq!(
        f.client.get_window(&f.agent).spent,
        WINDOW_CAP,
        "the window cap is a hard ceiling — resolve() is not a way around it"
    );
}

#[test]
fn resolved_decision_keeps_the_policy_version_that_named_it() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 123),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(500 * UNIT),
    );
    assert_eq!(d.policy_version, 1);

    // A new version that still permits the intent, so the approval goes through.
    f.client.set_policy(&Policy {
        version: 0,
        owner: f.owner.clone(),
        agent: f.agent.clone(),
        allowed_services: vec![&f.env, svc(&f.env, "svc-api")],
        allowed_asset: f.usdc.clone(),
        per_intent_cap: CAP,
        cumulative_window_cap: WINDOW_CAP,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    let r = f.client.resolve(&d.decision_id, &true);
    assert_eq!(r.verdict, Verdict::Approved);
    assert_eq!(
        r.policy_version, 1,
        "the decision keeps the version that produced its decision_id (§6.3, DECISIONS.md #4) \
         even though the re-judgement ran against v2"
    );

    // The whole point of holding the field still: decision_id and memo_hash stay
    // recomputable from public data.
    let mut pre = Bytes::new(&f.env);
    pre.append(&Bytes::from_slice(&f.env, &r.intent_hash.to_array()));
    pre.append(&Bytes::from_slice(&f.env, &r.policy_version.to_be_bytes()));
    pre.append(&Bytes::from_slice(&f.env, &r.decision_id.to_array()));
    let expected: BytesN<32> = f.env.crypto().sha256(&pre).into();
    assert_eq!(f.client.memo_hash(&r.decision_id), expected);
}

// ---------- C-3: settlement re-reads the policy ----------

#[test]
fn settlement_is_refused_after_the_agent_is_revoked() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 140),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(d.verdict, Verdict::Approved);

    f.client.revoke_agent(&f.agent);

    assert_eq!(
        f.client.try_mark_settled(&f.owner, &d.decision_id),
        Err(Ok(Error::AgentRevoked)),
        "SOW §5.2 scenario 6 promises revocation is immediate — an approval granted \
         before it must not still pay out"
    );
    assert!(
        !f.client.get_decision(&d.decision_id).settled,
        "a refused settlement must leave the flag untouched"
    );
}

// ---------- C-5: TTL is actually extended ----------

#[test]
fn every_entry_point_bumps_the_instance_ttl() {
    let f = setup();
    let id = f.client.address.clone();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 150),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );

    // Age the ledger until the instance entry (Owner + Operator) is near archival.
    f.env
        .ledger()
        .with_mut(|l| l.sequence_number += BUMP_AMOUNT - 1_000);
    let before = f
        .env
        .as_contract(&id, || f.env.storage().instance().get_ttl());
    assert!(
        before < BUMP_THRESHOLD,
        "the entry must really be near archival, otherwise this test proves nothing"
    );

    // A pure VIEW has to bump it too: a decision that is only ever read must stay
    // readable from the contract ID alone.
    f.client.get_decision(&d.decision_id);
    let after = f
        .env
        .as_contract(&id, || f.env.storage().instance().get_ttl());
    assert!(
        after >= BUMP_AMOUNT,
        "instance TTL must be extended on every entry point (was {before}, now {after})"
    );
}

#[test]
fn revoke_agent_bumps_the_policy_ttl() {
    let f = setup();
    let id = f.client.address.clone();
    let key = DataKey::Policy(f.agent.clone());

    f.env
        .ledger()
        .with_mut(|l| l.sequence_number += BUMP_AMOUNT - 1_000);
    let before = f
        .env
        .as_contract(&id, || f.env.storage().persistent().get_ttl(&key));

    f.client.revoke_agent(&f.agent);

    let after = f
        .env
        .as_contract(&id, || f.env.storage().persistent().get_ttl(&key));
    assert!(
        after >= BUMP_AMOUNT && after > before,
        "revoke_agent writes a policy like any other write, so it must extend it too \
         (was {before}, now {after}) — an expired revocation would silently un-revoke"
    );
}

// ---------- access control the suite was claiming but not testing ----------

#[test]
#[should_panic(expected = "Unauthorized")]
fn operator_alone_cannot_authorize_for_an_agent_that_did_not_sign() {
    let f = setup();
    let h = hash(&f.env, 160);
    let service = svc(&f.env, "svc-api");
    let amount = 10 * UNIT;
    let contract = f.client.address.clone();
    let args: SVec<Val> = (
        f.operator.clone(),
        h.clone(),
        f.agent.clone(),
        service.clone(),
        f.usdc.clone(),
        amount,
    )
        .into_val(&f.env);

    // ONLY the caller signs — the agent does not. This is the test behind the headline
    // claim in lib.rs: `agent.require_auth()` is a SEPARATE property from the caller
    // check, so a leaked operator key still cannot impersonate another agent.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.operator,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "authorize",
            args,
            sub_invokes: &[],
        },
    }]);

    f.client
        .authorize(&f.operator, &h, &f.agent, &service, &f.usdc, &amount);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn non_owner_cannot_resolve() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 161),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    let contract = f.client.address.clone();
    let args: SVec<Val> = (d.decision_id.clone(), true).into_val(&f.env);

    // The operator is the strongest non-owner principal there is; §6.3 makes resolve()
    // owner-only, so even it must be turned away.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.operator,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "resolve",
            args,
            sub_invokes: &[],
        },
    }]);

    f.client.resolve(&d.decision_id, &true);
}

#[test]
fn stranger_cannot_mark_settled() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 162),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    let stranger = Address::generate(&f.env);
    let contract = f.client.address.clone();
    let args: SVec<Val> = (stranger.clone(), d.decision_id.clone()).into_val(&f.env);

    // The stranger signs for ITSELF, so `caller.require_auth()` is satisfied — the refusal
    // has to come from the membership check, which returns `NotAuthorizedCaller`.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "mark_settled",
            args,
            sub_invokes: &[],
        },
    }]);

    assert_eq!(
        f.client.try_mark_settled(&stranger, &d.decision_id),
        Err(Ok(Error::NotAuthorizedCaller))
    );
}

#[test]
fn replay_of_a_settled_intent_hash_returns_the_original_decision() {
    let f = setup();
    let h = hash(&f.env, 163);
    let amount = 10 * UNIT;
    let first = f.client.authorize(
        &f.owner,
        &h,
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &amount,
    );
    f.client.mark_settled(&f.owner, &first.decision_id);

    // §5.2 scenario 7 verbatim: "Original decision returned, no second payment."
    let again = f.client.authorize(
        &f.owner,
        &h,
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &amount,
    );

    assert_eq!(again.decision_id, first.decision_id);
    assert!(
        again.settled,
        "the replay must surface the settled flag, or the executor cannot tell it already paid"
    );
    assert_eq!(
        f.client.get_window(&f.agent).spent,
        amount,
        "replaying a SETTLED intent must not recharge the window either"
    );
    assert_eq!(
        f.client.try_mark_settled(&f.owner, &again.decision_id),
        Err(Ok(Error::AlreadySettled)),
        "settlement stays the single-use step"
    );
}

// ---------- C-1: who may call `authorize` / `mark_settled` ----------
//
// The rule is **owner OR operator**, made expressible by the `caller: Address` parameter.
// `require_auth` traps instead of returning a bool, so the contract still has to name one
// address before any authorization runs — it takes that address from the invocation and
// then checks membership. These tests pin all four corners: owner alone, owner beside a
// distinct operator, the operator itself, and outsiders (both the one who cannot sign as
// the owner and the one who signs perfectly well as somebody irrelevant).

#[test]
fn owner_can_authorize_when_no_operator_is_configured() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AuthorizationContract, ());
    let client = AuthorizationContractClient::new(&env, &id);

    let owner = Address::generate(&env);
    let agent = Address::generate(&env);
    let usdc = Address::generate(&env);

    client.init(&owner);
    // Deliberately NO set_operator here — this is the case setup() never exercises,
    // which is why the operator lockout went unnoticed.
    client.register_agent(&Policy {
        version: 1,
        owner: owner.clone(),
        agent: agent.clone(),
        allowed_services: vec![&env, svc(&env, "svc-api")],
        allowed_asset: usdc.clone(),
        per_intent_cap: CAP,
        cumulative_window_cap: WINDOW_CAP,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    let h = hash(&env, 170);
    let service = svc(&env, "svc-api");
    let amount = 10 * UNIT;
    let args: SVec<Val> = (
        owner.clone(),
        h.clone(),
        agent.clone(),
        service.clone(),
        usdc.clone(),
        amount,
    )
        .into_val(&env);

    env.set_auths(&[]);
    env.mock_auths(&[
        MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &agent,
            invoke: &MockAuthInvoke {
                contract: &id,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
    ]);

    let d = client.authorize(&owner, &h, &agent, &service, &usdc, &amount);
    assert_eq!(d.verdict, Verdict::Approved);
}

#[test]
fn owner_can_authorize_while_a_distinct_operator_is_configured() {
    // THE case that was impossible before `caller` existed: configuring an operator used to
    // hand `authorize` over wholesale and lock the owner out of its own contract.
    let f = setup();
    let h = hash(&f.env, 171);
    let service = svc(&f.env, "svc-api");
    let amount = 10 * UNIT;
    let contract = f.client.address.clone();
    let args: SVec<Val> = (
        f.owner.clone(),
        h.clone(),
        f.agent.clone(),
        service.clone(),
        f.usdc.clone(),
        amount,
    )
        .into_val(&f.env);

    // The operator is NOT mocked and stays configured: only the owner + agent sign.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[
        MockAuth {
            address: &f.owner,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &f.agent,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
    ]);

    let d = f
        .client
        .authorize(&f.owner, &h, &f.agent, &service, &f.usdc, &amount);
    assert_eq!(
        d.verdict,
        Verdict::Approved,
        "delegating to an operator must not lock the owner out of authorize"
    );
    assert_eq!(
        f.client.get_policy(&f.agent).version,
        1,
        "the operator slot is untouched — the owner did not have to point it at itself"
    );
}

#[test]
fn owner_can_mark_settled_while_a_distinct_operator_is_configured() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 173),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );

    let contract = f.client.address.clone();
    let args: SVec<Val> = (f.owner.clone(), d.decision_id.clone()).into_val(&f.env);
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "mark_settled",
            args,
            sub_invokes: &[],
        },
    }]);

    assert!(
        f.client.mark_settled(&f.owner, &d.decision_id).settled,
        "the owner must reach mark_settled even with an operator configured"
    );
}

#[test]
fn operator_can_mark_settled() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 174),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );

    let contract = f.client.address.clone();
    let args: SVec<Val> = (f.operator.clone(), d.decision_id.clone()).into_val(&f.env);
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.operator,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "mark_settled",
            args,
            sub_invokes: &[],
        },
    }]);

    assert!(
        f.client.mark_settled(&f.operator, &d.decision_id).settled,
        "the disjunction must keep working in the operator direction too"
    );
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn a_third_party_cannot_authorize_by_naming_the_owner_as_caller() {
    // `caller` is a claim, not a credential: naming the owner does nothing unless you can
    // also produce the owner's signature. `caller.require_auth()` is what turns the claim
    // into proof, and it traps here before any membership check is reached.
    let f = setup();
    let stranger = Address::generate(&f.env);
    let h = hash(&f.env, 175);
    let service = svc(&f.env, "svc-api");
    let amount = 10 * UNIT;
    let contract = f.client.address.clone();
    let args: SVec<Val> = (
        f.owner.clone(),
        h.clone(),
        f.agent.clone(),
        service.clone(),
        f.usdc.clone(),
        amount,
    )
        .into_val(&f.env);

    // The stranger signs for ITSELF while claiming to be the owner. The agent signs too,
    // so the only thing missing is the owner's own authorization.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[
        MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
        MockAuth {
            address: &f.agent,
            invoke: &MockAuthInvoke {
                contract: &contract,
                fn_name: "authorize",
                args: args.clone(),
                sub_invokes: &[],
            },
        },
    ]);

    f.client
        .authorize(&f.owner, &h, &f.agent, &service, &f.usdc, &amount);
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn a_third_party_cannot_mark_settled_by_naming_the_owner_as_caller() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 176),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    let stranger = Address::generate(&f.env);
    let contract = f.client.address.clone();
    let args: SVec<Val> = (f.owner.clone(), d.decision_id.clone()).into_val(&f.env);

    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "mark_settled",
            args,
            sub_invokes: &[],
        },
    }]);

    f.client.mark_settled(&f.owner, &d.decision_id);
}

#[test]
fn a_caller_who_signs_but_is_neither_owner_nor_operator_is_refused() {
    // The other half of the check: a real signature from an irrelevant account. Auth
    // succeeds, membership does not — so this is the `NotAuthorizedCaller` path rather
    // than a trap.
    let f = setup();
    let stranger = Address::generate(&f.env);

    assert_eq!(
        f.client.try_authorize(
            &stranger,
            &hash(&f.env, 177),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &(10 * UNIT)
        ),
        Err(Ok(Error::NotAuthorizedCaller))
    );

    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 178),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(
        f.client.try_mark_settled(&stranger, &d.decision_id),
        Err(Ok(Error::NotAuthorizedCaller))
    );
    assert!(
        !f.client.get_decision(&d.decision_id).settled,
        "a refused caller must leave the decision untouched"
    );
}

#[test]
#[should_panic(expected = "Unauthorized")]
fn the_agent_must_still_sign_even_when_the_caller_is_the_owner() {
    // `agent.require_auth()` is a SEPARATE property from the caller check and must not be
    // satisfied by it — the agent authorizes its own spend.
    let f = setup();
    let h = hash(&f.env, 179);
    let service = svc(&f.env, "svc-api");
    let amount = 10 * UNIT;
    let contract = f.client.address.clone();
    let args: SVec<Val> = (
        f.owner.clone(),
        h.clone(),
        f.agent.clone(),
        service.clone(),
        f.usdc.clone(),
        amount,
    )
        .into_val(&f.env);

    // The owner signs; the agent does not.
    f.env.set_auths(&[]);
    f.env.mock_auths(&[MockAuth {
        address: &f.owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            fn_name: "authorize",
            args,
            sub_invokes: &[],
        },
    }]);

    f.client
        .authorize(&f.owner, &h, &f.agent, &service, &f.usdc, &amount);
}

// ---------- C-4: `original_reason_code` is written once and never rewritten ----------

#[test]
fn original_reason_code_survives_an_approval() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 180),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    assert_eq!(d.reason_code, ReasonCode::PendingApproval);
    assert_eq!(d.original_reason_code, ReasonCode::PendingApproval);

    let r = f.client.resolve(&d.decision_id, &true);
    assert_eq!(r.verdict, Verdict::Approved);
    assert_eq!(r.reason_code, ReasonCode::Ok, "the CURRENT code moves on");
    assert_eq!(
        r.original_reason_code,
        ReasonCode::PendingApproval,
        "an approval must not erase the fact that the decision was ever escalated"
    );
    assert_eq!(
        f.client.get_decision(&d.decision_id).original_reason_code,
        ReasonCode::PendingApproval,
        "and it must be what STORAGE holds, not just what resolve() returned"
    );
}

#[test]
fn original_reason_code_survives_an_owner_rejection() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 181),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    let r = f.client.resolve(&d.decision_id, &false);
    assert_eq!(r.reason_code, ReasonCode::OwnerRejected);
    assert_eq!(r.original_reason_code, ReasonCode::PendingApproval);
}

#[test]
fn original_reason_code_survives_a_failed_re_judgement() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 182),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(500 * UNIT),
    );
    assert_eq!(d.original_reason_code, ReasonCode::PendingApproval);

    f.client.revoke_agent(&f.agent);
    let r = f.client.resolve(&d.decision_id, &true);

    assert_eq!(r.reason_code, ReasonCode::AgentRevoked);
    assert_eq!(
        r.original_reason_code,
        ReasonCode::PendingApproval,
        "the re-judgement rewrites the current code only — the original stands"
    );
}

#[test]
fn original_reason_code_equals_reason_code_when_nothing_is_ever_re_judged() {
    let f = setup();
    let approved = f.client.authorize(
        &f.owner,
        &hash(&f.env, 183),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(approved.reason_code, ReasonCode::Ok);
    assert_eq!(approved.original_reason_code, ReasonCode::Ok);

    let rejected = f.client.authorize(
        &f.owner,
        &hash(&f.env, 184),
        &f.agent,
        &svc(&f.env, "svc-unknown"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(rejected.reason_code, ReasonCode::ServiceNotAllowed);
    assert_eq!(rejected.original_reason_code, ReasonCode::ServiceNotAllowed);
}

// ---------- C-4: `resolved_policy_version` records the re-judgement ----------

#[test]
fn resolved_policy_version_is_none_until_resolve_runs() {
    let f = setup();
    let approved = f.client.authorize(
        &f.owner,
        &hash(&f.env, 190),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    assert_eq!(
        approved.resolved_policy_version, None,
        "a decision that never needed the human path was never re-judged"
    );

    let pending = f.client.authorize(
        &f.owner,
        &hash(&f.env, 191),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    assert_eq!(pending.resolved_policy_version, None);

    let r = f.client.resolve(&pending.decision_id, &true);
    assert_eq!(r.resolved_policy_version, Some(1));
    assert_eq!(
        f.client
            .get_decision(&pending.decision_id)
            .resolved_policy_version,
        Some(1)
    );
}

#[test]
fn resolved_policy_version_records_the_version_the_re_judgement_ran_under() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 192),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(500 * UNIT),
    );
    assert_eq!(d.policy_version, 1);
    assert_eq!(d.resolved_policy_version, None);

    // The owner bumps the policy while the decision sits pending. The new version still
    // permits the intent, so the approval goes through — which is exactly the case that
    // used to be indistinguishable from "never re-judged".
    f.client.set_policy(&Policy {
        version: 0,
        owner: f.owner.clone(),
        agent: f.agent.clone(),
        allowed_services: vec![&f.env, svc(&f.env, "svc-api")],
        allowed_asset: f.usdc.clone(),
        per_intent_cap: CAP,
        cumulative_window_cap: WINDOW_CAP,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    let r = f.client.resolve(&d.decision_id, &true);
    assert_eq!(r.verdict, Verdict::Approved);
    assert_eq!(
        r.policy_version, 1,
        "the frozen field must not move — decision_id and memo_hash bind it"
    );
    assert_eq!(
        r.resolved_policy_version,
        Some(2),
        "the audit trail must say the approval was judged under v2"
    );

    // The whole reason the version had to go in a SECOND field: the hashes still recompute.
    let mut pre = Bytes::new(&f.env);
    pre.append(&Bytes::from_slice(&f.env, &r.intent_hash.to_array()));
    pre.append(&Bytes::from_slice(&f.env, &r.policy_version.to_be_bytes()));
    pre.append(&Bytes::from_slice(&f.env, &r.decision_id.to_array()));
    let expected: BytesN<32> = f.env.crypto().sha256(&pre).into();
    assert_eq!(f.client.memo_hash(&r.decision_id), expected);
}

#[test]
fn resolved_policy_version_is_recorded_when_the_re_judgement_rejects() {
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 193),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(500 * UNIT),
    );

    // v2 no longer allows it.
    f.client.set_policy(&Policy {
        version: 0,
        owner: f.owner.clone(),
        agent: f.agent.clone(),
        allowed_services: vec![&f.env, svc(&f.env, "svc-api")],
        allowed_asset: f.usdc.clone(),
        per_intent_cap: UNIT,
        cumulative_window_cap: UNIT,
        window_seconds: WINDOW_SECS,
        approval_threshold: THRESHOLD,
        status: AgentStatus::Active,
    });

    let r = f.client.resolve(&d.decision_id, &true);
    assert_eq!(r.verdict, Verdict::Rejected);
    assert_eq!(r.reason_code, ReasonCode::CapExceeded);
    assert_eq!(
        r.resolved_policy_version,
        Some(2),
        "a refusal is a re-judgement too — record which version refused it"
    );
}

#[test]
fn resolved_policy_version_is_recorded_on_an_owner_rejection() {
    // No re-judgement runs on this path, but the field still records the version that was
    // current when the owner acted, so `resolved == resolved_policy_version.is_some()`
    // holds for every decision a reader can fetch.
    let f = setup();
    let d = f.client.authorize(
        &f.owner,
        &hash(&f.env, 194),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(THRESHOLD + 1),
    );
    let r = f.client.resolve(&d.decision_id, &false);
    assert!(r.resolved);
    assert_eq!(r.reason_code, ReasonCode::OwnerRejected);
    assert_eq!(r.resolved_policy_version, Some(1));
}
