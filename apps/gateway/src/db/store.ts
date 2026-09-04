import { Buffer } from "node:buffer";
import { and, desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { FastifyBaseLogger } from "fastify";
import { approvalQueue, decisions, intents, submissionFailures } from "./schema.js";

/**
 * The persistence seam, and the degraded mode behind it.
 *
 * The gateway MUST boot and serve the chain path with no database. A decision is
 * produced and stored by the contract; a gateway that refuses to call
 * `authorize` because Postgres is down has turned an evidence-collection outage
 * into a governance outage. So every write here is best-effort and every failure
 * is logged rather than thrown.
 *
 * What that costs is written down in `DegradedStore` — it is not nothing.
 */

export interface IntentRow {
  intentHash: string;
  agentId: string;
  serviceId: string;
  asset: string;
  amount: bigint;
  purpose: string;
  clientRef: string;
  canonicalPreimage: string;
  agentAddress: string;
  assetSac: string;
  registryVersion: number;
  requestId: string;
}

export interface DecisionRow {
  intentHash: string;
  decisionId: string;
  verdict: number;
  reasonCode: number;
  originalReasonCode: number;
  policyVersion: number;
  resolved: boolean;
  settled: boolean;
  ledgerSeq: number | undefined;
  txHash: string | undefined;
  verdictMs: number | undefined;
  finalityMs: number | undefined;
}

export interface ApprovalRow {
  decisionId: string;
  intentHash: string;
  rule: string;
  thresholdSnapshot: bigint;
  amount: bigint;
  policyVersionSnapshot: number;
}

export interface FailureRow {
  requestId: string;
  intentHash: string | undefined;
  contractError: string | undefined;
  httpStatus: number;
  rawError: string;
  context: Record<string, unknown>;
}

/** What `GET /v1/approvals` needs before it goes and asks the chain. */
export interface ApprovalCandidate extends ApprovalRow {
  escalatedAt: Date;
  agentId: string | undefined;
  serviceId: string | undefined;
  purpose: string | undefined;
  clientRef: string | undefined;
}

export interface IntentStore {
  readonly mode: "postgres" | "degraded";
  /** @returns true if this `intent_hash` had not been submitted before. */
  recordIntent(row: IntentRow): Promise<boolean>;
  recordDecision(row: DecisionRow): Promise<void>;
  enqueueApproval(row: ApprovalRow): Promise<void>;
  recordFailure(row: FailureRow): Promise<void>;
  /** Escalation index. Pending-ness is decided against the chain, not here. */
  approvalCandidates(limit: number): Promise<ApprovalCandidate[]>;
  /** The preimage fields the chain does not carry. */
  intentByHash(intentHash: string): Promise<IntentRow | undefined>;
  close(): Promise<void>;
}

const hex = (s: string): Buffer => Buffer.from(s, "hex");

/** postgres.js puts the useful part in `code`, and often leaves `message` empty. */
function describeDbError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const code = (e as { code?: string }).code;
  const message = e.message.trim();
  if (code && message) return `${code}: ${message}`;
  return code ?? message ?? e.name;
}

/** Host and port only — a connection string carries credentials. */
function hostOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  } catch {
    return "unparseable DATABASE_URL";
  }
}

class PostgresStore implements IntentStore {
  readonly mode = "postgres" as const;

  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly sql: postgres.Sql,
    private readonly log: FastifyBaseLogger,
  ) {}

  private async guard<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      // A database that fails mid-flight degrades exactly like one that was never
      // there: the chain call already happened, or is about to, and it is the
      // authority. Losing the evidence row is bad; losing the decision is worse.
      this.log.error({ err: e, op: what }, "database write failed — evidence row lost");
      return fallback;
    }
  }

  async recordIntent(row: IntentRow): Promise<boolean> {
    return this.guard(
      "recordIntent",
      async () => {
        const inserted = await this.db
          .insert(intents)
          .values({
            intentHash: hex(row.intentHash),
            agentId: row.agentId,
            serviceId: row.serviceId,
            asset: row.asset,
            amount: row.amount,
            purpose: row.purpose,
            clientRef: row.clientRef,
            canonicalPreimage: hex(row.canonicalPreimage),
            agentAddress: row.agentAddress,
            assetSac: row.assetSac,
            registryVersion: row.registryVersion,
            requestId: row.requestId,
          })
          // NOT replay protection. The contract is already idempotent on
          // `intent_hash` (DECISIONS.md #1) and re-authorizing returns the
          // original decision. This clause only stops a duplicate SUBMISSION from
          // overwriting the first one's request_id and timestamp.
          .onConflictDoNothing({ target: intents.intentHash })
          .returning({ intentHash: intents.intentHash });
        return inserted.length > 0;
      },
      true,
    );
  }

  async recordDecision(row: DecisionRow): Promise<void> {
    await this.guard(
      "recordDecision",
      async () => {
        const values = {
          intentHash: hex(row.intentHash),
          decisionId: hex(row.decisionId),
          verdict: row.verdict,
          reasonCode: row.reasonCode,
          originalReasonCode: row.originalReasonCode,
          policyVersion: row.policyVersion,
          resolved: row.resolved,
          settled: row.settled,
          ledgerSeq: row.ledgerSeq ?? null,
          txHash: row.txHash ?? null,
          verdictMs: row.verdictMs ?? null,
          finalityMs: row.finalityMs ?? null,
        };
        await this.db
          .insert(decisions)
          .values(values)
          .onConflictDoUpdate({
            target: decisions.intentHash,
            // A resolve() changes reason_code and resolved; refresh the cache.
            set: {
              verdict: values.verdict,
              reasonCode: values.reasonCode,
              resolved: values.resolved,
              settled: values.settled,
            },
          });
      },
      undefined,
    );
  }

  async enqueueApproval(row: ApprovalRow): Promise<void> {
    await this.guard(
      "enqueueApproval",
      async () => {
        await this.db
          .insert(approvalQueue)
          .values({
            decisionId: hex(row.decisionId),
            intentHash: hex(row.intentHash),
            rule: row.rule,
            thresholdSnapshot: row.thresholdSnapshot,
            amount: row.amount,
            policyVersionSnapshot: row.policyVersionSnapshot,
          })
          // The snapshot is written ONCE. A second submission of the same intent
          // must not re-render the rule against a policy that has moved since.
          .onConflictDoNothing({ target: approvalQueue.decisionId });
      },
      undefined,
    );
  }

  async recordFailure(row: FailureRow): Promise<void> {
    await this.guard(
      "recordFailure",
      async () => {
        await this.db
          .insert(submissionFailures)
          .values({
            requestId: row.requestId,
            intentHash: row.intentHash ? hex(row.intentHash) : null,
            contractError: row.contractError ?? null,
            httpStatus: row.httpStatus,
            rawError: row.rawError,
            context: row.context,
          })
          .onConflictDoNothing({ target: submissionFailures.requestId });
      },
      undefined,
    );
  }

  async approvalCandidates(limit: number): Promise<ApprovalCandidate[]> {
    return this.guard(
      "approvalCandidates",
      async () => {
        const rows = await this.db
          .select({
            decisionId: approvalQueue.decisionId,
            intentHash: approvalQueue.intentHash,
            rule: approvalQueue.rule,
            thresholdSnapshot: approvalQueue.thresholdSnapshot,
            amount: approvalQueue.amount,
            policyVersionSnapshot: approvalQueue.policyVersionSnapshot,
            escalatedAt: approvalQueue.escalatedAt,
            agentId: intents.agentId,
            serviceId: intents.serviceId,
            purpose: intents.purpose,
            clientRef: intents.clientRef,
          })
          .from(approvalQueue)
          .leftJoin(intents, eq(approvalQueue.intentHash, intents.intentHash))
          .orderBy(desc(approvalQueue.escalatedAt))
          .limit(limit);
        return rows.map((r) => ({
          decisionId: r.decisionId.toString("hex"),
          intentHash: r.intentHash.toString("hex"),
          rule: r.rule,
          thresholdSnapshot: r.thresholdSnapshot,
          amount: r.amount,
          policyVersionSnapshot: r.policyVersionSnapshot,
          escalatedAt: r.escalatedAt,
          agentId: r.agentId ?? undefined,
          serviceId: r.serviceId ?? undefined,
          purpose: r.purpose ?? undefined,
          clientRef: r.clientRef ?? undefined,
        }));
      },
      [],
    );
  }

  async intentByHash(intentHash: string): Promise<IntentRow | undefined> {
    return this.guard(
      "intentByHash",
      async () => {
        const rows = await this.db
          .select()
          .from(intents)
          .where(and(eq(intents.intentHash, hex(intentHash))))
          .limit(1);
        const r = rows[0];
        if (!r) return undefined;
        return {
          intentHash: r.intentHash.toString("hex"),
          agentId: r.agentId,
          serviceId: r.serviceId,
          asset: r.asset,
          amount: r.amount,
          purpose: r.purpose,
          clientRef: r.clientRef,
          canonicalPreimage: r.canonicalPreimage.toString("hex"),
          agentAddress: r.agentAddress,
          assetSac: r.assetSac,
          registryVersion: r.registryVersion,
          requestId: r.requestId,
        };
      },
      undefined,
    );
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }
}

/**
 * No database.
 *
 * **What is lost while this is the active store** — stated plainly, because it is
 * the difference between an evidence pack that verifies and one that asserts:
 *
 * 1. **`purpose` and `client_ref` do not survive the process.** They are hashed
 *    into `intent_hash` and are NOT on chain. §6.1 D2 asks a reviewer to
 *    recompute `intent_hash` from a submitted intent; after a restart there is
 *    nothing left to recompute it from except the pino transcript. The transcript
 *    does carry the full preimage for exactly this reason, so the claim survives
 *    as *"grep the log"* rather than *"query the API"* — weaker, but not broken.
 * 2. **Duplicate-submission detection is per-process.** The chain stays
 *    idempotent on `intent_hash` regardless, so no second decision and no second
 *    payment can result. Only the *report* that a submission was a repeat is lost.
 * 3. **The escalation queue does not survive a restart.** Pending-ness is read
 *    from the chain either way, but the gateway loses its list of WHICH decisions
 *    to ask about, so `GET /v1/approvals` sees only escalations this process
 *    handled. The durable recovery path is the chain's own `DecisionEvent` /
 *    `ResolvedEvent` stream; indexing it is not Phase 1 D2 work.
 * 4. **The escalation-rule snapshot is not durable.** The `amount X > threshold Y`
 *    string §4.1 D2 requires is rendered at escalation time and held in memory. If
 *    the policy threshold changes after a restart, the rule can no longer be shown
 *    as it stood.
 * 5. **Timings and failure forensics are log-only**, so the POST->verdict and
 *    POST->finality numbers cannot be aggregated by query.
 *
 * Nothing here touches whether a decision is correct, reachable, or settleable.
 * The chain is the authority on all three.
 */
class DegradedStore implements IntentStore {
  readonly mode = "degraded" as const;
  private readonly seen = new Map<string, IntentRow>();
  private readonly queue = new Map<string, ApprovalCandidate>();

  /** Enough to keep a demo run intact without turning into a leak. */
  private static readonly CAP = 1000;

  constructor(private readonly log: FastifyBaseLogger) {}

  private trim(map: Map<string, unknown>): void {
    while (map.size > DegradedStore.CAP) {
      const oldest = map.keys().next();
      if (oldest.done) break;
      map.delete(oldest.value);
    }
  }

  async recordIntent(row: IntentRow): Promise<boolean> {
    const isNew = !this.seen.has(row.intentHash);
    this.seen.set(row.intentHash, row);
    this.trim(this.seen);
    return isNew;
  }

  async recordDecision(): Promise<void> {
    // The chain holds it; there is nothing to cache into.
  }

  async enqueueApproval(row: ApprovalRow): Promise<void> {
    const intent = this.seen.get(row.intentHash);
    this.queue.set(row.decisionId, {
      ...row,
      escalatedAt: new Date(),
      agentId: intent?.agentId,
      serviceId: intent?.serviceId,
      purpose: intent?.purpose,
      clientRef: intent?.clientRef,
    });
    this.trim(this.queue);
  }

  async recordFailure(row: FailureRow): Promise<void> {
    this.log.warn(
      { request_id: row.requestId, http_status: row.httpStatus },
      "failure not persisted — running without a database",
    );
  }

  async approvalCandidates(limit: number): Promise<ApprovalCandidate[]> {
    return [...this.queue.values()]
      .sort((a, b) => b.escalatedAt.getTime() - a.escalatedAt.getTime())
      .slice(0, limit);
  }

  async intentByHash(intentHash: string): Promise<IntentRow | undefined> {
    return this.seen.get(intentHash);
  }

  async close(): Promise<void> {}
}

/**
 * Open the store, or degrade.
 *
 * The connection is PROBED at boot rather than lazily: a gateway that looks
 * healthy and then drops evidence on the first request is worse than one that
 * says at startup, once and loudly, that it is running without a database.
 */
export async function openStore(
  databaseUrl: string | undefined,
  log: FastifyBaseLogger,
): Promise<IntentStore> {
  if (!databaseUrl) {
    log.warn(
      { db: "degraded", reason: "DATABASE_URL is not set" },
      "no database configured — serving the chain path only; purpose/client_ref and the escalation queue will not survive this process (see DegradedStore)",
    );
    return new DegradedStore(log);
  }

  const sql = postgres(databaseUrl, {
    max: 8,
    connect_timeout: 5,
    idle_timeout: 30,
    onnotice: () => {},
  });

  try {
    await sql`select 1`;
  } catch (e) {
    // postgres.js reports a refused connection with an empty `message` and the
    // detail in `code`, so report both or the warning says nothing.
    const reason = describeDbError(e);
    log.warn(
      { db: "degraded", reason, url_host: hostOf(databaseUrl) },
      "database unreachable — serving the chain path only; purpose/client_ref and the escalation queue will not survive this process (see DegradedStore)",
    );
    await sql.end({ timeout: 1 }).catch(() => undefined);
    return new DegradedStore(log);
  }

  log.info({ db: "postgres" }, "database connected");
  return new PostgresStore(drizzle(sql), sql, log);
}
