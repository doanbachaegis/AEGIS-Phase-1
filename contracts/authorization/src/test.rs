//! Test suite for the 7 scenarios in SOW §5.2 plus the adversarial suite (D1).
//!
//! Note: `mock_all_auths()` is used ONLY for the happy path. The access-control tests
//! deliberately do NOT mock — that is where the tests earn their keep.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
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
    let first = f
        .client
        .authorize(&h, &f.agent, &svc(&f.env, "svc-api"), &f.usdc, &(10 * UNIT));
    let again = f
        .client
        .authorize(&h, &f.agent, &svc(&f.env, "svc-api"), &f.usdc, &(10 * UNIT));

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

    f.client
        .authorize(&h, &f.agent, &svc(&f.env, "svc-api"), &f.usdc, &amount);
    let after_first = f.client.get_window(&f.agent).spent;
    assert_eq!(after_first, amount);

    for _ in 0..5 {
        f.client
            .authorize(&h, &f.agent, &svc(&f.env, "svc-api"), &f.usdc, &amount);
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
            &hash(&f.env, 100 + i),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &each,
        );
        assert_eq!(d.verdict, Verdict::Approved, "intent {i} must be approved");
    }
    let over = f.client.authorize(
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
            &hash(&f.env, 100 + i),
            &f.agent,
            &svc(&f.env, "svc-api"),
            &f.usdc,
            &each,
        );
    }
    f.env.ledger().with_mut(|l| l.timestamp += WINDOW_SECS + 1);
    let d = f.client.authorize(
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
        &hash(&f.env, 40),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(10 * UNIT),
    );
    f.client.mark_settled(&d.decision_id);
    assert_eq!(
        f.client.try_mark_settled(&d.decision_id),
        Err(Ok(Error::AlreadySettled)),
        "settlement is the single-use step"
    );
}

#[test]
fn cannot_settle_decision_that_is_not_approved() {
    let f = setup();
    let d = f.client.authorize(
        &hash(&f.env, 41),
        &f.agent,
        &svc(&f.env, "svc-api"),
        &f.usdc,
        &(CAP + 1),
    );
    assert_eq!(
        f.client.try_mark_settled(&d.decision_id),
        Err(Ok(Error::NotApproved))
    );
}

#[test]
fn set_policy_bumps_version_and_leaves_existing_decisions_untouched() {
    let f = setup();
    let old = f.client.authorize(
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
    let d = f
        .client
        .authorize(&h, &f.agent, &svc(&f.env, "svc-api"), &f.usdc, &(10 * UNIT));
    assert_eq!(f.client.decision_by_intent(&h).decision_id, d.decision_id);
}

#[test]
fn unregistered_agent_is_rejected() {
    let f = setup();
    let stranger = Address::generate(&f.env);
    assert_eq!(
        f.client.try_authorize(
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
#[should_panic]
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

    let d = f.client.authorize(&h, &f.agent, &service, &f.usdc, &amount);
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
