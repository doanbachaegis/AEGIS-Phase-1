//! Assert the Rust implementation matches the fixture shared with TypeScript.
//! Fixture: vectors/canonical-vectors.json — NOT regenerated here.

use aegis_canonical::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct IntentJson {
    #[serde(rename = "agentId")]
    agent_id: String,
    #[serde(rename = "serviceId")]
    service_id: String,
    asset: String,
    /// sent as a string so precision is not lost through a JSON number
    amount: String,
    purpose: String,
    #[serde(rename = "clientRef")]
    client_ref: String,
}

#[derive(Deserialize)]
struct Vector {
    name: String,
    intent: IntentJson,
    policy_version: u32,
    canonical_hex: String,
    intent_hash: String,
    decision_id: String,
    memo_hash: String,
}

#[derive(Deserialize)]
struct Fixture {
    vectors: Vec<Vector>,
}

fn load() -> Fixture {
    let raw = include_str!("../../../vectors/canonical-vectors.json");
    serde_json::from_str(raw).expect("fixture vectors failed to parse")
}

#[test]
fn matches_typescript_test_vectors() {
    let fixture = load();
    assert!(!fixture.vectors.is_empty(), "fixture is empty");

    for v in &fixture.vectors {
        let intent = Intent {
            agent_id: v.intent.agent_id.clone(),
            service_id: v.intent.service_id.clone(),
            asset: v.intent.asset.clone(),
            amount: v
                .intent
                .amount
                .parse()
                .expect("amount must be an integer stroop value"),
            purpose: v.intent.purpose.clone(),
            client_ref: v.intent.client_ref.clone(),
        };

        let canon = canonical_intent(&intent).expect("canonical_intent failed");
        assert_eq!(
            to_hex(&canon),
            v.canonical_hex,
            "[{}] canonical_intent mismatch",
            v.name
        );

        let ih = intent_hash(&intent).unwrap();
        assert_eq!(
            to_hex(&ih),
            v.intent_hash,
            "[{}] intent_hash mismatch",
            v.name
        );

        let did = decision_id(&ih, v.policy_version);
        assert_eq!(
            to_hex(&did),
            v.decision_id,
            "[{}] decision_id mismatch",
            v.name
        );

        let mh = memo_hash(&ih, v.policy_version, &did);
        assert_eq!(to_hex(&mh), v.memo_hash, "[{}] memo_hash mismatch", v.name);
    }
}

#[test]
fn length_prefix_prevents_ambiguity() {
    let mk = |agent: &str, service: &str| Intent {
        agent_id: agent.into(),
        service_id: service.into(),
        asset: "USDC:GTEST".into(),
        amount: 5 * STROOPS_PER_UNIT,
        purpose: "p".into(),
        client_ref: "r".into(),
    };
    assert_ne!(
        intent_hash(&mk("ab", "c")).unwrap(),
        intent_hash(&mk("a", "bc")).unwrap(),
        "length prefix must remove ambiguity between adjacent fields"
    );
}

#[test]
fn memo_preimage_is_68_bytes() {
    // intent_hash(32) + policy_version(4) + decision_id(32)
    let ih = [0u8; 32];
    let did = [1u8; 32];
    // memo_hash does not expose the preimage, so rebuild it here to lock the length
    let mut pre = Vec::new();
    pre.extend_from_slice(&ih);
    pre.extend_from_slice(&7u32.to_be_bytes());
    pre.extend_from_slice(&did);
    assert_eq!(pre.len(), 68);
    assert_eq!(memo_hash(&ih, 7, &did), sha256(&pre));
}

#[test]
fn rejects_non_positive_amount() {
    let bad = Intent {
        agent_id: "a".into(),
        service_id: "s".into(),
        asset: "USDC:G".into(),
        amount: 0,
        purpose: "".into(),
        client_ref: "".into(),
    };
    assert_eq!(
        canonical_intent(&bad),
        Err(CanonError::NonPositiveAmount(0))
    );
}
