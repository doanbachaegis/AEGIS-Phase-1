import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The gateway's database.
 *
 * **What this database is for, and what it is emphatically not for.**
 *
 * It is not the record of decisions. §6.3 requires every decision to be readable
 * on chain by contract ID alone, and the console reads it that way. Duplicating
 * verdicts here creates a second source of truth that can disagree with the
 * first.
 *
 * Its real job is the part the chain does NOT hold. `purpose` and `client_ref`
 * are hashed into `intent_hash` but never stored on-chain — only their digest
 * crosses the ABI. §6.1 D2 requires a reviewer to recompute `intent_hash` from a
 * submitted intent; without these two fields that claim cannot be checked by
 * anybody, including us. So the row that matters is the **preimage**, and the
 * chain-side columns beside it are a cache for listing and joining, never an
 * authority.
 *
 * The primary key is `intent_hash` — the chain's own key. Any other surrogate
 * key would let a row here and a decision there disagree about which intent they
 * describe.
 */

/** `bytea`. Hashes are stored as bytes, not hex text: half the size, and no case ambiguity. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * `numeric(39, 0)` holds the full `i128` range (39 digits) exactly. `bigint`
 * would silently be a different type from the contract's, and the whole point of
 * carrying stroops as integers is that nothing rounds.
 */
const stroops = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(39, 0)",
  toDriver: (value: bigint) => value.toString(),
  fromDriver: (value: string) => BigInt(value),
});

export const intents = pgTable(
  "intents",
  {
    /** sha256(canonical_intent). The chain's key, so DB and chain cannot disagree. */
    intentHash: bytea("intent_hash").primaryKey(),

    // ---- the canonical preimage, field by field, exactly as hashed ----
    agentId: text("agent_id").notNull(),
    serviceId: text("service_id").notNull(),
    /** the `"CODE:ISSUER"` string, verbatim — NOT the SAC */
    asset: text("asset").notNull(),
    amount: stroops("amount").notNull(),
    /** hashed into intent_hash, never stored on-chain */
    purpose: text("purpose").notNull(),
    /** hashed into intent_hash, never stored on-chain */
    clientRef: text("client_ref").notNull(),

    /**
     * The serialized `canonical_intent` bytes. Redundant with the six columns
     * above by construction, and kept anyway: it is the artifact a reviewer pipes
     * through sha256 to land on `intent_hash` with no AEGIS code in the loop. A
     * reviewer who has to re-serialize from columns is trusting our serializer,
     * which is the exact thing being checked.
     */
    canonicalPreimage: bytea("canonical_preimage").notNull(),

    // ---- what the gateway resolved the strings to ----
    agentAddress: text("agent_address").notNull(),
    assetSac: text("asset_sac").notNull(),
    registryVersion: integer("registry_version").notNull(),

    /** ties this row to its three log records in the §6.1 D2 transcript */
    requestId: text("request_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intents_agent_received_idx").on(t.agentId, t.receivedAt)],
);

export const decisions = pgTable(
  "decisions",
  {
    /** Same key as `intents`, one decision per intent — the chain guarantees it. */
    intentHash: bytea("intent_hash")
      .primaryKey()
      .references(() => intents.intentHash, { onDelete: "cascade" }),
    /** sha256("AEGIS-DECISION-v1" || intent_hash || policy_version_be) — DECISIONS.md #4 */
    decisionId: bytea("decision_id").notNull(),

    /**
     * A CACHE of the on-chain verdict, stored as the numeric discriminants the
     * ABI uses. Never read to make a decision: the executor re-reads the chain
     * (SOW §4.1 D3) and so does `GET /v1/approvals`.
     */
    verdict: smallint("verdict").notNull(),
    reasonCode: smallint("reason_code").notNull(),
    originalReasonCode: smallint("original_reason_code").notNull(),
    policyVersion: integer("policy_version").notNull(),
    resolved: boolean("resolved").notNull().default(false),
    settled: boolean("settled").notNull().default(false),

    /** the ledger the contract stamped into `Decision.ledger_seq` */
    ledgerSeq: integer("ledger_seq"),
    /**
     * Captured from the submission response BEFORE the confirmation wait. If the
     * process dies during the ~5s ledger close this is the only handle on what
     * happened, so it is written at submit time, not at confirm time.
     */
    txHash: text("tx_hash"),

    /** POST -> verdict, in milliseconds. Simulation time; no ledger close in it. */
    verdictMs: integer("verdict_ms"),
    /** POST -> on-ledger finality, in milliseconds. Includes the ledger close. */
    finalityMs: integer("finality_ms"),

    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("decisions_decision_id_idx").on(t.decisionId),
    index("decisions_verdict_idx").on(t.verdict),
  ],
);

/**
 * The escalation queue for `RequiresApproval`.
 *
 * This table is an INDEX, not a state machine. There is no `pending` column,
 * because pending-ness is a property of the chain: `GET /v1/approvals` reads
 * `get_decision` for each row and keeps the ones the contract still reports as
 * `RequiresApproval` and unresolved. A boolean here would go stale the moment
 * the owner resolved a decision through any path but this gateway — the console,
 * the CLI, a second gateway instance.
 */
export const approvalQueue = pgTable(
  "approval_queue",
  {
    decisionId: bytea("decision_id").primaryKey(),
    intentHash: bytea("intent_hash")
      .notNull()
      .references(() => intents.intentHash, { onDelete: "cascade" }),

    /**
     * The §4.1 D2 escalation rule string, verbatim, e.g. `amount 30 > threshold 25`.
     */
    rule: text("rule").notNull(),
    /**
     * The threshold SNAPSHOT the rule above was rendered from. `set_policy` can
     * raise or lower `approval_threshold` while a decision sits in the queue; a
     * queue entry that re-read the policy at display time would quietly start
     * describing a different rule than the one that escalated it. The snapshot
     * makes the entry mean the same thing tomorrow as it did when it was written.
     */
    thresholdSnapshot: stroops("threshold_snapshot").notNull(),
    amount: stroops("amount").notNull(),
    policyVersionSnapshot: integer("policy_version_snapshot").notNull(),

    escalatedAt: timestamp("escalated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_queue_escalated_idx").on(t.escalatedAt)],
);

/**
 * Submissions that never reached a decision: a contract `Error`, an RPC failure,
 * a simulation that blew up. They have no `intent_hash` row to hang off when the
 * failure happened before hashing, so this table stands alone.
 */
export const submissionFailures = pgTable(
  "submission_failures",
  {
    requestId: text("request_id").primaryKey(),
    intentHash: bytea("intent_hash"),
    /** the contract Error name, when the failure was one */
    contractError: text("contract_error"),
    httpStatus: smallint("http_status").notNull(),
    /** the unparsed simulation/RPC error — §6.1 D2 wants it raw */
    rawError: text("raw_error").notNull(),
    context: jsonb("context"),
    failedAt: timestamp("failed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index("submission_failures_failed_idx").on(t.failedAt)],
);
