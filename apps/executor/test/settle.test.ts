import { beforeEach, describe, expect, it } from "vitest";
import { Verdict } from "@aegis/bindings";
import { fromHex } from "@aegis/canonical";
import { SettlementError } from "../src/errors.js";
import { __clearLocks } from "../src/lock.js";
import { createExecutor, type Executor } from "../src/settle.js";
import { MemorySettlementStore } from "../src/store/index.js";
import {
  DECISION_ID,
  MERCHANT,
  fakeChain,
  fakeHorizon,
  includedTx,
  makeConfig,
  makeDecision,
  makeRegistry,
  sacFor,
  type FakeChain,
  type FakeHorizon,
} from "./fixtures.js";

interface Harness {
  executor: Executor;
  chain: FakeChain;
  horizon: FakeHorizon;
  store: MemorySettlementStore;
  /** Every store write and chain/Horizon call, interleaved in real order. */
  trace: string[];
}

function harness(chainOverride?: FakeChain): Harness {
  const trace: string[] = [];
  const chain = chainOverride ?? fakeChain();
  const horizon = fakeHorizon();
  const store = new MemorySettlementStore();

  // Wrap so the ORDER of "journal committed" against "mark_settled" and
  // "submit" is observable. Asserting the final state alone would pass for an
  // executor that wrote the journal last.
  const tracedStore = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (prop === "putPrepared" || prop === "replacePrepared") trace.push(`store.${String(prop)}`);
        if (prop === "advance") trace.push(`store.advance:${String(args[1])}`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  const tracedChain: FakeChain = {
    ...chain,
    getDecision: async (...a) => (trace.push("chain.getDecision"), chain.getDecision(...a)),
    memoHash: async (...a) => (trace.push("chain.memoHash"), chain.memoHash(...a)),
    markSettled: async (...a) => (trace.push("chain.markSettled"), chain.markSettled(...a)),
    get decision() {
      return chain.decision;
    },
    calls: chain.calls,
  };

  const tracedHorizon: FakeHorizon = {
    ...horizon,
    submit: async (xdr) => (trace.push("horizon.submit"), horizon.submit(xdr)),
    transaction: async (h) => horizon.transaction(h),
    account: async (id) => horizon.account(id),
    latestLedgerCloseTime: async () => horizon.latestLedgerCloseTime(),
  };

  const executor = createExecutor({
    config: makeConfig(),
    registry: makeRegistry(),
    chain: tracedChain,
    horizon: tracedHorizon,
    store: tracedStore,
    now: () => 1_800_000_000,
    sleep: async () => {},
  });

  return { executor, chain, horizon, store, trace };
}

/** Horizon confirms whatever hash the executor precomputed. */
const acceptOnSubmit = (h: Harness): void => {
  const original = h.horizon.submit.bind(h.horizon);
  h.horizon.submit = async (xdr: string) => {
    const record = await h.store.get(DECISION_ID);
    if (record !== undefined) {
      h.horizon.submitOutcome = { kind: "included", hash: record.txHash, ledger: 5_000_001, successful: true };
      h.horizon.known.set(record.txHash, includedTx(record.txHash));
    }
    return original(xdr);
  };
};

beforeEach(() => __clearLocks());

const expectCode = async (p: Promise<unknown>, code: string): Promise<SettlementError> => {
  const e = await p.then(
    () => { throw new Error(`expected ${code} but the call succeeded`); },
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(SettlementError);
  expect((e as SettlementError).code).toBe(code);
  return e as SettlementError;
};

// ───────────────────────────────────────────────────────── the gate

describe("the gate — every refusal is sourced from the chain or the registry", () => {
  it("DECISION_NOT_FOUND when the contract holds no such decision", async () => {
    const h = harness(fakeChain("not-found"));
    await expectCode(h.executor.settle(DECISION_ID), "DECISION_NOT_FOUND");
    expect(h.trace).not.toContain("chain.markSettled");
  });

  it("NOT_APPROVED for Rejected and for RequiresApproval alike", async () => {
    for (const verdict of [Verdict.Rejected, Verdict.RequiresApproval]) {
      __clearLocks();
      const h = harness(fakeChain(makeDecision({ verdict })));
      const e = await expectCode(h.executor.settle(DECISION_ID), "NOT_APPROVED");
      expect(e.actual).toBe(Verdict[verdict]);
    }
  });

  it("ALREADY_SETTLED — the contract's own flag refuses the replay (§5.2 scenario 7)", async () => {
    const h = harness(fakeChain(makeDecision({ settled: true })));
    const e = await expectCode(h.executor.settle(DECISION_ID), "ALREADY_SETTLED");
    // The refusal must come from the chain, not the journal: this store is empty.
    expect(await h.store.get(DECISION_ID)).toBeUndefined();
    expect(e.actual).toContain("settled == true");
    expect(h.trace).not.toContain("horizon.submit");
  });

  it("ASSET_MISMATCH when the decision's SAC is not the one the asset derives to", async () => {
    const h = harness(fakeChain(makeDecision({ asset: sacFor("EURC", MERCHANT.publicKey()) })));
    await expectCode(h.executor.settle(DECISION_ID), "ASSET_MISMATCH");
  });

  it("AMOUNT_OUT_OF_RANGE when the i128 does not fit the classic int64 rail", async () => {
    const h = harness(fakeChain(makeDecision({ amount: 2n ** 100n })));
    await expectCode(h.executor.settle(DECISION_ID), "AMOUNT_OUT_OF_RANGE");
  });

  it("UNKNOWN_SERVICE when the registry publishes no active destination", async () => {
    const h = harness(fakeChain(makeDecision({ serviceId: "not-registered" })));
    await expectCode(h.executor.settle(DECISION_ID), "UNKNOWN_SERVICE");
  });

  it("MEMO_MISMATCH when the contract's memo_hash view disagrees with the local one", async () => {
    const chain = fakeChain();
    chain.memoOverride = new Uint8Array(32).fill(9);
    const h = harness(chain);
    await expectCode(h.executor.settle(DECISION_ID), "MEMO_MISMATCH");
    expect(h.trace).not.toContain("chain.markSettled");
  });

  it("PREFLIGHT_FAILED when the destination holds no trustline", async () => {
    const h = harness();
    h.horizon.accounts.set(MERCHANT.publicKey(), {
      id: MERCHANT.publicKey(),
      sequence: "1",
      balances: [{ balance: "10", asset_type: "native" }],
    });
    await expectCode(h.executor.settle(DECISION_ID), "PREFLIGHT_FAILED");
    expect(h.trace).not.toContain("chain.markSettled");
  });

  it("PREFLIGHT_FAILED when the executor cannot cover the amount", async () => {
    const h = harness(fakeChain(makeDecision({ amount: 900_000_000_000n })));
    await expectCode(h.executor.settle(DECISION_ID), "PREFLIGHT_FAILED");
  });

  it("re-reads the decision on EVERY call, before touching the journal", async () => {
    const h = harness();
    acceptOnSubmit(h);
    await h.executor.settle(DECISION_ID);
    expect(h.trace[0]).toBe("chain.getDecision");
  });
});

// ──────────────────────────────────────────────────── the ordering

describe("ordering", () => {
  it("commits the envelope, THEN marks settled, THEN submits", async () => {
    const h = harness();
    acceptOnSubmit(h);
    const r = await h.executor.settle(DECISION_ID);

    expect(r.status).toBe("SETTLED");
    const commit = h.trace.indexOf("store.putPrepared");
    const mark = h.trace.indexOf("chain.markSettled");
    const submit = h.trace.indexOf("horizon.submit");
    expect(commit).toBeGreaterThanOrEqual(0);
    // The whole D3 ordering argument, as three integers.
    expect(commit).toBeLessThan(mark);
    expect(mark).toBeLessThan(submit);
  });

  it("never submits when mark_settled fails", async () => {
    const h = harness();
    // The real ChainClient contract is to raise a SettlementError, so the fake
    // raises the one `mark_settled` actually produces when the contract refuses.
    h.chain.markSettledError = new SettlementError(
      "MARK_SETTLED_FAILED",
      "the contract refused mark_settled: AlreadySettled",
    );
    await expectCode(h.executor.settle(DECISION_ID), "MARK_SETTLED_FAILED");
    expect(h.trace).not.toContain("horizon.submit");
    // The prepared record survives, so recovery has a handle on the envelope.
    expect(await h.store.get(DECISION_ID)).toMatchObject({ status: "PREPARED" });
  });

  it("produces a receipt whose memo commitment and chain block come from the chain", async () => {
    const h = harness();
    acceptOnSubmit(h);
    const r = await h.executor.settle(DECISION_ID);
    expect(r.receipt.chain.amount).toBe("125000000");
    expect(r.receipt.chain.decision_id).toBe(DECISION_ID);
    expect(r.receipt.settlement.memo_hash).toBe(r.memoHash);
    expect(r.receipt.settlement.tx_hash).toBe(r.txHash);
    expect(r.receipt.settlement.destination).toBe(MERCHANT.publicKey());
  });
});

// ──────────────────────────────────────────────────────── dry run

describe("--dry-run", () => {
  it("gates, prepares and COMMITS, but neither marks nor submits", async () => {
    const h = harness();
    const r = await h.executor.settle(DECISION_ID, { dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.status).toBe("PREPARED");
    expect(r.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.trace).toContain("store.putPrepared");
    expect(h.trace).not.toContain("chain.markSettled");
    expect(h.trace).not.toContain("horizon.submit");
  });

  it("is repeatable, and the real run resumes the SAME envelope it committed", async () => {
    const h = harness();
    const dry = await h.executor.settle(DECISION_ID, { dryRun: true });
    __clearLocks();
    const dryAgain = await h.executor.settle(DECISION_ID, { dryRun: true });
    expect(dryAgain.txHash).toBe(dry.txHash);

    __clearLocks();
    acceptOnSubmit(h);
    const real = await h.executor.settle(DECISION_ID);
    // A rebuild here would be a second, differently-hashed transaction.
    expect(real.txHash).toBe(dry.txHash);
    expect(real.status).toBe("SETTLED");
    expect(h.horizon.submitted).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────── the recovery matrix

describe("recovery matrix", () => {
  it("PREPARED + chain unsettled: resumes with the STORED envelope, never a new one", async () => {
    const h = harness();
    const prepared = await h.executor.settle(DECISION_ID, { dryRun: true });
    __clearLocks();
    acceptOnSubmit(h);

    const r = await h.executor.recover(DECISION_ID);
    expect(r.txHash).toBe(prepared.txHash);
    expect(r.status).toBe("SETTLED");
    expect(h.trace.filter((t) => t === "store.putPrepared")).toHaveLength(1);
    expect(h.trace.filter((t) => t === "store.replacePrepared")).toHaveLength(0);
  });

  it("PREPARED + chain ALREADY settled: catches the journal up and submits the stored bytes", async () => {
    // The crash landed between mark_settled applying and the journal learning
    // about it. Re-marking is impossible and rebuilding would pay twice.
    const h = harness();
    const prepared = await h.executor.settle(DECISION_ID, { dryRun: true });
    h.chain.decision = makeDecision({ settled: true });
    __clearLocks();
    acceptOnSubmit(h);

    const r = await h.executor.settle(DECISION_ID);
    expect(r.txHash).toBe(prepared.txHash);
    expect(r.status).toBe("SETTLED");
    expect(h.trace).not.toContain("chain.markSettled");
  });

  it("PREPARED + expired + chain unsettled: rebuilding is safe HERE and only here", async () => {
    const h = harness();
    const prepared = await h.executor.settle(DECISION_ID, { dryRun: true });
    // Push the ledger clock past max_time. Nothing was submitted and
    // mark_settled provably never applied, so no money is at risk.
    h.horizon.ledgerCloseTime = prepared.receipt ? 1_800_001_000 : 0;
    __clearLocks();
    acceptOnSubmit(h);

    const r = await h.executor.recover(DECISION_ID);
    expect(h.trace).toContain("store.replacePrepared");
    expect(r.txHash).not.toBe(prepared.txHash);
    expect(r.status).toBe("SETTLED");
  });

  it("MARKED + Horizon timeout: polls the stored hash, and confirms without resubmitting a new one", async () => {
    const h = harness();
    h.horizon.submitOutcome = { kind: "unknown", detail: "Horizon timed out (504)" };
    // The transaction was in fact included; the executor just never heard.
    const original = h.horizon.transaction.bind(h.horizon);
    h.horizon.transaction = async (hash: string) => {
      const record = await h.store.get(DECISION_ID);
      if (record !== undefined && hash === record.txHash) return includedTx(hash);
      return original(hash);
    };

    const r = await h.executor.settle(DECISION_ID);
    expect(r.status).toBe("SETTLED");
    expect(r.ledger).toBe(5_000_001);
    expect(h.horizon.submitted).toHaveLength(1);
  });

  it("timeout + max_time passed + hash still absent: NON_INCLUSION_PROVEN, and the record is ABANDONED", async () => {
    const h = harness();
    h.horizon.submitOutcome = { kind: "unknown", detail: "Horizon timed out (504)" };
    const prepared = await h.executor.settle(DECISION_ID, { dryRun: true });
    expect(prepared.status).toBe("PREPARED");
    __clearLocks();

    // The ledger clock is moved past max_time only AFTER the envelope is built,
    // so the proof is about a transaction that was genuinely eligible.
    let calls = 0;
    h.horizon.latestLedgerCloseTime = async () => (++calls > 1 ? 1_800_001_000 : 1_800_000_000);

    await expectCode(h.executor.recover(DECISION_ID), "NON_INCLUSION_PROVEN");
    expect(await h.store.get(DECISION_ID)).toMatchObject({ status: "ABANDONED" });
  });

  it("an ABANDONED attempt is terminal — it is never retried automatically", async () => {
    const h = harness();
    await h.executor.settle(DECISION_ID, { dryRun: true });
    await h.store.advance(DECISION_ID, "ABANDONED", { note: "non-inclusion proven" });
    h.chain.decision = makeDecision({ settled: true });
    __clearLocks();
    // The chain says settled and the journal record is terminal, so this reads
    // as a replay and the contract's flag is what refuses it.
    await expectCode(h.executor.settle(DECISION_ID), "ALREADY_SETTLED");
  });

  it("included but unsuccessful: no payment moved, so the attempt is ABANDONED, not settled", async () => {
    const h = harness();
    h.horizon.submit = async () => {
      const record = await h.store.get(DECISION_ID);
      return { kind: "included", hash: record?.txHash ?? "", ledger: 5_000_002, successful: false };
    };
    await expectCode(h.executor.settle(DECISION_ID), "SUBMIT_FAILED");
    expect(await h.store.get(DECISION_ID)).toMatchObject({ status: "ABANDONED", ledger: 5_000_002 });
  });

  it("recover() refuses to invent an attempt where none was stored", async () => {
    const h = harness();
    await expectCode(h.executor.recover(DECISION_ID), "STORE_CONFLICT");
  });
});

// ───────────────────────────────────────────────── config vs registry

describe("the registry outranks the environment", () => {
  it("refuses a CONTRACT_ID the registry does not publish", async () => {
    const executor = createExecutor({
      config: makeConfig({ contractId: "C" + "A".repeat(55) }),
      registry: makeRegistry(),
      chain: fakeChain(),
      horizon: fakeHorizon(),
      store: new MemorySettlementStore(),
    });
    await expectCode(executor.settle(DECISION_ID), "CONTRACT_MISMATCH");
  });

  it("refuses an EXECUTOR_SECRET that is not the published executor account", async () => {
    const executor = createExecutor({
      config: makeConfig(),
      registry: makeRegistry({ executorAccount: MERCHANT.publicKey() }),
      chain: fakeChain(),
      horizon: fakeHorizon(),
      store: new MemorySettlementStore(),
    });
    await expectCode(executor.settle(DECISION_ID), "SOURCE_MISMATCH");
  });
});

describe("the journal cannot influence money", () => {
  it("stores no amount, asset, destination-of-record or verdict", async () => {
    const h = harness();
    await h.executor.settle(DECISION_ID, { dryRun: true });
    const record = await h.store.get(DECISION_ID);
    // Everything money-relevant must come from get_decision on every run. The
    // only free-text field is `note`, which is never read back as an input.
    expect(Object.keys(record ?? {}).sort()).toEqual(
      ["createdAt", "decisionId", "envelopeXdr", "maxTime", "note", "sequence", "source", "status", "txHash", "updatedAt"],
    );
  });

  it("holds a per-decision lock so two concurrent settles cannot both prepare", async () => {
    const h = harness();
    acceptOnSubmit(h);
    const first = h.executor.settle(DECISION_ID);
    const second = h.executor.settle(DECISION_ID);
    await expectCode(second, "LOCK_HELD");
    await first;
  });
});

describe("decision_id validation", () => {
  it("refuses anything that is not 64 hex characters", async () => {
    const h = harness();
    await expectCode(h.executor.settle("not-a-hash"), "CONFIG_INVALID");
    await expectCode(h.executor.settle(fromHex(DECISION_ID).length === 32 ? "ab" : ""), "CONFIG_INVALID");
  });
});
