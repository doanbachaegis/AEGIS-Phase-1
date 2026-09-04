/**
 * Orchestration: decide what to fetch, hand it to the pure checks in `checks.ts`.
 *
 * The two sources are queried independently and a failure of either degrades only
 * the checks that needed it. An `unavailable` check is never silently dropped —
 * it is reported, and it moves the exit code to 3, because "could not check" must
 * never read as "checked and fine".
 */
import { readFileSync } from "node:fs";
import { fromHex, toHex } from "@aegis/canonical";
import { parseReceiptJson, type Receipt } from "@aegis/receipt";
import type { CliOptions } from "./args.js";
import * as check from "./checks.js";
import { connect, type ChainDecision, type ChainReader } from "./chain.js";
import {
  SourceUnavailableError,
  fetchOperations,
  fetchTransaction,
  scanForMemo,
  type HorizonOperation,
  type HorizonTransaction,
} from "./horizon.js";
import { RegistryError, findRegistryPath, loadRegistry, type ServiceRegistry } from "./registry.js";
import { exitCodeFor, fail, pass, unavailable, verdictFor, type Check, type ExitCode } from "./types.js";

/** A bad invocation — exit code 2. Distinct from anything the checks can conclude. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface VerifyReport {
  tx: string;
  receiptPath: string;
  strict: boolean;
  resolved: {
    horizon: string;
    rpc: string;
    contract: string;
    networkPassphrase: string;
    registry: string | null;
  };
  checks: Check[];
  verdict: string;
  exitCode: ExitCode;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function verify(options: CliOptions): Promise<VerifyReport> {
  let text: string;
  try {
    text = readFileSync(options.receipt, "utf8");
  } catch (e) {
    throw new UsageError(`cannot read the receipt at ${options.receipt}: ${message(e)}`);
  }

  const parsed = parseReceiptJson(text);
  if (!parsed.ok) {
    // Nothing else can be checked without a receipt, so the report is this one line.
    const checks = [
      fail(
        "receipt.parse",
        "receipt",
        "the receipt is well-formed",
        parsed.issues.map((i) => `\n      ${i}`).join(""),
        "a valid aegis-receipt/1 document",
        `${parsed.issues.length} problem(s)`,
      ),
    ];
    return report(options, null, checks);
  }

  const receipt = parsed.receipt;
  const checks: Check[] = [
    pass("receipt.parse", "receipt", "the receipt is well-formed", `${options.receipt}, schema ${receipt.version}`),
    check.checkTxMatchesReceipt(options.tx, receipt),
  ];

  const horizonUrl = options.horizon ?? receipt.network.horizon;
  const rpcUrl = options.rpc ?? receipt.network.rpc;
  const contractId = options.contract ?? receipt.network.contract_id;
  const passphrase = options.network ?? receipt.network.passphrase;

  const ledger = await readLedger(horizonUrl, options.tx);
  const chain = await readChain(contractId, rpcUrl, passphrase, receipt, options.strict);
  const registry = readRegistry(options);

  // The registry pin comes FIRST among the sourced checks: if the contract the
  // receipt nominated is not the published one, everything the contract said
  // below is worthless, and the reader should see that before reading it.
  const registryTitle = "the contract queried is the one the published registry names";
  if (registry.registry?.contractId !== undefined) {
    checks.push(check.checkRegistryContract(contractId, registry.registry.contractId, registry.registry.path));
  } else {
    checks.push(
      unavailable(
        "registry.contract",
        "registry",
        registryTitle,
        registry.reason ?? `${registry.registry?.path ?? "the registry"} pins no contract_id`,
      ),
    );
  }

  checks.push(...ledger.checks, ...chain.checks);

  // ---- the commitment: the receipt, the local recomputation and the contract
  //      must all land on the same 32 bytes the ledger carries.
  const memo = ledger.memo;
  if (memo === undefined) {
    for (const [id, source, title] of [
      ["receipt.memo_hash", "receipt", "the memo_hash written in the receipt is the one on the ledger"],
      ["commitment.memo_matches", "derived", "the on-ledger memo IS sha256(intent_hash || policy_version || decision_id)"],
      ["receipt.preimage", "receipt", "the receipt's 68-byte preimage hashes to the on-ledger memo"],
      ["rpc.contract_memo_hash", "soroban-rpc", "the contract's own memo_hash() view equals the on-ledger memo"],
    ] as const) {
      checks.push(unavailable(id, source, title, ledger.reason ?? "the on-ledger memo could not be read"));
    }
  } else {
    checks.push(check.checkReceiptMemoHash(receipt, memo));
    checks.push(check.checkMemoCommitment(receipt, memo));
    checks.push(check.checkReceiptPreimage(receipt, memo));
    checks.push(
      chain.memoHash !== undefined
        ? check.checkContractMemoHash(chain.memoHash, memo)
        : unavailable(
            "rpc.contract_memo_hash",
            "soroban-rpc",
            "the contract's own memo_hash() view equals the on-ledger memo",
            chain.reason ?? "the contract view could not be read",
          ),
    );
  }

  // ---- amount / asset: the ledger against the contract, never against the receipt
  const payment = ledger.payment;
  const decision = chain.decision;
  const both = payment !== undefined && decision !== undefined;
  const why = payment === undefined ? (ledger.reason ?? "no payment operation") : (chain.reason ?? "no on-chain decision");

  checks.push(
    both
      ? check.checkPaymentAmount(payment, decision)
      : unavailable("payment.amount", "horizon", "the amount paid equals the amount the contract authorized", why),
  );
  checks.push(
    both
      ? check.checkPaymentAsset(payment, passphrase, decision)
      : unavailable("payment.asset", "derived", "the asset paid derives to the SAC address the contract authorized", why),
  );

  // ---- destination / source: the published registry
  checks.push(...registryChecks(registry, ledger, decision));

  // ---- strict mode
  if (options.strict) {
    checks.push(
      decision !== undefined
        ? check.checkDecisionIdDerivation(decision)
        : unavailable(
            "strict.decision_id",
            "derived",
            'decision_id == sha256("AEGIS-DECISION-v1" || intent_hash || policy_version)',
            chain.reason ?? "no on-chain decision",
          ),
    );
    const title = "mark_settled was written at or before the payment's ledger";
    if (chain.settledLedger !== undefined && ledger.tx !== undefined) {
      checks.push(check.checkSettlementOrder(chain.settledLedger, ledger.tx.ledger));
    } else {
      checks.push(
        unavailable(
          "strict.settle_order",
          "soroban-rpc",
          title,
          chain.settledLedgerReason ?? ledger.reason ?? "the ledger of the settle write could not be read",
        ),
      );
    }
  }

  // ---- replay scan
  checks.push(await replayCheck(horizonUrl, options.tx, ledger, registry.registry, decision));

  return report(options, { horizonUrl, rpcUrl, contractId, passphrase, registry }, checks);
}

// ------------------------------------------------------------------ ledger

interface LedgerRead {
  checks: Check[];
  tx?: HorizonTransaction;
  payment?: HorizonOperation;
  memo?: Uint8Array;
  /** Why the optional fields are missing, for the dependent checks to quote. */
  reason?: string;
}

async function readLedger(horizonUrl: string, txHash: string): Promise<LedgerRead> {
  const out: LedgerRead = { checks: [] };
  let tx: HorizonTransaction | "not-found";
  try {
    tx = await fetchTransaction(horizonUrl, txHash);
  } catch (e) {
    out.reason = message(e);
    for (const [id, title] of [
      ["horizon.tx_successful", "the transaction exists on the ledger and succeeded"],
      ["horizon.single_payment", "the transaction carries exactly one operation and it is a payment"],
      ["horizon.memo_hash", "the transaction carries a 32-byte MEMO_HASH"],
    ] as const) {
      out.checks.push(unavailable(id, "horizon", title, out.reason));
    }
    return out;
  }

  if (tx === "not-found") {
    out.reason = "Horizon has no such transaction";
    out.checks.push(check.checkTransactionNotFound(txHash));
    out.checks.push(
      unavailable(
        "horizon.single_payment",
        "horizon",
        "the transaction carries exactly one operation and it is a payment",
        out.reason,
      ),
      unavailable("horizon.memo_hash", "horizon", "the transaction carries a 32-byte MEMO_HASH", out.reason),
    );
    return out;
  }

  out.tx = tx;
  out.checks.push(check.checkTransactionSuccessful(tx));

  try {
    const ops = await fetchOperations(horizonUrl, txHash);
    const single = check.checkSinglePaymentOperation(tx, ops);
    out.checks.push(single.check);
    if (single.payment !== undefined) out.payment = single.payment;
  } catch (e) {
    out.reason = message(e);
    out.checks.push(
      unavailable(
        "horizon.single_payment",
        "horizon",
        "the transaction carries exactly one operation and it is a payment",
        out.reason,
      ),
    );
  }

  const memo = check.checkMemoIsHash32(tx);
  out.checks.push(memo.check);
  if (memo.memo !== undefined) out.memo = memo.memo;
  return out;
}

// ------------------------------------------------------------------- chain

interface ChainRead {
  checks: Check[];
  decision?: ChainDecision;
  memoHash?: Uint8Array;
  settledLedger?: number;
  settledLedgerReason?: string;
  reason?: string;
}

async function readChain(
  contractId: string,
  rpcUrl: string,
  passphrase: string,
  receipt: Receipt,
  strict: boolean,
): Promise<ChainRead> {
  const out: ChainRead = { checks: [] };
  const decisionId = fromHex(receipt.chain.decision_id);

  let reader: ChainReader;
  try {
    reader = await connect(contractId, rpcUrl, passphrase);
  } catch (e) {
    out.reason = message(e);
    for (const [id, title] of [
      ["rpc.decision_found", "the contract holds a decision under this decision_id"],
      ["rpc.verdict_approved", "the on-chain verdict is Approved"],
      ["rpc.settled", "the decision is marked settled on chain"],
      ["rpc.receipt_matches_decision", "every claim in the receipt's chain block matches the on-chain decision"],
    ] as const) {
      out.checks.push(unavailable(id, "soroban-rpc", title, out.reason));
    }
    return out;
  }

  try {
    const decision = await reader.getDecision(decisionId);
    if (decision === "not-found") {
      out.reason = "the contract holds no such decision";
      out.checks.push(check.checkDecisionNotFound(receipt.chain.decision_id));
      for (const [id, title] of [
        ["rpc.verdict_approved", "the on-chain verdict is Approved"],
        ["rpc.settled", "the decision is marked settled on chain"],
        ["rpc.receipt_matches_decision", "every claim in the receipt's chain block matches the on-chain decision"],
      ] as const) {
        out.checks.push(unavailable(id, "soroban-rpc", title, out.reason));
      }
    } else {
      out.decision = decision;
      out.checks.push(check.checkDecisionFound(decision));
      out.checks.push(check.checkVerdictApproved(decision));
      out.checks.push(check.checkSettled(decision));
      out.checks.push(check.checkReceiptMatchesDecision(receipt, decision));
    }
  } catch (e) {
    out.reason = message(e);
    for (const [id, title] of [
      ["rpc.decision_found", "the contract holds a decision under this decision_id"],
      ["rpc.verdict_approved", "the on-chain verdict is Approved"],
      ["rpc.settled", "the decision is marked settled on chain"],
      ["rpc.receipt_matches_decision", "every claim in the receipt's chain block matches the on-chain decision"],
    ] as const) {
      out.checks.push(unavailable(id, "soroban-rpc", title, out.reason));
    }
    return out;
  }

  try {
    const m = await reader.memoHash(decisionId);
    if (m !== "not-found") out.memoHash = m;
  } catch (e) {
    out.reason ??= message(e);
  }

  if (strict) {
    try {
      const seq = await reader.decisionEntryLastModifiedLedger(decisionId);
      if (seq === "not-found") {
        out.settledLedgerReason = "the decision's storage entry is not live (archived or never written)";
      } else {
        out.settledLedger = seq;
      }
    } catch (e) {
      out.settledLedgerReason = message(e);
    }
  }
  return out;
}

// ---------------------------------------------------------------- registry

interface RegistryRead {
  registry?: ServiceRegistry;
  reason?: string;
}

function readRegistry(options: CliOptions): RegistryRead {
  const path = findRegistryPath(options.registry, options.receipt);
  if (path === undefined) {
    return {
      reason:
        "no services.json found (looked next to the receipt and in the working directory) — " +
        "without a published mapping, any destination would satisfy any decision",
    };
  }
  try {
    return { registry: loadRegistry(path) };
  } catch (e) {
    return { reason: e instanceof RegistryError ? e.message : message(e) };
  }
}

function registryChecks(read: RegistryRead, ledger: LedgerRead, decision: ChainDecision | undefined): Check[] {
  const destTitle = "the payee is the published account for the decision's service_id";
  const srcTitle = "the transaction was submitted by the published executor account";
  const registry = read.registry;

  if (registry === undefined) {
    const why = read.reason ?? "the service registry could not be read";
    return [
      unavailable("payment.destination", "registry", destTitle, why),
      unavailable("payment.source", "registry", srcTitle, why),
    ];
  }

  const out: Check[] = [];
  if (ledger.payment === undefined || decision === undefined) {
    out.push(
      unavailable(
        "payment.destination",
        "registry",
        destTitle,
        decision === undefined ? "no on-chain decision to take the service_id from" : "no payment operation to inspect",
      ),
    );
  } else {
    const destination = registry.services.get(decision.serviceId);
    out.push(
      destination === undefined
        ? fail(
            "payment.destination",
            "registry",
            destTitle,
            `${registry.path} publishes no destination for service_id "${decision.serviceId}"`,
            `an entry for "${decision.serviceId}"`,
            `services: ${[...registry.services.keys()].join(", ") || "none"}`,
          )
        : check.checkDestination(ledger.payment, decision.serviceId, destination, registry.path),
    );
  }

  if (ledger.tx === undefined) {
    out.push(unavailable("payment.source", "registry", srcTitle, ledger.reason ?? "no transaction to inspect"));
  } else if (registry.executor === undefined) {
    out.push(unavailable("payment.source", "registry", srcTitle, `${registry.path} names no executor account`));
  } else {
    out.push(check.checkSource(ledger.tx, registry.executor, registry.path));
  }
  return out;
}

// ------------------------------------------------------------------ replay

async function replayCheck(
  horizonUrl: string,
  txHash: string,
  ledger: LedgerRead,
  registry: ServiceRegistry | undefined,
  decision: ChainDecision | undefined,
): Promise<Check> {
  const title = "no other successful transaction carries this memo";
  if (ledger.memo === undefined || ledger.tx === undefined) {
    return unavailable("replay.unique", "horizon", title, ledger.reason ?? "no memo to scan for");
  }
  // Scan the accounts the settlement actually touched, taken from Horizon and the
  // registry — never from the receipt.
  const accounts = [ledger.tx.source_account];
  if (ledger.payment?.to !== undefined) accounts.push(ledger.payment.to);
  if (registry !== undefined && decision !== undefined) {
    const published = registry.services.get(decision.serviceId);
    if (published !== undefined) accounts.push(published);
    if (registry.executor !== undefined) accounts.push(registry.executor);
  }
  try {
    const scan = await scanForMemo(horizonUrl, accounts, Buffer.from(ledger.memo).toString("base64"));
    return check.checkReplay(scan, txHash);
  } catch (e) {
    const why = e instanceof SourceUnavailableError ? e.message : message(e);
    return unavailable("replay.unique", "horizon", title, why);
  }
}

// ------------------------------------------------------------------ report

function report(
  options: CliOptions,
  resolved:
    | { horizonUrl: string; rpcUrl: string; contractId: string; passphrase: string; registry: RegistryRead }
    | null,
  checks: Check[],
): VerifyReport {
  const exitCode = exitCodeFor(checks);
  return {
    tx: options.tx,
    receiptPath: options.receipt,
    strict: options.strict,
    resolved: {
      horizon: resolved?.horizonUrl ?? options.horizon ?? "(unresolved)",
      rpc: resolved?.rpcUrl ?? options.rpc ?? "(unresolved)",
      contract: resolved?.contractId ?? options.contract ?? "(unresolved)",
      networkPassphrase: resolved?.passphrase ?? options.network ?? "(unresolved)",
      registry: resolved?.registry.registry?.path ?? null,
    },
    checks,
    verdict: verdictFor(exitCode),
    exitCode,
  };
}

export { toHex };
