use soroban_sdk::{contractevent, contracttype, Address, BytesN, String, Vec};

/// Reason behind a verdict. Every failure path in SOW §5.2 maps to exactly one code.
#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum ReasonCode {
    /// scenario 1 — valid
    Ok = 0,
    /// scenario 2 — exceeds per_intent_cap
    CapExceeded = 1,
    /// scenario 3 — service is not on the whitelist
    ServiceNotAllowed = 2,
    /// scenario 4 — asset differs from the policy asset
    AssetMismatch = 3,
    /// scenario 6 — agent has been revoked
    AgentRevoked = 4,
    /// exceeds cumulative_window_cap (adversarial: window boundary)
    WindowCapExceeded = 5,
    /// scenario 5 — above threshold, below cap → wait for the owner
    PendingApproval = 6,
    /// owner rejected it via resolve()
    OwnerRejected = 7,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Verdict {
    /// The intent passed every rule in the active policy. Settlement may proceed
    /// once the executor re-reads this decision and marks it settled.
    Approved = 0,
    /// The intent broke a rule, or the owner declined it. This is a successful
    /// governance outcome recorded permanently on-chain, not a failed call —
    /// read `reason_code` for which rule decided it.
    Rejected = 1,
    /// Above `approval_threshold` but within `per_intent_cap`: the policy defers
    /// to a human. Nothing is spent against the window until the owner approves
    /// through resolve().
    RequiresApproval = 2,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum AgentStatus {
    /// The agent may spend within its policy.
    Active = 0,
    /// The agent is refused at authorize(), and any decision it already holds is
    /// refused at resolve() and mark_settled() too — revocation takes effect
    /// immediately (SOW §5.2 scenario 6).
    Revoked = 1,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub version: u32,
    pub owner: Address,
    pub agent: Address,
    pub allowed_services: Vec<String>,
    /// SAC address of the asset (Phase 1: testnet USDC)
    pub allowed_asset: Address,
    pub per_intent_cap: i128,
    pub cumulative_window_cap: i128,
    /// TUMBLING window, not rolling — see DECISIONS.md #3
    pub window_seconds: u64,
    pub approval_threshold: i128,
    pub status: AgentStatus,
}

/// Spend state for one window. Reset LAZILY when a new epoch starts —
/// no history is kept, so storage stays bounded.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct WindowState {
    pub window_start: u64,
    pub spent: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Decision {
    pub decision_id: BytesN<32>,
    pub intent_hash: BytesN<32>,
    pub agent: Address,
    pub service_id: String,
    pub asset: Address,
    pub amount: i128,
    /// The version that PRODUCED this decision. Frozen for life: it is bound into
    /// `decision_id` and `memo_hash` (DECISIONS.md #4, SOW §6.3), so moving it would make
    /// both un-recomputable from public data.
    pub policy_version: u32,
    /// The policy version that was current when `resolve()` ran, or `None` while the
    /// decision has never been resolved.
    ///
    /// `resolve(approve = true)` re-judges against the policy current at resolve time
    /// while `policy_version` stays frozen, so without this field a re-judgement that
    /// still passed was indistinguishable from one that never ran. On the owner-rejection
    /// path no re-judgement happens; the field then records the version that was current
    /// at the moment of the rejection, which keeps the invariant
    /// `resolved == resolved_policy_version.is_some()` checkable by a reader.
    pub resolved_policy_version: Option<u32>,
    pub verdict: Verdict,
    /// The CURRENT (final) code. `resolve()` overwrites it.
    pub reason_code: ReasonCode,
    /// The code recorded at `authorize()` time. Written ONCE and never again, so an
    /// approval cannot erase the fact that the decision was ever escalated: after
    /// `resolve(approve = true)` `reason_code` reads `Ok` while this still reads
    /// `PendingApproval` (SOW §5.2 scenario 5 stays visible in the evidence trail).
    pub original_reason_code: ReasonCode,
    pub ledger_seq: u32,
    /// whether it went through the human approver path `resolve()` (D4 surfaces escalation)
    pub resolved: bool,
    pub settled: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Owner,
    Operator,
    Policy(Address),
    Window(Address),
    Decision(BytesN<32>),
    /// intent_hash -> decision_id. The basis of idempotency (scenario 7).
    IntentIndex(BytesN<32>),
}

/// Emitted every time `authorize()` produces a new decision.
/// Lets reviewers index by agent without reading storage.
#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct DecisionEvent {
    #[topic]
    pub agent: Address,
    pub decision: Decision,
}

/// Emitted when the owner resolves a decision sitting in RequiresApproval.
#[contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedEvent {
    #[topic]
    pub agent: Address,
    pub decision: Decision,
}
