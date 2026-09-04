/**
 * The contract side of settlement.
 *
 * Three operations, and the split between them is the whole security model:
 *
 * - `getDecision` — a SIMULATION. It is the re-read that SOW §4.1 D3 requires,
 *   and it is what every gate is judged against. It is re-run on every attempt,
 *   including retries and recoveries.
 * - `memoHash` — the contract's own `sha256(intent_hash || policy_version ||
 *   decision_id)`, computed in Rust. Compared against the value
 *   `@aegis/canonical` computes in TypeScript, so a bug in either one is a
 *   refusal rather than a settlement nobody can verify.
 * - `markSettled` — the ONLY state-changing call this executor is allowed to
 *   make. It is irreversible: there is no `unmark_settled`.
 *
 * `caller` is the operator, not the executor account. The contract accepts only
 * the owner or the configured operator and returns `#4 NotAuthorizedCaller`
 * otherwise, so this is enforced on chain and not a local convention.
 */
import { Buffer } from "node:buffer";
import {
  type Decision,
  Keypair,
  Verdict,
  contract as contractNs,
  Client as AuthorizationClient,
} from "@aegis/bindings";
import { SettlementError } from "./errors.js";

/** `Error::DecisionNotFound` — contracts/authorization/src/error.rs, discriminant 6. */
const NOT_FOUND = "DecisionNotFound";

/**
 * The discriminant, matched out of the raw trap text.
 *
 * Do NOT rely on the variant name alone. The SDK rebuilds its error table from
 * the contract spec's DOC COMMENTS rather than the variant names, so
 * `unwrapErr().message` carries the prose — and for a variant with no doc
 * comment it is the empty string. A name-only match silently never fires, which
 * turns a permanent "no such decision" into a retryable SOURCE_UNAVAILABLE and
 * sends a recovery loop round forever.
 */
const NOT_FOUND_DISCRIMINANT = 6;
const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

/** The unparsed simulation error, which still carries `Error(Contract, #N)`. */
const rawSimulationError = (tx: unknown): string => {
  const sim = (tx as { simulation?: { error?: unknown } } | undefined)?.simulation;
  return typeof sim?.error === "string" ? sim.error : "";
};

/** True when `text` names DecisionNotFound, by discriminant or by name. */
const readsAsNotFound = (text: string): boolean => {
  const m = CONTRACT_ERROR.exec(text);
  if (m?.[1] !== undefined) return Number(m[1]) === NOT_FOUND_DISCRIMINANT;
  return text.includes(NOT_FOUND);
};

/** The decision as the contract holds it, normalized to plain JS types. */
export interface OnChainDecision {
  decisionId: Uint8Array;
  intentHash: Uint8Array;
  agent: string;
  serviceId: string;
  /** SAC address, `C…`. */
  asset: string;
  /** Stroops. bigint end to end — an i128 does not survive a JS number. */
  amount: bigint;
  policyVersion: number;
  verdict: Verdict;
  settled: boolean;
  resolved: boolean;
  ledgerSeq: number;
}

export interface MarkSettledResult {
  /** The ledger `mark_settled` was applied in. Evidence for the ordering check. */
  ledger: number;
  txHash: string;
}

export interface ChainClient {
  getDecision(decisionId: Uint8Array): Promise<OnChainDecision | "not-found">;
  memoHash(decisionId: Uint8Array): Promise<Uint8Array>;
  markSettled(decisionId: Uint8Array): Promise<MarkSettledResult>;
}

const normalize = (d: Decision): OnChainDecision => ({
  decisionId: Uint8Array.from(d.decision_id),
  intentHash: Uint8Array.from(d.intent_hash),
  agent: d.agent,
  serviceId: d.service_id,
  asset: d.asset,
  amount: BigInt(d.amount),
  policyVersion: Number(d.policy_version),
  verdict: d.verdict,
  settled: d.settled === true,
  resolved: d.resolved === true,
  ledgerSeq: Number(d.ledger_seq),
});

const mentionsNotFound = (e: unknown): boolean =>
  readsAsNotFound(String((e as Error | undefined)?.message ?? ""));

export function connect(options: {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  operator: Keypair;
}): ChainClient {
  const { contractId, rpcUrl, networkPassphrase, operator } = options;

  const client = new AuthorizationClient({
    contractId,
    rpcUrl,
    networkPassphrase,
    publicKey: operator.publicKey(),
    ...contractNs.basicNodeSigner(operator, networkPassphrase),
  });

  return {
    async getDecision(decisionId) {
      let result;
      let tx;
      try {
        tx = await client.get_decision({ decision_id: Buffer.from(decisionId) });
        result = tx.result;
      } catch (cause) {
        // A simulation that trapped on DecisionNotFound is an ANSWER, not an
        // outage, and the two must never be conflated: one is a refusal, the
        // other is a reason to retry later.
        if (mentionsNotFound(cause)) return "not-found";
        throw new SettlementError("SOURCE_UNAVAILABLE", "could not read the decision from Soroban RPC", { cause });
      }
      if (result.isErr()) {
        const message = result.unwrapErr().message;
        // `message` is the spec's doc comment, not the variant name, so classify
        // on the raw simulation text, which still carries `Error(Contract, #N)`.
        if (readsAsNotFound(rawSimulationError(tx)) || readsAsNotFound(message)) return "not-found";
        throw new SettlementError("SOURCE_UNAVAILABLE", `the contract returned ${message} from get_decision`);
      }
      return normalize(result.unwrap());
    },

    async memoHash(decisionId) {
      let result;
      try {
        const tx = await client.memo_hash({ decision_id: Buffer.from(decisionId) });
        result = tx.result;
      } catch (cause) {
        if (mentionsNotFound(cause)) {
          throw new SettlementError("DECISION_NOT_FOUND", "the contract holds no decision under this id");
        }
        throw new SettlementError("SOURCE_UNAVAILABLE", "could not read memo_hash from Soroban RPC", { cause });
      }
      if (result.isErr()) {
        const message = result.unwrapErr().message;
        if (message.includes(NOT_FOUND)) {
          throw new SettlementError("DECISION_NOT_FOUND", "the contract holds no decision under this id");
        }
        throw new SettlementError("SOURCE_UNAVAILABLE", `the contract returned ${message} from memo_hash`);
      }
      return Uint8Array.from(result.unwrap());
    },

    /**
     * ⚠️ IRREVERSIBLE. There is no `unmark_settled`: a decision marked settled
     * with no payment behind it is a permanent orphan. Every gate runs before
     * this is reached, and the prepared envelope is already durably committed,
     * so the only window this opens is a NON-payment one — recoverable by
     * re-POSTing bytes that already exist.
     */
    async markSettled(decisionId) {
      let assembled;
      try {
        assembled = await client.mark_settled({
          caller: operator.publicKey(),
          decision_id: Buffer.from(decisionId),
        });
      } catch (cause) {
        throw new SettlementError("MARK_SETTLED_FAILED", "mark_settled failed to simulate", { cause });
      }
      // The simulation is a real gate: AlreadySettled (#9), NotApproved (#10),
      // AgentRevoked (#12) and NotAuthorizedCaller (#4) all surface here,
      // BEFORE anything is submitted and before any money can move.
      if (assembled.result.isErr()) {
        const message = assembled.result.unwrapErr().message;
        throw new SettlementError("MARK_SETTLED_FAILED", `the contract refused mark_settled: ${message}`, {
          expected: "an Approved, unsettled decision",
          actual: message,
        });
      }

      let sent;
      try {
        sent = await assembled.signAndSend();
      } catch (cause) {
        throw new SettlementError("MARK_SETTLED_FAILED", "mark_settled could not be submitted", { cause });
      }
      const response = sent.getTransactionResponse;
      if (response === undefined || response.status !== "SUCCESS") {
        throw new SettlementError(
          "MARK_SETTLED_FAILED",
          "mark_settled was submitted but is not confirmed applied",
          { expected: "SUCCESS", actual: response?.status ?? "no response" },
        );
      }
      return { ledger: Number(response.ledger), txHash: response.txHash };
    },
  };
}
