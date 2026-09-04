/**
 * Test doubles for the two public data sources.
 *
 * They are scripted, not mocked: each records what was asked of it in order, so
 * a test can assert the ORDERING rules the executor exists to enforce —
 * "the journal was committed before mark_settled" and "mark_settled was applied
 * before the payment was submitted" — rather than merely asserting the final
 * state, which both a correct and a dangerously incorrect executor would reach.
 */
import { Asset, Keypair, Verdict } from "@aegis/bindings";
import { fromHex, memoHash } from "@aegis/canonical";
import type { ChainClient, MarkSettledResult, OnChainDecision } from "../src/chain.js";
import type { ExecutorConfig } from "../src/config.js";
import type {
  HorizonAccount,
  HorizonClient,
  HorizonTransaction,
  SubmitOutcome,
} from "../src/horizon.js";
import type { ServiceRegistry } from "../src/registry.js";

export const NETWORK = "Test SDF Network ; September 2015";

export const DECISION_ID = "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e";
export const INTENT_HASH = "c51c74d5c445350d848e85fe3bb9cb1949fb73675893a09e654126bfb93b7a10";

/** Deterministic keys so a failing test prints a stable address. */
export const EXECUTOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
export const OPERATOR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
export const MERCHANT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
export const AGENT = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
export const ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));

export const CONTRACT_ID = "CAAD6727VZDKH77IVZJ526B3YENMMU26DGHUEU3B4D6KK3JS5YTNTRPP";

/** Derived, exactly as the executor derives it — so the ASSET_MISMATCH gate is real. */
export const sacFor = (code: string, issuer: string): string =>
  new Asset(code, issuer).contractId(NETWORK);

export function makeDecision(overrides: Partial<OnChainDecision> = {}): OnChainDecision {
  return {
    decisionId: fromHex(DECISION_ID),
    intentHash: fromHex(INTENT_HASH),
    agent: AGENT.publicKey(),
    serviceId: "openai-api",
    asset: sacFor("USDC", ISSUER.publicKey()),
    amount: 125_000_000n,
    policyVersion: 1,
    verdict: Verdict.Approved,
    settled: false,
    resolved: false,
    ledgerSeq: 4_494_345,
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<ExecutorConfig> = {}): ExecutorConfig {
  return {
    networkPassphrase: NETWORK,
    rpcUrl: "https://rpc.example",
    horizonUrl: "https://horizon.example",
    contractId: CONTRACT_ID,
    executor: EXECUTOR,
    operator: OPERATOR,
    registryPath: "/fixture/services.json",
    databasePath: ":memory:",
    timeoutSeconds: 180,
    ...overrides,
  };
}

export function makeRegistry(overrides: Partial<ServiceRegistry> = {}): ServiceRegistry {
  const base: ServiceRegistry = {
    path: "/fixture/services.json",
    registryHash: "0".repeat(64),
    registryVersion: 1,
    networkPassphrase: NETWORK,
    contractId: CONTRACT_ID,
    executorAccount: EXECUTOR.publicKey(),
    asset: { code: "USDC", issuer: ISSUER.publicKey(), sac: sacFor("USDC", ISSUER.publicKey()) },
    destinationFor: (serviceId) => (serviceId === "openai-api" ? MERCHANT.publicKey() : undefined),
  };
  return { ...base, ...overrides };
}

export interface FakeChain extends ChainClient {
  calls: string[];
  decision: OnChainDecision | "not-found";
  markSettledLedger: number;
  /** Overrides the memo the "contract" reports, to exercise MEMO_MISMATCH. */
  memoOverride?: Uint8Array;
  markSettledError?: Error;
}

export function fakeChain(initial: OnChainDecision | "not-found" = makeDecision()): FakeChain {
  const self: FakeChain = {
    calls: [],
    decision: initial,
    markSettledLedger: 5_000_000,
    async getDecision() {
      self.calls.push("getDecision");
      return self.decision;
    },
    async memoHash() {
      self.calls.push("memoHash");
      if (self.memoOverride !== undefined) return self.memoOverride;
      if (self.decision === "not-found") throw new Error("DecisionNotFound");
      const d = self.decision;
      return memoHash(d.intentHash, d.policyVersion, d.decisionId);
    },
    async markSettled(): Promise<MarkSettledResult> {
      self.calls.push("markSettled");
      if (self.markSettledError !== undefined) throw self.markSettledError;
      if (self.decision !== "not-found") self.decision = { ...self.decision, settled: true };
      return { ledger: self.markSettledLedger, txHash: "ab".repeat(32) };
    },
  };
  return self;
}

export interface FakeHorizon extends HorizonClient {
  calls: string[];
  /** Envelopes POSTed, in order. A second DISTINCT entry means a rebuild happened. */
  submitted: string[];
  ledgerCloseTime: number;
  submitOutcome: SubmitOutcome;
  /** Hashes Horizon will admit to knowing about. */
  known: Map<string, HorizonTransaction>;
  accounts: Map<string, HorizonAccount>;
}

const account = (id: string, balances: HorizonAccount["balances"], sequence = "100"): HorizonAccount => ({
  id,
  sequence,
  balances,
});

export function fakeHorizon(): FakeHorizon {
  const usdc = (balance: string) => ({
    balance,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER.publicKey(),
    is_authorized: true,
  });
  const self: FakeHorizon = {
    calls: [],
    submitted: [],
    ledgerCloseTime: 1_800_000_000,
    submitOutcome: { kind: "included", hash: "", ledger: 5_000_001, successful: true },
    known: new Map(),
    accounts: new Map([
      [
        EXECUTOR.publicKey(),
        account(EXECUTOR.publicKey(), [usdc("1000.0000000"), { balance: "9421.0000000", asset_type: "native" }]),
      ],
      [MERCHANT.publicKey(), account(MERCHANT.publicKey(), [usdc("0.0000000")])],
    ]),
    async account(id) {
      self.calls.push(`account:${id}`);
      return self.accounts.get(id) ?? "not-found";
    },
    async transaction(hash) {
      self.calls.push(`transaction:${hash}`);
      return self.known.get(hash) ?? "not-found";
    },
    async submit(envelopeXdr) {
      self.calls.push("submit");
      self.submitted.push(envelopeXdr);
      return self.submitOutcome;
    },
    async latestLedgerCloseTime() {
      self.calls.push("latestLedgerCloseTime");
      return self.ledgerCloseTime;
    },
  };
  return self;
}

export const includedTx = (hash: string, ledger = 5_000_001, successful = true): HorizonTransaction => ({
  hash,
  ledger,
  successful,
  created_at: "2026-09-04T12:00:00Z",
  source_account: EXECUTOR.publicKey(),
  memo_type: "hash",
});
