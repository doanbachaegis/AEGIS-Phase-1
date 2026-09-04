/**
 * Every way a settlement can refuse, as a CLOSED set of codes.
 *
 * A refusal that reads `Error: something went wrong` is operationally useless:
 * the reviewer cannot tell "the contract said no" from "Horizon was down", and
 * those demand opposite responses — the first is a correct outcome, the second
 * is an outage to retry. So every abort carries a code from this union, the
 * codes are grouped by what a reader should DO about them, and the CLI prints
 * the code rather than only the message.
 */

/**
 * The decision itself forbids this settlement. Re-running changes nothing until
 * the chain changes. These are the gate of SOW §4.1 D3 — the executor re-reads
 * the decision and refuses on its own evidence.
 */
export const GATE_CODES = [
  /** `get_decision` returned `DecisionNotFound` — nothing on chain authorized this. */
  "DECISION_NOT_FOUND",
  /** `verdict != Approved`. Rejected and RequiresApproval both land here. */
  "NOT_APPROVED",
  /** `settled == true` already. The §5.2 scenario 7 refusal. */
  "ALREADY_SETTLED",
  /** The decision's SAC address is not the one `Asset(code, issuer).contractId()` derives. */
  "ASSET_MISMATCH",
  /** The i128 amount does not fit the classic rail's int64 stroops, or is <= 0. */
  "AMOUNT_OUT_OF_RANGE",
  /** The decision's `service_id` has no active destination in the published registry. */
  "UNKNOWN_SERVICE",
  /** Locally computed memo != the contract's own `memo_hash()` view. */
  "MEMO_MISMATCH",
  /** The payment cannot succeed: missing account, missing or unauthorized trustline, short balance. */
  "PREFLIGHT_FAILED",
] as const;

/**
 * The environment or the published registry is wrong. Nothing was attempted;
 * fix the configuration and re-run.
 */
export const CONFIG_CODES = [
  "CONFIG_INVALID",
  "REGISTRY_INVALID",
  /** The signing key is not the executor account the registry publishes. */
  "SOURCE_MISMATCH",
  /** `CONTRACT_ID` is not the contract the registry publishes. */
  "CONTRACT_MISMATCH",
] as const;

/**
 * Something about the run, not about the decision. Some of these are safe to
 * retry; `NON_INCLUSION_PROVEN` and `ABANDONED` are not — see `recover()`.
 */
export const RUNTIME_CODES = [
  /** Another settle() for this decision_id is in flight in this process. */
  "LOCK_HELD",
  /** `mark_settled` did not apply. The payment is never submitted after this. */
  "MARK_SETTLED_FAILED",
  /** Horizon rejected the envelope outright (not a timeout). */
  "SUBMIT_FAILED",
  /**
   * `max_time` has passed and the stored hash still 404s on Horizon. The
   * transaction can never be included, so this is a PROOF, not a timeout.
   */
  "NON_INCLUSION_PROVEN",
  /**
   * The stored transaction is neither confirmed nor proven absent yet. The only
   * correct response is to wait and poll the SAME hash again.
   */
  "INCLUSION_UNKNOWN",
  /** The store holds a record that contradicts what this run computed. */
  "STORE_CONFLICT",
  /** A previous attempt was abandoned; this decision needs manual reconciliation. */
  "ABANDONED",
  /** A public data source could not be reached. Never a verdict. */
  "SOURCE_UNAVAILABLE",
] as const;

export type SettlementErrorCode =
  | (typeof GATE_CODES)[number]
  | (typeof CONFIG_CODES)[number]
  | (typeof RUNTIME_CODES)[number];

/** True when the refusal came from the decision, not from the machinery. */
export const isGateCode = (code: SettlementErrorCode): boolean =>
  (GATE_CODES as readonly string[]).includes(code);

export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  /** What the executor required. */
  readonly expected?: string;
  /** What it found instead. */
  readonly actual?: string;

  constructor(
    code: SettlementErrorCode,
    message: string,
    detail?: { expected?: string; actual?: string; cause?: unknown },
  ) {
    super(message, detail?.cause === undefined ? undefined : { cause: detail.cause });
    this.name = "SettlementError";
    this.code = code;
    if (detail?.expected !== undefined) this.expected = detail.expected;
    if (detail?.actual !== undefined) this.actual = detail.actual;
  }

  /** `CODE: message (expected X, got Y)` — one line, greppable. */
  describe(): string {
    const cmp =
      this.expected !== undefined || this.actual !== undefined
        ? ` (expected ${this.expected ?? "?"}, got ${this.actual ?? "?"})`
        : "";
    return `${this.code}: ${this.message}${cmp}`;
  }
}
