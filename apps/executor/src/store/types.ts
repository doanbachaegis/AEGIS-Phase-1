/**
 * The settlement journal.
 *
 * 🔑 THE INVARIANT THAT DEFINES THIS INTERFACE: the store holds **transport
 * state only** — a transaction hash, the exact bytes that produce it, and how
 * far the attempt got. It deliberately cannot answer "how much", "which asset",
 * "to whom" or "was it approved". Those come from `get_decision` on every single
 * run (SOW §4.1 D3: the executor re-reads the decision and does not trust the
 * application database).
 *
 * That is not a stylistic split. If the amount lived here, a corrupted or
 * tampered journal could redirect money; because it does not, the worst a bad
 * journal can do is make the executor re-poll a hash or refuse to proceed.
 *
 * Everything is async even though the SQLite implementation is synchronous, so
 * the Postgres implementation Phase 2 wants is a drop-in.
 */
import type { SettlementError } from "../errors.js";

/**
 * The states an attempt passes through, in order. There is no transition that
 * goes backwards: an attempt only ever moves right, or stops.
 *
 *   PREPARED  envelope built, hash precomputed, COMMITTED — mark_settled not yet called
 *   MARKED    mark_settled confirmed applied on the ledger
 *   SUBMITTED envelope POSTed to Horizon; the outcome is not yet known
 *   SETTLED   the payment is on the ledger and succeeded
 *   ABANDONED terminal WITHOUT a payment: either max_time passed with the hash
 *             still 404ing (non-inclusion PROVEN), or the transaction was
 *             included but failed. Either way no money moved, and the decision
 *             is already marked settled — so it needs manual reconciliation,
 *             never an automatic retry.
 */
export type SettlementStatus = "PREPARED" | "MARKED" | "SUBMITTED" | "SETTLED" | "ABANDONED";

export interface SettlementRecord {
  /** Lowercase hex. The primary key: one attempt per decision, for ever. */
  decisionId: string;
  /**
   * The transaction hash, computed BEFORE submission. This is what makes
   * recovery possible at all — after a crash it is the only handle on a
   * transaction that may or may not exist.
   */
  txHash: string;
  /**
   * The SIGNED envelope, base64. Stored so a retry can re-POST the *identical
   * bytes* rather than rebuild — a rebuild takes a new sequence number and
   * becomes a second, differently-hashed transaction that could pay twice.
   */
  envelopeXdr: string;
  /** The source account of the payment. */
  source: string;
  /** Decimal string: a Stellar sequence number is an int64 and does not fit a JS number. */
  sequence: string;
  /** Absolute unix seconds. After this, non-inclusion becomes provable. */
  maxTime: number;
  status: SettlementStatus;
  /** The ledger the payment landed in. Present only once SETTLED. */
  ledger?: number;
  /** Free-text breadcrumb for the reviewer — never read back as a decision input. */
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields a caller may set when moving a record forward. */
export interface SettlementPatch {
  ledger?: number;
  note?: string;
}

export interface SettlementStore {
  get(decisionId: string): Promise<SettlementRecord | undefined>;

  /**
   * Durably commit a new PREPARED record.
   *
   * MUST NOT return until the write is on stable storage: the whole ordering
   * argument rests on this write having happened before `mark_settled` is
   * called. Rejects with {@link SettlementError} `STORE_CONFLICT` if the
   * decision already has a record — a second attempt must go through
   * `recover()`, never through a fresh prepare.
   */
  putPrepared(record: Omit<SettlementRecord, "createdAt" | "updatedAt" | "status">): Promise<SettlementRecord>;

  /** Move a record to a later state. Rejects on an unknown decision. */
  advance(decisionId: string, status: SettlementStatus, patch?: SettlementPatch): Promise<SettlementRecord>;

  /**
   * Replace a PREPARED record with a freshly built envelope.
   *
   * ⚠️ Legal in exactly ONE situation, and the caller must have proved it:
   * the record is still `PREPARED` **and** the chain still reports the decision
   * unsettled. In that state `mark_settled` provably never applied, nothing was
   * ever submitted, and no money is at risk — so rebuilding with a new sequence
   * number cannot pay twice. Outside it, rebuilding is the double-payment bug
   * this whole module exists to prevent, which is why this is a separate,
   * narrow method rather than an option on `putPrepared`.
   */
  replacePrepared(
    record: Omit<SettlementRecord, "createdAt" | "updatedAt" | "status">,
  ): Promise<SettlementRecord>;

  /** Records not yet in a terminal state, oldest first — the reconciliation work queue. */
  pending(): Promise<SettlementRecord[]>;

  close(): Promise<void>;
}

export const TERMINAL: readonly SettlementStatus[] = ["SETTLED", "ABANDONED"];
export const isTerminal = (s: SettlementStatus): boolean => TERMINAL.includes(s);
