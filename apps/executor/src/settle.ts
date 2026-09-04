/**
 * The decision-gated settlement state machine (D3).
 *
 * ═══ THE TWO ORDERING RULES ═══
 *
 * **1. Re-read first, always.** The first thing `settle()` does after taking the
 * per-decision lock is read the decision back from the contract by simulation
 * and gate on it. Not from the journal, not from a cache, not from the caller —
 * SOW §4.1 D3 requires that the executor does not trust the application
 * database, and this module is built so that it structurally *cannot*: the
 * journal has no column for an amount, an asset or a verdict.
 *
 * **2. `mark_settled` before the payment, and the prepared envelope committed
 * before `mark_settled`.** Both orderings are chosen against a specific failure,
 * and the reasoning is worth stating because the intuitive orderings are wrong:
 *
 *   - *Payment first, then `mark_settled`* leaves, on a crash in between, an
 *     Approved-and-unsettled decision. Any restart re-reads it, sees a payable
 *     decision, and **pays again** — SOW §5.2 scenario 7, the exact failure
 *     being scored. The window it opens is a DOUBLE-payment window.
 *   - *`mark_settled` first* leaves, on a crash in between, a decision recorded
 *     as settled with no money behind it. The window it opens is a
 *     NON-payment window: visible, reconcilable, and harmless to the payer.
 *     A missing payment can be investigated; a duplicate one cannot be recalled.
 *   - *Committing the envelope before `mark_settled`* is what makes even that
 *     window recoverable. After the crash the tx hash and the exact signed bytes
 *     are on disk, so recovery re-POSTs or polls rather than rebuilding.
 *
 * `mark_settled` is IRREVERSIBLE — there is no `unmark_settled` — so every gate
 * runs, and the envelope is durably committed, before it is ever reached.
 *
 * ═══ THE RECOVERY RULE ═══
 *
 * On a timeout the executor NEVER rebuilds and NEVER resubmits under a new
 * sequence number. A rebuild produces a second, differently-hashed transaction,
 * and if the first one was in fact included, both pay. The stored envelope is
 * re-POSTed byte for byte (idempotent: same hash) or the stored hash is polled.
 *
 * `maxTime` is what turns "unknown" into proof. Once Horizon's latest ledger has
 * closed after `max_time` and the hash still 404s, the transaction can never be
 * included by any validator, so non-inclusion is PROVEN rather than assumed.
 * The only retry that is legitimate at that point is a fee bump, which preserves
 * the inner transaction's hash and is therefore not a second payment.
 */
import { Verdict } from "@aegis/bindings";
import { fromHex, memoHash as computeMemoHash, parseAmount, toHex } from "@aegis/canonical";
import type { Receipt } from "@aegis/receipt";
import type { ChainClient, OnChainDecision } from "./chain.js";
import type { ExecutorConfig } from "./config.js";
import { SettlementError } from "./errors.js";
import { horizonClient, trustline, type HorizonClient } from "./horizon.js";
import { withLock, LockBusyError } from "./lock.js";
import { assertPayableAmount, deriveSac, preparePayment, PAYMENT_FEE_STROOPS } from "./payment.js";
import type { ServiceRegistry } from "./registry.js";
import { buildReceipt } from "./receipt.js";
import { isTerminal, type SettlementRecord, type SettlementStore } from "./store/index.js";

const DECISION_ID = /^[0-9a-f]{64}$/;

export interface SettleOptions {
  /**
   * Gate, preflight, build the envelope and COMMIT it — then stop, before
   * `mark_settled` and before submission.
   *
   * The record it leaves behind is a real `PREPARED` record, not a scratch one:
   * a dry run is the first half of a settlement, and the run that follows it
   * resumes through exactly the same recovery path a crash would take. That is
   * deliberate — it means the recovery path is exercised on every rehearsal
   * rather than only in an emergency.
   */
  dryRun?: boolean;
  /** How long to keep polling for inclusion before reporting INCLUSION_UNKNOWN. */
  confirmTimeoutMs?: number;
}

export interface SettleResult {
  decisionId: string;
  /** Precomputed before submission, so this is populated even for a dry run. */
  txHash: string;
  memoHash: string;
  status: SettlementRecord["status"];
  dryRun: boolean;
  destination: string;
  /** Stroops, decimal string. Read from the chain on this run, never from the journal. */
  amountStroops: string;
  /** The ledger the PAYMENT landed in. Present once SETTLED. */
  ledger?: number;
  /** The ledger `mark_settled` landed in. Present when this run made that call. */
  markSettledLedger?: number;
  /** The claim, already validated against `@aegis/receipt`'s own parser. */
  receipt: Receipt;
}

export interface ExecutorDeps {
  config: ExecutorConfig;
  registry: ServiceRegistry;
  chain: ChainClient;
  store: SettlementStore;
  horizon?: HorizonClient;
  /** Unix seconds. Injectable so the max_time proof is testable without waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Executor {
  settle(decisionId: string, options?: SettleOptions): Promise<SettleResult>;
  /** Drive one stored, non-terminal attempt to a terminal state. */
  recover(decisionId: string, options?: SettleOptions): Promise<SettleResult>;
  /** Every attempt still in flight — the reconciliation work queue. */
  pending(): Promise<SettlementRecord[]>;
}

interface Gated {
  decision: OnChainDecision;
  destination: string;
  memo: Uint8Array;
}

const DEFAULT_CONFIRM_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

const eqBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

export function createExecutor(deps: ExecutorDeps): Executor {
  const { config, registry, chain, store } = deps;
  const horizon = deps.horizon ?? horizonClient(config.horizonUrl);
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /**
   * The registry, not `.env`, is the authority for every value a reviewer will
   * later re-check. Anywhere the two disagree the executor refuses rather than
   * silently preferring one — a settlement built on a contract or a source
   * account the repository does not publish would verify against nothing.
   */
  function assertConfigAgreesWithRegistry(): void {
    if (registry.contractId !== config.contractId) {
      throw new SettlementError("CONTRACT_MISMATCH", "CONTRACT_ID is not the contract the registry publishes", {
        expected: registry.contractId,
        actual: config.contractId,
      });
    }
    if (registry.executorAccount !== config.executor.publicKey()) {
      throw new SettlementError("SOURCE_MISMATCH", "EXECUTOR_SECRET is not the published executor account", {
        expected: registry.executorAccount,
        actual: config.executor.publicKey(),
      });
    }
    if (registry.networkPassphrase !== config.networkPassphrase) {
      throw new SettlementError("CONFIG_INVALID", "the configured network is not the registry's network", {
        expected: registry.networkPassphrase,
        actual: config.networkPassphrase,
      });
    }
    // The registry publishes a SAC address; it must be the one its own code and
    // issuer derive to. If it is not, the registry contradicts itself and no
    // asset comparison downstream would mean anything.
    const derived = deriveSac(registry.asset.code, registry.asset.issuer, config.networkPassphrase);
    if (derived !== registry.asset.sac) {
      throw new SettlementError("REGISTRY_INVALID", "the registry's published SAC is not the one its asset derives to", {
        expected: derived,
        actual: registry.asset.sac,
      });
    }
  }

  /**
   * THE GATE. Every refusal here is sourced from the contract or from the
   * published registry, and each carries its own code so a refusal is
   * classifiable rather than merely loud.
   *
   * `settled` is deliberately NOT checked here — the caller decides what it
   * means, because a settled decision is a replay to a fresh attempt but is
   * expected during recovery of this executor's own unfinished work.
   */
  async function gate(decisionIdHex: string): Promise<Gated> {
    const idBytes = fromHex(decisionIdHex);

    const decision = await chain.getDecision(idBytes);
    if (decision === "not-found") {
      throw new SettlementError("DECISION_NOT_FOUND", "the contract holds no decision under this id", {
        expected: `get_decision(${decisionIdHex})`,
        actual: "DecisionNotFound",
      });
    }
    if (toHex(decision.decisionId) !== decisionIdHex) {
      throw new SettlementError("DECISION_NOT_FOUND", "the contract returned a decision filed under a different id", {
        expected: decisionIdHex,
        actual: toHex(decision.decisionId),
      });
    }
    if (decision.verdict !== Verdict.Approved) {
      throw new SettlementError("NOT_APPROVED", "the contract did not approve this spend", {
        expected: "Approved",
        actual: Verdict[decision.verdict] ?? String(decision.verdict),
      });
    }

    // i128 on chain, int64 on the classic rail. A decision the contract can
    // hold but the rail cannot carry is a refusal, never a truncation.
    assertPayableAmount(decision.amount);

    const destination = registry.destinationFor(decision.serviceId);
    if (destination === undefined) {
      throw new SettlementError("UNKNOWN_SERVICE", "no active destination is published for this service_id", {
        expected: `an active entry for "${decision.serviceId}" in ${registry.path}`,
        actual: "no entry",
      });
    }

    // DERIVED, not read from .env: Asset(code, issuer).contractId(passphrase) is
    // a pure function with no AEGIS input, so recomputing it is what actually
    // binds the CODE:ISSUER the ledger will show to the SAC the contract holds.
    const sac = deriveSac(registry.asset.code, registry.asset.issuer, config.networkPassphrase);
    if (sac !== decision.asset) {
      throw new SettlementError("ASSET_MISMATCH", "the decision authorizes an asset this executor cannot pay", {
        expected: decision.asset,
        actual: `${registry.asset.code}:${registry.asset.issuer} -> ${sac}`,
      });
    }

    // Computed twice, in two languages: TypeScript here, Rust in the contract's
    // own memo_hash() view. A bug in either becomes a refusal, never a payment
    // whose commitment nobody can reproduce.
    const memo = computeMemoHash(decision.intentHash, decision.policyVersion, decision.decisionId);
    const onChainMemo = await chain.memoHash(idBytes);
    if (!eqBytes(memo, onChainMemo)) {
      throw new SettlementError("MEMO_MISMATCH", "the local memo commitment differs from the contract's own view", {
        expected: toHex(onChainMemo),
        actual: toHex(memo),
      });
    }

    return { decision, destination, memo };
  }

  /**
   * The payment must be able to succeed before `mark_settled` is called — a
   * settled decision whose payment was always going to bounce is the orphan
   * this ordering is supposed to make rare.
   */
  async function preflight(g: Gated): Promise<{ sequence: string }> {
    const { code, issuer } = registry.asset;
    const source = config.executor.publicKey();

    const from = await horizon.account(source);
    if (from === "not-found") {
      throw new SettlementError("PREFLIGHT_FAILED", "the executor account does not exist on this network", {
        expected: source, actual: "404",
      });
    }
    const fromLine = trustline(from, code, issuer);
    if (fromLine === undefined) {
      throw new SettlementError("PREFLIGHT_FAILED", "the executor holds no trustline for the settlement asset", {
        expected: `${code}:${issuer} trustline on ${source}`, actual: "no trustline",
      });
    }
    if (fromLine.is_authorized === false) {
      throw new SettlementError("PREFLIGHT_FAILED", "the executor's trustline is not authorized by the issuer", {
        expected: "is_authorized == true", actual: "is_authorized == false",
      });
    }
    const balance = parseAmount(fromLine.balance);
    if (balance < g.decision.amount) {
      throw new SettlementError("PREFLIGHT_FAILED", "the executor cannot cover the authorized amount", {
        expected: `${g.decision.amount} stroops`, actual: `${balance} stroops`,
      });
    }
    const native = from.balances.find((b) => b.asset_type === "native");
    if (native !== undefined && parseAmount(native.balance) < BigInt(PAYMENT_FEE_STROOPS)) {
      throw new SettlementError("PREFLIGHT_FAILED", "the executor cannot cover the transaction fee", {
        expected: `${PAYMENT_FEE_STROOPS} stroops of XLM`, actual: `${native.balance} XLM`,
      });
    }

    const to = await horizon.account(g.destination);
    if (to === "not-found") {
      throw new SettlementError("PREFLIGHT_FAILED", "the published destination account does not exist", {
        expected: g.destination, actual: "404",
      });
    }
    const toLine = trustline(to, code, issuer);
    if (toLine === undefined) {
      throw new SettlementError("PREFLIGHT_FAILED", "the destination holds no trustline for the settlement asset", {
        expected: `${code}:${issuer} trustline on ${g.destination}`, actual: "no trustline",
      });
    }
    if (toLine.is_authorized === false) {
      throw new SettlementError("PREFLIGHT_FAILED", "the destination's trustline is not authorized by the issuer", {
        expected: "is_authorized == true", actual: "is_authorized == false",
      });
    }

    return { sequence: from.sequence };
  }

  /**
   * The clock the `max_time` proof is anchored to.
   *
   * Ledger close time, not local wall clock, is what validators compare
   * `maxTime` against — and it is what the non-inclusion proof reads back. Local
   * time is used only as a floor, so a Horizon lagging behind reality cannot
   * mint an envelope that is already expired.
   */
  async function chooseMaxTime(): Promise<number> {
    const ledgerNow = await horizon.latestLedgerCloseTime();
    return Math.max(ledgerNow, now()) + config.timeoutSeconds;
  }

  function receiptFor(g: Gated, txHash: string): Receipt {
    return buildReceipt({
      decision: g.decision,
      networkPassphrase: config.networkPassphrase,
      contractId: config.contractId,
      horizonUrl: config.horizonUrl,
      rpcUrl: config.rpcUrl,
      txHash,
      memoHash: g.memo,
      source: config.executor.publicKey(),
      destination: g.destination,
      assetCode: registry.asset.code,
      assetIssuer: registry.asset.issuer,
      issuedAt: new Date().toISOString(),
    });
  }

  const result = (
    g: Gated,
    record: SettlementRecord,
    extra: { dryRun: boolean; markSettledLedger?: number },
  ): SettleResult => {
    const out: SettleResult = {
      decisionId: toHex(g.decision.decisionId),
      txHash: record.txHash,
      memoHash: toHex(g.memo),
      status: record.status,
      dryRun: extra.dryRun,
      destination: g.destination,
      amountStroops: g.decision.amount.toString(),
      receipt: receiptFor(g, record.txHash),
    };
    if (record.ledger !== undefined) out.ledger = record.ledger;
    if (extra.markSettledLedger !== undefined) out.markSettledLedger = extra.markSettledLedger;
    return out;
  };

  /** Build and durably commit a fresh envelope. Never called once anything is on chain. */
  async function prepare(g: Gated, replacing: boolean): Promise<SettlementRecord> {
    const { sequence } = await preflight(g);
    const maxTime = await chooseMaxTime();
    const payment = preparePayment({
      executor: config.executor,
      currentSequence: sequence,
      destination: g.destination,
      assetCode: registry.asset.code,
      assetIssuer: registry.asset.issuer,
      amountStroops: g.decision.amount,
      memoHash: g.memo,
      networkPassphrase: config.networkPassphrase,
      maxTime,
    });
    const row = {
      decisionId: toHex(g.decision.decisionId),
      txHash: payment.txHash,
      envelopeXdr: payment.envelopeXdr,
      source: payment.source,
      sequence: payment.sequence,
      maxTime: payment.maxTime,
      note: `${payment.amountDecimal} ${registry.asset.code} -> ${payment.destination}`,
    };
    // ⚠️ THE ORDERING-CRITICAL WRITE. It is fsynced before it returns, and
    // nothing that touches the chain happens above this line.
    return replacing ? store.replacePrepared(row) : store.putPrepared(row);
  }

  /**
   * Poll the STORED hash until inclusion is confirmed or non-inclusion is proven.
   * Nothing is ever rebuilt in here: the only two outcomes are facts about one
   * specific transaction hash.
   */
  async function awaitInclusion(
    record: SettlementRecord,
    g: Gated,
    timeoutMs: number,
  ): Promise<SettleResult> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const tx = await horizon.transaction(record.txHash);
      if (tx !== "not-found") {
        if (tx.successful) {
          const done = await store.advance(record.decisionId, "SETTLED", { ledger: tx.ledger });
          return result(g, done, { dryRun: false });
        }
        // On the ledger but failed: no money moved, and the decision is already
        // marked settled. Terminal, and it needs a human — not a retry.
        await store.advance(record.decisionId, "ABANDONED", {
          ledger: tx.ledger,
          note: "included but unsuccessful — no payment; decision is settled and needs reconciliation",
        });
        throw new SettlementError("SUBMIT_FAILED", "the payment was included but did not succeed", {
          expected: "successful == true", actual: `successful == false in ledger ${tx.ledger}`,
        });
      }

      // Not on the ledger. `max_time` is what makes that an answer rather than
      // a shrug: past it, no validator can ever include these bytes.
      const ledgerNow = await horizon.latestLedgerCloseTime();
      if (ledgerNow > record.maxTime) {
        await store.advance(record.decisionId, "ABANDONED", {
          note: `non-inclusion proven: ledger close ${ledgerNow} > max_time ${record.maxTime}`,
        });
        throw new SettlementError("NON_INCLUSION_PROVEN", "the payment can never be included", {
          expected: `inclusion before max_time ${record.maxTime}`,
          actual: `latest ledger closed at ${ledgerNow} with the hash still absent`,
        });
      }
      if (Date.now() >= deadline) {
        throw new SettlementError("INCLUSION_UNKNOWN", "the payment is neither confirmed nor proven absent", {
          expected: `a verdict on ${record.txHash}`,
          actual: `still pending; max_time ${record.maxTime} has not passed`,
        });
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  /**
   * Submit the STORED bytes and drive to a terminal state.
   *
   * Re-POSTing an envelope that is already on the ledger is safe precisely
   * because it is the same bytes: it has the same hash, so it is the same
   * transaction, and Horizon either reports it as included or rejects it as a
   * duplicate. That is the whole reason the envelope is stored rather than the
   * inputs that produced it.
   */
  async function submitAndConfirm(
    record: SettlementRecord,
    g: Gated,
    timeoutMs: number,
    markSettledLedger?: number,
  ): Promise<SettleResult> {
    const submitted = await store.advance(record.decisionId, "SUBMITTED");
    const outcome = await horizon.submit(submitted.envelopeXdr);

    if (outcome.kind === "included") {
      if (outcome.successful) {
        const done = await store.advance(record.decisionId, "SETTLED", { ledger: outcome.ledger });
        return result(g, done, { dryRun: false, ...(markSettledLedger === undefined ? {} : { markSettledLedger }) });
      }
      await store.advance(record.decisionId, "ABANDONED", {
        ledger: outcome.ledger,
        note: "included but unsuccessful — no payment; decision is settled and needs reconciliation",
      });
      throw new SettlementError("SUBMIT_FAILED", "the payment was included but did not succeed", {
        expected: "successful == true", actual: `successful == false in ledger ${outcome.ledger}`,
      });
    }

    if (outcome.kind === "rejected") {
      // Horizon refused these bytes. The record stays SUBMITTED rather than
      // being abandoned here: only `max_time` can prove non-inclusion, and
      // `recover()` will reach that proof. What must NOT happen is a rebuild.
      throw new SettlementError("SUBMIT_FAILED", `${outcome.detail}; run recover() to reach a terminal state`, {
        expected: "an accepted envelope",
        actual: JSON.stringify(outcome.resultCodes ?? outcome.detail),
      });
    }

    // "unknown" — the ONLY correct response is to poll the hash we already hold.
    const confirmed = await awaitInclusion(submitted, g, timeoutMs);
    return markSettledLedger === undefined ? confirmed : { ...confirmed, markSettledLedger };
  }

  /**
   * Resume an attempt that already has a committed envelope.
   *
   * ═══ THE RECOVERY MATRIX ═══
   *
   * | stored    | chain `settled` | what happens |
   * |-----------|-----------------|--------------|
   * | PREPARED  | false           | `mark_settled` never applied. Envelope still valid -> use it; expired -> rebuild is SAFE here and only here, because nothing was submitted. |
   * | PREPARED  | true            | crashed *during* `mark_settled`; it did apply. Advance to MARKED and submit the STORED bytes. Never rebuild. |
   * | MARKED    | true            | the payment may or may not have been sent. Poll the stored hash, re-POST identical bytes while `max_time` holds. |
   * | SUBMITTED | true            | identical to MARKED — "submitted" only ever meant "POSTed", never "included". |
   * | SETTLED   | true            | terminal. Handled before this function: a fresh attempt is refused by the contract. |
   * | ABANDONED | true            | terminal without a payment. Refuse; a human must reconcile. |
   */
  async function resume(
    record: SettlementRecord,
    g: Gated,
    options: Required<Pick<SettleOptions, "dryRun" | "confirmTimeoutMs">>,
  ): Promise<SettleResult> {
    if (record.status === "ABANDONED") {
      throw new SettlementError("ABANDONED", "a previous attempt was abandoned; this decision needs manual reconciliation", {
        expected: "a live attempt", actual: record.note ?? "ABANDONED",
      });
    }

    if (record.status === "PREPARED") {
      if (g.decision.settled) {
        // The crash landed between `mark_settled` applying and the journal
        // learning about it. The chain is the authority; catch the journal up.
        const marked = await store.advance(record.decisionId, "MARKED", {
          note: "chain reports settled; mark_settled applied before the journal was updated",
        });
        if (options.dryRun) return result(g, marked, { dryRun: true });
        return submitAndConfirm(marked, g, options.confirmTimeoutMs);
      }

      // `mark_settled` provably never applied and nothing was ever submitted,
      // so an expired envelope may be rebuilt. This is the ONLY place a rebuild
      // is legal, and the guard above is what makes it legal.
      let live = record;
      const ledgerNow = await horizon.latestLedgerCloseTime();
      if (ledgerNow >= record.maxTime) {
        live = await prepare(g, true);
      }
      if (options.dryRun) return result(g, live, { dryRun: true });

      const { ledger } = await chain.markSettled(g.decision.decisionId);
      const marked = await store.advance(live.decisionId, "MARKED", { note: `mark_settled in ledger ${ledger}` });
      return submitAndConfirm(marked, g, options.confirmTimeoutMs, ledger);
    }

    // MARKED or SUBMITTED: the contract has been written, so the stored bytes
    // are the only transaction that may ever settle this decision.
    if (options.dryRun) return result(g, record, { dryRun: true });
    const tx = await horizon.transaction(record.txHash);
    if (tx !== "not-found") return awaitInclusion(record, g, options.confirmTimeoutMs);
    return submitAndConfirm(record, g, options.confirmTimeoutMs);
  }

  async function run(decisionId: string, options: SettleOptions, allowFresh: boolean): Promise<SettleResult> {
    if (!DECISION_ID.test(decisionId)) {
      throw new SettlementError("CONFIG_INVALID", "decision_id must be 64 lowercase hex characters", {
        expected: "64 hex", actual: decisionId,
      });
    }
    const opts = {
      dryRun: options.dryRun === true,
      confirmTimeoutMs: options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS,
    };

    return withLock(decisionId, async () => {
      assertConfigAgreesWithRegistry();

      // ── RE-READ. Before the journal is consulted, before anything else. ──
      const g = await gate(decisionId);
      const record = await store.get(decisionId);

      if (g.decision.settled) {
        // ★ SOW §5.2 scenario 7. The refusal is sourced from the CONTRACT's own
        // `settled` flag, not from the journal — which is the point: a replay
        // from a machine with an empty journal is refused just the same.
        if (record === undefined || isTerminal(record.status)) {
          throw new SettlementError("ALREADY_SETTLED", "the contract has already marked this decision settled", {
            expected: "settled == false",
            actual: `settled == true${record === undefined ? "" : ` (local journal: ${record.status})`}`,
          });
        }
        // Otherwise it is this executor's own unfinished work — recover it.
        return resume(record, g, opts);
      }

      if (record !== undefined) return resume(record, g, opts);
      if (!allowFresh) {
        throw new SettlementError("STORE_CONFLICT", "there is nothing to recover for this decision", {
          expected: "a stored attempt", actual: "no record",
        });
      }

      const prepared = await prepare(g, false);
      if (opts.dryRun) return result(g, prepared, { dryRun: true });

      // ⚠️ IRREVERSIBLE, and confirmed applied before the payment is sent.
      const { ledger } = await chain.markSettled(g.decision.decisionId);
      const marked = await store.advance(prepared.decisionId, "MARKED", { note: `mark_settled in ledger ${ledger}` });
      return submitAndConfirm(marked, g, opts.confirmTimeoutMs, ledger);
    }).catch((e: unknown) => {
      if (e instanceof LockBusyError) {
        throw new SettlementError("LOCK_HELD", e.message);
      }
      throw e;
    });
  }

  return {
    settle: (decisionId, options = {}) => run(decisionId, options, true),
    recover: (decisionId, options = {}) => run(decisionId, options, false),
    pending: () => store.pending(),
  };
}
