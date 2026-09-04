use soroban_sdk::contracterror;

/// Execution errors (access control, state machine). Distinct from `ReasonCode` —
/// that one is a *policy verdict*, RECORDED on-chain rather than raised as a panic.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// init() has not been called, so the contract has no owner and cannot
    /// authorize anything. A freshly deployed instance answers every call with
    /// this until init() is invoked (the CLI runs only __constructor on deploy).
    NotInitialized = 1,
    /// init() called on an instance that already has an owner. Ownership is set
    /// once and never reassigned.
    AlreadyInitialized = 2,
    /// An owner-gated entry point was called by somebody else. Covers
    /// register_agent, set_policy, revoke_agent, set_operator and resolve.
    NotOwner = 3,
    /// `caller` is neither the owner nor the configured operator. This is a
    /// misconfigured caller key rather than a bad request: the client cannot fix
    /// it, so a gateway should treat it as its own fault and alert.
    NotAuthorizedCaller = 4,
    /// No policy exists for this agent address. register_agent() must run first;
    /// an unregistered agent is refused before any policy is evaluated.
    AgentNotRegistered = 5,
    /// No decision is stored under this decision_id or intent_hash. Also what a
    /// reader sees if the persistent entry has been archived and not restored.
    DecisionNotFound = 6,
    /// resolve() called on a decision that is not in the RequiresApproval state
    NotPendingApproval = 7,
    /// resolve() is terminal — a second call fails
    AlreadyResolved = 8,
    /// mark_settled() on a decision already marked settled. This is the on-chain
    /// guard against a double payment (SOW §5.2 scenario 7) and it holds even
    /// when the executor's own journal has been lost.
    AlreadySettled = 9,
    /// mark_settled() on a decision whose verdict is not Approved. Settlement is
    /// gated on the decision, never on the request that produced it.
    NotApproved = 10,
    /// amount is zero or negative. The canonical form requires amount > 0, so a
    /// well-behaved gateway rejects this before it reaches the contract.
    InvalidAmount = 11,
    /// mark_settled() on a decision whose agent has been revoked since it was approved.
    /// Revocation takes effect immediately (SOW §5.2 scenario 6).
    /// Appended at the END so no existing discriminant shifts (§5.1 ABI freeze).
    AgentRevoked = 12,
}
