use soroban_sdk::contracterror;

/// Execution errors (access control, state machine). Distinct from `ReasonCode` —
/// that one is a *policy verdict*, RECORDED on-chain rather than raised as a panic.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    NotOwner = 3,
    NotAuthorizedCaller = 4,
    AgentNotRegistered = 5,
    DecisionNotFound = 6,
    /// resolve() called on a decision that is not in the RequiresApproval state
    NotPendingApproval = 7,
    /// resolve() is terminal — a second call fails
    AlreadyResolved = 8,
    AlreadySettled = 9,
    NotApproved = 10,
    InvalidAmount = 11,
    /// mark_settled() on a decision whose agent has been revoked since it was approved.
    /// Revocation takes effect immediately (SOW §5.2 scenario 6).
    /// Appended at the END so no existing discriminant shifts (§5.1 ABI freeze).
    AgentRevoked = 12,
}
