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
    Approved = 0,
    Rejected = 1,
    RequiresApproval = 2,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum AgentStatus {
    Active = 0,
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
    pub policy_version: u32,
    pub verdict: Verdict,
    pub reason_code: ReasonCode,
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
