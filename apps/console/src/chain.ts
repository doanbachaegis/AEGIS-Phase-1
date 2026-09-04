/**
 * 🔑 INVARIANT: everything in this file reads DIRECTLY from Soroban RPC.
 *
 * §6.3: "Every decision can be read on-chain by contract ID, independently of
 * the AEGIS database." Adding a single fetch to the AEGIS API here would break
 * the strongest piece of evidence in the whole project.
 *
 * NON-authoritative data (purpose, client_ref) goes through `./aegisApi.ts`
 * and must be labelled separately in the UI.
 */

import { Buffer } from "buffer";
import { Client, Errors, rpc } from "@aegis/bindings";
import type { Decision, Policy, WindowState } from "@aegis/bindings";
import { AgentStatus, ReasonCode, Verdict } from "@aegis/bindings";
import { env } from "./env.js";

/**
 * Read-only, unsigned, unsubmitted.
 *
 * No `publicKey` and no `signTransaction`: the SDK substitutes a null source
 * account and every call below stops at `simulateTransaction`. That is not a
 * limitation being worked around — it IS the evidence. A reviewer with no key,
 * no account and no relationship to AEGIS can reproduce every number on this
 * page. `signAndSend()` is never called anywhere in this app.
 */
function client(): Client {
  return new Client({
    contractId: env.contractId,
    networkPassphrase: env.networkPassphrase,
    rpcUrl: env.rpcUrl,
    allowHttp: env.rpcUrl.startsWith("http://"),
  });
}

/** A 32-byte value in lowercase hex, as it appears in every AEGIS artifact. */
export type Hex32 = string;

const HEX32 = /^[0-9a-f]{64}$/;

/** Accepts an optional 0x prefix and any casing; returns null if it is not 32 bytes of hex. */
export function normalizeRef(ref: string): Hex32 | null {
  const v = ref.trim().replace(/^0x/i, "").toLowerCase();
  return HEX32.test(v) ? v : null;
}

function toBytes32(hex: Hex32): Buffer {
  return Buffer.from(hex, "hex");
}

function toHex(b: Buffer | Uint8Array): Hex32 {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * A genuine transport failure: the RPC endpoint is unreachable, rate-limiting, or
 * answering with something that is not a contract result. These are the ONLY
 * failures TanStack Query should retry — see `absent` below.
 */
export class ChainTransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChainTransportError";
  }
}

/**
 * The contract's own "no such decision" answer.
 *
 * `get_decision` / `decision_by_intent` return `Result<Decision, Error>`, and a miss is
 * `Err(DecisionNotFound)` — a normal answer from a healthy contract, not a failure of
 * the RPC endpoint. Modelling it as a STATUS rather than a thrown error is what keeps
 * TanStack's `retry` from hammering the endpoint three times over a reference that
 * simply does not exist, while a genuine transport failure still retries.
 *
 * `archived` is deliberately a third case: an entry Soroban expired is not the same
 * claim as an entry that never existed, and an evidence console must not conflate them.
 */
export type DecisionLookup =
  | { status: "found"; decision: ChainDecision; via: "intent" | "decision" }
  | { status: "absent"; reason: string }
  | { status: "archived"; reason: string };

export interface ChainDecision {
  decisionId: Hex32;
  intentHash: Hex32;
  agent: string;
  serviceId: string;
  /** SAC address of the asset. Phase 1: testnet USDC. */
  asset: string;
  /** stroops, kept as bigint — never parse into a number */
  amount: bigint;
  /**
   * The version that PRODUCED this decision. Frozen for life: it is bound into
   * `decision_id` and `memo_hash`, so the contract cannot be asked what its values
   * were (DECISIONS.md #4, #9).
   */
  policyVersion: number;
  /** The version `resolve()` re-judged against, or null while never resolved (DECISIONS.md #9). */
  resolvedPolicyVersion: number | null;
  verdict: Verdict;
  /** The CURRENT (final) code. `resolve()` overwrites it. */
  reasonCode: ReasonCode;
  /** Recorded once at `authorize()` time and never rewritten (DECISIONS.md #8). */
  originalReasonCode: ReasonCode;
  ledgerSeq: number;
  resolved: boolean;
  settled: boolean;
}

function toChainDecision(d: Decision): ChainDecision {
  return {
    decisionId: toHex(d.decision_id),
    intentHash: toHex(d.intent_hash),
    agent: d.agent,
    serviceId: d.service_id,
    asset: d.asset,
    amount: d.amount,
    policyVersion: d.policy_version,
    resolvedPolicyVersion: d.resolved_policy_version ?? null,
    verdict: d.verdict,
    reasonCode: d.reason_code,
    originalReasonCode: d.original_reason_code,
    ledgerSeq: d.ledger_seq,
    resolved: d.resolved,
    settled: d.settled,
  };
}

/**
 * Soroban expires persistent entries that nobody pays rent on. An archived decision
 * is not the same claim as a decision that never existed, and a console that
 * conflated the two would be asserting something false about the chain.
 */
const ARCHIVED = /archiv|restorePreamble|entry expired|MissingValue|ExistenceError|TTL/i;

const ARCHIVED_REASON =
  "The contract entry for this reference has been archived by Soroban state expiry. " +
  "It existed; it is no longer readable without a restore. This is not the same as 'not found'.";

function classifyThrow(where: string, err: unknown): DecisionLookup {
  const message = err instanceof Error ? err.message : String(err);
  if (ARCHIVED.test(message)) {
    return { status: "archived", reason: ARCHIVED_REASON };
  }
  throw new ChainTransportError(`${where} failed against ${env.rpcUrl}: ${message}`, err);
}

/**
 * The contract error behind a failed simulation, by NAME, or null if the simulation
 * succeeded or failed for some other reason.
 *
 * ⚠️ Do NOT use `tx.result.unwrapErr().message` for this. The SDK builds its error table
 * from the ABI with `{ [case.value()]: { message: case.doc().toString() } }` — the DOC
 * COMMENT, not the case name. `DecisionNotFound` carries no doc comment in the contract,
 * so that message is the empty string, and "not found" would be indistinguishable from
 * every other undocumented error. The numeric discriminant is unambiguous, and
 * `Errors` — regenerated from the wasm by `pnpm bindings` and committed — maps it back
 * to the identifier. A renumbered error therefore moves with the ABI instead of silently
 * changing what this console claims.
 */
const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

interface Simulated<T> {
  /** `SimulateTransactionResponse`, kept as unknown: its union has arms with no `error`. */
  simulation?: unknown;
  result: { isOk(): boolean; unwrap(): T; unwrapErr(): { message: string } };
}

function simulationOf(tx: Simulated<unknown>): Record<string, unknown> | null {
  return typeof tx.simulation === "object" && tx.simulation !== null
    ? (tx.simulation as Record<string, unknown>)
    : null;
}

function simulationError(tx: Simulated<unknown>): string | null {
  const error = simulationOf(tx)?.["error"];
  return typeof error === "string" && error.length > 0 ? error : null;
}

/**
 * RPC answers a read over an expired persistent entry with a `restorePreamble` rather
 * than an error. Reported as `archived` only when no value came back with it — if the
 * value is readable, the decision is readable, and that is what the page should say.
 */
function needsRestore(tx: Simulated<unknown>): boolean {
  const preamble = simulationOf(tx)?.["restorePreamble"];
  return preamble !== undefined && preamble !== null;
}

export function contractErrorName(simError: string): string | null {
  const match = CONTRACT_ERROR.exec(simError);
  if (match?.[1] === undefined) return null;
  const table = Errors as Record<number, { message: string } | undefined>;
  return table[Number(match[1])]?.message ?? null;
}

async function lookup(
  via: "intent" | "decision",
  run: () => Promise<Simulated<Decision>>,
): Promise<DecisionLookup> {
  const label = via === "intent" ? "decision_by_intent" : "get_decision";

  let tx: Simulated<Decision>;
  try {
    tx = await run();
  } catch (err) {
    return classifyThrow(label, err);
  }

  const simError = simulationError(tx);
  if (simError === null && needsRestore(tx) && !tx.result.isOk()) {
    return { status: "archived", reason: ARCHIVED_REASON };
  }
  if (simError !== null) {
    if (ARCHIVED.test(simError)) {
      return { status: "archived", reason: ARCHIVED_REASON };
    }

    const name = contractErrorName(simError);
    if (name === "DecisionNotFound") {
      return {
        status: "absent",
        reason:
          "The contract answered DecisionNotFound — no decision is stored under this reference.",
      };
    }
    if (name === "NotInitialized") {
      throw new ChainTransportError(
        `Contract ${env.contractId} answered NotInitialized. It is deployed but \`init\` was ` +
          `never invoked as its own call, or VITE_CONTRACT_ID points at a different instance.`,
      );
    }
    if (name !== null) {
      return { status: "absent", reason: `The contract answered ${name}.` };
    }
    throw new ChainTransportError(`${label} simulation failed against ${env.rpcUrl}: ${simError}`);
  }

  // The simulation succeeded, so the return value is an Ok(Decision). The Err arm is
  // unreachable in practice — the host escalates a contract Err into a trap, which is the
  // branch above — but a mis-simulated read must not be reported as a found decision.
  if (!tx.result.isOk()) {
    return {
      status: "absent",
      reason: `${label} simulated cleanly but returned no decision.`,
    };
  }

  return { status: "found", decision: toChainDecision(tx.result.unwrap()), via };
}

export async function fetchDecisionByIntent(intentHash: Hex32): Promise<DecisionLookup> {
  const c = client();
  return lookup("intent", () => c.decision_by_intent({ intent_hash: toBytes32(intentHash) }));
}

export async function fetchDecisionById(decisionId: Hex32): Promise<DecisionLookup> {
  const c = client();
  return lookup("decision", () => c.get_decision({ decision_id: toBytes32(decisionId) }));
}

/**
 * `sha256(intent_hash || policy_version_be || decision_id)` computed BY THE CONTRACT.
 * The verifier compares this against the settle transaction's real MEMO_HASH, so it
 * has to come from the chain and not from a local recomputation.
 */
export async function fetchMemoHash(decisionId: Hex32): Promise<Hex32 | null> {
  const c = client();
  try {
    const res = (await c.memo_hash({ decision_id: toBytes32(decisionId) })).result;
    return res.isOk() ? toHex(res.unwrap()) : null;
  } catch {
    return null;
  }
}

/**
 * ⚠️ This is the CURRENT policy for the agent, which is not necessarily the policy
 * that produced the decision. `set_policy` bumps the version and existing decisions
 * keep their own frozen `policy_version` (§6.3, DECISIONS.md #9). The UI must say so
 * rather than presenting today's threshold as the rule that fired.
 */
export interface CurrentPolicy {
  agent: string;
  owner: string;
  allowedAsset: string;
  allowedServices: readonly string[];
  approvalThreshold: bigint;
  perIntentCap: bigint;
  cumulativeWindowCap: bigint;
  windowSeconds: bigint;
  status: AgentStatus;
  version: number;
}

function toCurrentPolicy(p: Policy): CurrentPolicy {
  return {
    agent: p.agent,
    owner: p.owner,
    allowedAsset: p.allowed_asset,
    allowedServices: p.allowed_services,
    approvalThreshold: p.approval_threshold,
    perIntentCap: p.per_intent_cap,
    cumulativeWindowCap: p.cumulative_window_cap,
    windowSeconds: p.window_seconds,
    status: p.status,
    version: p.version,
  };
}

export async function fetchCurrentPolicy(agent: string): Promise<CurrentPolicy | null> {
  const c = client();
  try {
    const res = (await c.get_policy({ agent })).result;
    return res.isOk() ? toCurrentPolicy(res.unwrap()) : null;
  } catch {
    return null;
  }
}

/** Effective spend for the agent's CURRENT tumbling window — also a "today" value, not a decision-time one. */
export interface CurrentWindow {
  spent: bigint;
  windowStart: bigint;
}

export async function fetchCurrentWindow(agent: string): Promise<CurrentWindow | null> {
  const c = client();
  try {
    const res = (await c.get_window({ agent })).result;
    if (!res.isOk()) return null;
    const w: WindowState = res.unwrap();
    return { spent: w.spent, windowStart: w.window_start };
  } catch {
    return null;
  }
}

/** Proof that the numbers above were read from a live ledger, not a fixture. */
export async function fetchLatestLedger(): Promise<number | null> {
  try {
    const server = new rpc.Server(env.rpcUrl, { allowHttp: env.rpcUrl.startsWith("http://") });
    return (await server.getLatestLedger()).sequence;
  } catch {
    return null;
  }
}

/** Everything the evidence page needs, read from the contract in one pass. */
export interface Evidence {
  ref: Hex32;
  lookup: DecisionLookup;
  memoHash: Hex32 | null;
  policy: CurrentPolicy | null;
  window: CurrentWindow | null;
  latestLedger: number | null;
}

/**
 * A reviewer pastes whatever reference they were given. Both a 32-byte intent hash
 * and a 32-byte decision id look identical, so try the one the URL implies first and
 * then the other — a shared link must resolve rather than dead-end on the wrong verb.
 */
export async function fetchEvidence(
  ref: Hex32,
  prefer: "intent" | "decision" = "intent",
): Promise<Evidence> {
  const first = prefer === "intent" ? fetchDecisionByIntent : fetchDecisionById;
  const second = prefer === "intent" ? fetchDecisionById : fetchDecisionByIntent;

  let lookup = await first(ref);
  if (lookup.status === "absent") {
    const fallback = await second(ref);
    if (fallback.status !== "absent") lookup = fallback;
  }

  if (lookup.status !== "found") {
    return { ref, lookup, memoHash: null, policy: null, window: null, latestLedger: await fetchLatestLedger() };
  }

  // Supporting reads degrade to null instead of failing the page: the decision itself
  // is the authoritative artifact, and it has already been read successfully.
  const [memoHash, policy, window, latestLedger] = await Promise.all([
    fetchMemoHash(lookup.decision.decisionId),
    fetchCurrentPolicy(lookup.decision.agent),
    fetchCurrentWindow(lookup.decision.agent),
    fetchLatestLedger(),
  ]);

  return { ref, lookup, memoHash, policy, window, latestLedger };
}

export const stellarExpert = {
  contract: (id: string) =>
    `https://stellar.expert/explorer/${env.stellarExpertNetwork}/contract/${id}`,
  tx: (hash: string) => `https://stellar.expert/explorer/${env.stellarExpertNetwork}/tx/${hash}`,
  account: (id: string) =>
    `https://stellar.expert/explorer/${env.stellarExpertNetwork}/account/${id}`,
  asset: (sac: string) =>
    `https://stellar.expert/explorer/${env.stellarExpertNetwork}/contract/${sac}`,
};
