/**
 * Every check the verifier makes, as PURE functions over data already fetched.
 *
 * Nothing in this file performs I/O. That is what makes each property testable
 * without a network and reviewable without running anything: the orchestration in
 * `verify.ts` decides what to fetch, and this file decides what the facts mean.
 *
 * Each check carries the SOURCE of its evidence. Read the sources down the
 * column of a report and the independence claim checks itself — `horizon`,
 * `soroban-rpc`, `registry`, `derived`, and `receipt` only ever as the claim
 * being tested, never as an authority.
 */
import { createHash } from "node:crypto";
import { Asset } from "@stellar/stellar-sdk";
import { decisionId as deriveDecisionId, fromHex, memoHash, parseAmount, toHex } from "@aegis/canonical";
import type { Receipt } from "@aegis/receipt";
import type { ChainDecision } from "./chain.js";
import type { HorizonOperation, HorizonTransaction, MemoScan } from "./horizon.js";
import { fail, pass, unavailable, type Check } from "./types.js";

const eq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Horizon returns a `hash` memo base64-encoded. Anything but exactly 32 bytes is a fault. */
export function decodeMemo(tx: HorizonTransaction): Uint8Array | { error: string } {
  if (tx.memo === undefined) return { error: "the transaction carries no memo value" };
  let bytes: Buffer;
  try {
    bytes = Buffer.from(tx.memo, "base64");
  } catch {
    return { error: `memo is not valid base64: ${tx.memo}` };
  }
  if (bytes.toString("base64") !== tx.memo) {
    return { error: `memo is not canonical base64: ${tx.memo}` };
  }
  if (bytes.length !== 32) {
    return { error: `memo decodes to ${bytes.length} bytes, expected 32` };
  }
  return Uint8Array.from(bytes);
}

// ---------------------------------------------------------------- receipt

export function checkTxMatchesReceipt(txArg: string, receipt: Receipt): Check {
  const title = "the --tx argument is the transaction this receipt describes";
  return txArg === receipt.settlement.tx_hash
    ? pass("receipt.tx_match", "receipt", title, `both name ${txArg}`)
    : fail(
        "receipt.tx_match",
        "receipt",
        title,
        "the receipt describes a different transaction",
        receipt.settlement.tx_hash,
        txArg,
      );
}

// ---------------------------------------------------------------- Horizon

export function checkTransactionSuccessful(tx: HorizonTransaction): Check {
  const title = "the transaction exists on the ledger and succeeded";
  return tx.successful
    ? pass(
        "horizon.tx_successful",
        "horizon",
        title,
        `included in ledger ${tx.ledger} at ${tx.created_at}, successful == true`,
      )
    : fail(
        "horizon.tx_successful",
        "horizon",
        title,
        "the transaction is on the ledger but did NOT succeed — no money moved",
        "successful == true",
        "successful == false",
      );
}

export function checkTransactionNotFound(txHash: string): Check {
  return fail(
    "horizon.tx_successful",
    "horizon",
    "the transaction exists on the ledger and succeeded",
    "Horizon has no such transaction — the receipt describes a settlement that never happened",
    `a transaction with hash ${txHash}`,
    "404 Not Found",
  );
}

/**
 * Exactly ONE operation, and it is a payment.
 *
 * The count matters as much as the type: a memo commits to the transaction, not
 * to an operation, so a second operation would ride along under the same
 * commitment and be authorized by nothing.
 */
export function checkSinglePaymentOperation(
  tx: HorizonTransaction,
  ops: readonly HorizonOperation[],
): { check: Check; payment?: HorizonOperation } {
  const title = "the transaction carries exactly one operation and it is a payment";
  const id = "horizon.single_payment";

  if (tx.operation_count !== 1 || ops.length !== 1) {
    return {
      check: fail(
        id,
        "horizon",
        title,
        "a memo commits to the whole transaction, so any extra operation would settle under a commitment that does not describe it",
        "1 operation",
        `${tx.operation_count} operations (${ops.map((o) => o.type).join(", ") || "none listed"})`,
      ),
    };
  }
  const op = ops[0] as HorizonOperation;
  if (op.type !== "payment") {
    return {
      check: fail(id, "horizon", title, "the single operation is not a payment", "payment", op.type),
    };
  }
  return {
    check: pass(id, "horizon", title, `one operation of type "payment"`),
    payment: op,
  };
}

export function checkMemoIsHash32(tx: HorizonTransaction): { check: Check; memo?: Uint8Array } {
  const title = "the transaction carries a 32-byte MEMO_HASH";
  const id = "horizon.memo_hash";

  if (tx.memo_type !== "hash") {
    return {
      check: fail(
        id,
        "horizon",
        title,
        "without a hash memo the payment carries no commitment to any decision at all",
        'memo_type == "hash"',
        `memo_type == "${tx.memo_type}"`,
      ),
    };
  }
  const decoded = decodeMemo(tx);
  if (!(decoded instanceof Uint8Array)) {
    return { check: fail(id, "horizon", title, decoded.error, "32 bytes", tx.memo ?? "nothing") };
  }
  return {
    check: pass(id, "horizon", title, `memo_type "hash", 32 bytes: ${toHex(decoded)}`),
    memo: decoded,
  };
}

// ------------------------------------------------------------ Soroban RPC

export function checkDecisionNotFound(decisionIdHex: string): Check {
  return fail(
    "rpc.decision_found",
    "soroban-rpc",
    "the contract holds a decision under this decision_id",
    "the contract has no such decision — nothing on chain authorized this payment",
    `get_decision(${decisionIdHex}) returns a decision`,
    "DecisionNotFound",
  );
}

export function checkDecisionFound(d: ChainDecision): Check {
  return pass(
    "rpc.decision_found",
    "soroban-rpc",
    "the contract holds a decision under this decision_id",
    `read from the contract ID alone; authorized at ledger ${d.ledgerSeq}`,
  );
}

export function checkVerdictApproved(d: ChainDecision): Check {
  const title = "the on-chain verdict is Approved";
  return d.verdict === "Approved"
    ? pass("rpc.verdict_approved", "soroban-rpc", title, `verdict Approved, reason ${d.reasonCode}`)
    : fail(
        "rpc.verdict_approved",
        "soroban-rpc",
        title,
        `the contract did not approve this spend (reason ${d.reasonCode})`,
        "Approved",
        d.verdict,
      );
}

export function checkSettled(d: ChainDecision): Check {
  const title = "the decision is marked settled on chain";
  return d.settled
    ? pass("rpc.settled", "soroban-rpc", title, "settled == true")
    : fail(
        "rpc.settled",
        "soroban-rpc",
        title,
        "the contract never recorded this decision as settled — the double-settle guard was not taken, so this payment is not accounted for on chain",
        "settled == true",
        "settled == false",
      );
}

/**
 * The receipt's `chain` block agrees with the decision the contract actually holds.
 *
 * The memo commitment already binds `intent_hash`, `policy_version` and
 * `decision_id`. It binds nothing else — `amount`, `asset`, `service_id` and
 * `agent` are outside the preimage — so a receipt could restate those freely
 * unless they are compared field by field against the chain, which is what this
 * does. Everything downstream then treats the CHAIN as the authority.
 */
export function checkReceiptMatchesDecision(receipt: Receipt, d: ChainDecision): Check {
  const title = "every claim in the receipt's chain block matches the on-chain decision";
  const c = receipt.chain;
  const mismatches: string[] = [];
  const cmp = (field: string, expected: string, actual: string): void => {
    if (expected !== actual) mismatches.push(`${field}: receipt ${actual} != chain ${expected}`);
  };

  cmp("decision_id", toHex(d.decisionId), c.decision_id);
  cmp("intent_hash", toHex(d.intentHash), c.intent_hash);
  cmp("policy_version", String(d.policyVersion), String(c.policy_version));
  cmp("agent", d.agent, c.agent);
  cmp("service_id", d.serviceId, c.service_id);
  cmp("asset", d.asset, c.asset);
  cmp("amount", d.amount.toString(), c.amount);

  return mismatches.length === 0
    ? pass("rpc.receipt_matches_decision", "soroban-rpc", title, "all 7 fields agree")
    : fail(
        "rpc.receipt_matches_decision",
        "soroban-rpc",
        title,
        `the receipt misdescribes the decision: ${mismatches.join("; ")}`,
        "the on-chain decision",
        `${mismatches.length} field(s) differ`,
      );
}

// ------------------------------------------------------------ the commitment

/**
 * ★ THE ACCEPTANCE CRITERION (SOW §6.3).
 *
 *     memo_hash == sha256(intent_hash || policy_version || decision_id)
 *
 * Every other check in this tool supports this one. It is what turns a payment
 * on a public ledger into a payment that provably refers to one specific
 * governance decision: the memo was fixed when the transaction was signed and
 * cannot be edited afterwards, and the three inputs are the ones the contract
 * itself stores.
 */
export function checkMemoCommitment(receipt: Receipt, onLedgerMemo: Uint8Array): Check {
  const c = receipt.chain;
  const computed = memoHash(fromHex(c.intent_hash), c.policy_version, fromHex(c.decision_id));
  const title = "the on-ledger memo IS sha256(intent_hash || policy_version || decision_id)";

  return eq(computed, onLedgerMemo)
    ? pass(
        "commitment.memo_matches",
        "derived",
        title,
        `recomputed locally from the decision's own fields: ${toHex(computed)}`,
      )
    : fail(
        "commitment.memo_matches",
        "derived",
        title,
        "the payment does NOT commit to this decision — the settlement and the authorization are unrelated",
        toHex(computed),
        toHex(onLedgerMemo),
      );
}

/**
 * The same commitment, recomputed BY THE CONTRACT.
 *
 * `memo_hash(decision_id)` is a view that hashes on chain, in Rust. Running it
 * alongside the TypeScript recomputation means a bug in `@aegis/canonical` cannot
 * make a settlement verify: the two implementations would have to be wrong in
 * exactly the same way.
 */
export function checkContractMemoHash(contractMemo: Uint8Array, onLedgerMemo: Uint8Array): Check {
  const title = "the contract's own memo_hash() view equals the on-ledger memo";
  return eq(contractMemo, onLedgerMemo)
    ? pass(
        "rpc.contract_memo_hash",
        "soroban-rpc",
        title,
        `computed in the contract, independently of this tool: ${toHex(contractMemo)}`,
      )
    : fail(
        "rpc.contract_memo_hash",
        "soroban-rpc",
        title,
        "the contract computes a different commitment for this decision",
        toHex(contractMemo),
        toHex(onLedgerMemo),
      );
}

/** The receipt's own 68-byte preimage hashes to the on-ledger memo, and says what it should. */
export function checkReceiptPreimage(receipt: Receipt, onLedgerMemo: Uint8Array): Check {
  const title = "the receipt's 68-byte preimage hashes to the on-ledger memo";
  const id = "receipt.preimage";
  const preimage = fromHex(receipt.settlement.memo_preimage);
  const c = receipt.chain;

  // The layout, restated: 32 + 4 + 32. Checking the CONTENT as well as the hash
  // stops a receipt from carrying a preimage that hashes correctly while
  // describing different fields than its own `chain` block.
  const expected = new Uint8Array(68);
  expected.set(fromHex(c.intent_hash), 0);
  new DataView(expected.buffer).setUint32(32, c.policy_version, false);
  expected.set(fromHex(c.decision_id), 36);

  if (!eq(preimage, expected)) {
    return fail(
      id,
      "receipt",
      title,
      "the preimage does not spell out the receipt's own chain fields",
      toHex(expected),
      toHex(preimage),
    );
  }
  const hashed = new Uint8Array(createHash("sha256").update(preimage).digest());
  return eq(hashed, onLedgerMemo)
    ? pass(id, "receipt", title, `sha256 of the receipt's preimage: ${toHex(hashed)}`)
    : fail(id, "receipt", title, "the preimage hashes to something else", toHex(hashed), toHex(onLedgerMemo));
}

/** `memo_hash` as stated in the receipt equals what the ledger actually carries. */
export function checkReceiptMemoHash(receipt: Receipt, onLedgerMemo: Uint8Array): Check {
  const title = "the memo_hash written in the receipt is the one on the ledger";
  return receipt.settlement.memo_hash === toHex(onLedgerMemo)
    ? pass("receipt.memo_hash", "receipt", title, `both are ${receipt.settlement.memo_hash}`)
    : fail(
        "receipt.memo_hash",
        "receipt",
        title,
        "the receipt states a memo the transaction does not carry",
        toHex(onLedgerMemo),
        receipt.settlement.memo_hash,
      );
}

// ------------------------------------------------------- amount / asset / party

/** `parseAmount` walks the decimal string; the value never passes through a float. */
export function checkPaymentAmount(op: HorizonOperation, d: ChainDecision): Check {
  const title = "the amount paid equals the amount the contract authorized";
  const id = "payment.amount";
  if (op.amount === undefined) {
    return fail(id, "horizon", title, "the payment operation carries no amount", d.amount.toString(), "nothing");
  }
  let paid: bigint;
  try {
    paid = parseAmount(op.amount);
  } catch (e) {
    return fail(id, "horizon", title, (e as Error).message, d.amount.toString(), op.amount);
  }
  return paid === d.amount
    ? pass(id, "horizon", title, `${op.amount} = ${paid} stroops, exactly as authorized`)
    : fail(
        id,
        "horizon",
        title,
        "the executor paid an amount the contract did not authorize",
        `${d.amount} stroops`,
        `${paid} stroops (${op.amount})`,
      );
}

/**
 * The asset, DERIVED rather than trusted.
 *
 * Horizon reports the payment's `code` and `issuer`; the contract holds a SAC
 * address. `Asset(code, issuer).contractId(passphrase)` is a pure function of the
 * network passphrase, the code and the issuer, with no AEGIS input anywhere in it
 * (SPEC.md §5), so recomputing it here is what binds the two forms together. No
 * value is taken from the receipt.
 */
export function checkPaymentAsset(
  op: HorizonOperation,
  networkPassphrase: string,
  d: ChainDecision,
): Check {
  const title = "the asset paid derives to the SAC address the contract authorized";
  const id = "payment.asset";
  let asset: Asset;
  let described: string;
  try {
    if (op.asset_type === "native") {
      asset = Asset.native();
      described = "XLM (native)";
    } else {
      if (op.asset_code === undefined || op.asset_issuer === undefined) {
        return fail(id, "horizon", title, "the payment names no asset code and issuer", d.asset, op.asset_type ?? "unknown");
      }
      asset = new Asset(op.asset_code, op.asset_issuer);
      described = `${op.asset_code}:${op.asset_issuer}`;
    }
  } catch (e) {
    return fail(id, "derived", title, (e as Error).message, d.asset, `${op.asset_code}:${op.asset_issuer}`);
  }
  const derived = asset.contractId(networkPassphrase);
  return derived === d.asset
    ? pass(id, "derived", title, `${described} derives to ${derived}`)
    : fail(
        id,
        "derived",
        title,
        `the executor paid a different asset than the one authorized (${described} derives to ${derived})`,
        d.asset,
        derived,
      );
}

export function checkDestination(
  op: HorizonOperation,
  serviceId: string,
  registryDestination: string,
  registryPath: string,
): Check {
  const title = "the payee is the published account for the decision's service_id";
  const id = "payment.destination";
  const to = op.to ?? "";
  return to === registryDestination
    ? pass(id, "registry", title, `${serviceId} -> ${to}, per ${registryPath}`)
    : fail(
        id,
        "registry",
        title,
        `the money went to an account that is not the published payee for "${serviceId}"`,
        registryDestination,
        to || "nothing",
      );
}

export function checkSource(tx: HorizonTransaction, executor: string, registryPath: string): Check {
  const title = "the transaction was submitted by the published executor account";
  const id = "payment.source";
  return tx.source_account === executor
    ? pass(id, "registry", title, `${executor}, per ${registryPath}`)
    : fail(
        id,
        "registry",
        title,
        "some other account submitted this payment",
        executor,
        tx.source_account || "nothing",
      );
}

// ---------------------------------------------------------------- strict mode

/**
 * `decision_id == sha256("AEGIS-DECISION-v1" || intent_hash || policy_version)`.
 *
 * DECISIONS.md #4 made the derivation deterministic precisely so a reviewer could
 * recompute it. Checking it here proves the decision id was not chosen freely —
 * it is a function of what was actually decided.
 */
export function checkDecisionIdDerivation(d: ChainDecision): Check {
  const title = 'decision_id == sha256("AEGIS-DECISION-v1" || intent_hash || policy_version)';
  const derived = deriveDecisionId(d.intentHash, d.policyVersion);
  return eq(derived, d.decisionId)
    ? pass("strict.decision_id", "derived", title, `recomputed: ${toHex(derived)}`)
    : fail(
        "strict.decision_id",
        "derived",
        title,
        "the decision id is not the derivation of its own inputs",
        toHex(derived),
        toHex(d.decisionId),
      );
}

/**
 * `mark_settled` landed at or before the payment.
 *
 * The double-settle guard only guards if it is taken FIRST. A settle flag written
 * after the money moved would have let a concurrent second payment through the
 * gate in between.
 *
 * The ledger of the write is read from the decision entry's
 * `lastModifiedLedgerSeq` — for a settled decision the last write is
 * `mark_settled`, since `authorize` necessarily preceded it.
 */
export function checkSettlementOrder(markSettledLedger: number, paymentLedger: number): Check {
  const title = "mark_settled was written at or before the payment's ledger";
  return markSettledLedger <= paymentLedger
    ? pass(
        "strict.settle_order",
        "soroban-rpc",
        title,
        `decision entry last written at ledger ${markSettledLedger}, payment in ledger ${paymentLedger}`,
      )
    : fail(
        "strict.settle_order",
        "soroban-rpc",
        title,
        "the double-settle guard was taken AFTER the money moved, so it guarded nothing",
        `<= ${paymentLedger}`,
        String(markSettledLedger),
      );
}

// ---------------------------------------------------------------- replay

/** Exactly one successful transaction carries this memo, across the accounts scanned. */
export function checkReplay(scan: MemoScan, txHash: string): Check {
  const title = "no other successful transaction carries this memo";
  const id = "replay.unique";
  const scope = `scanned ${scan.accounts.length} account(s): ${scan.accounts.join(", ")}`;

  if (!scan.exhaustive) {
    return unavailable(
      id,
      "horizon",
      title,
      `the history was longer than the page cap, so the scan proves nothing (${scope})`,
    );
  }
  if (!scan.hashes.includes(txHash)) {
    return fail(
      id,
      "horizon",
      title,
      "the scan did not even find the transaction under verification, so its result cannot be trusted",
      `${txHash} among the results`,
      scan.hashes.join(", ") || "no transactions carrying this memo",
    );
  }
  if (scan.hashes.length > 1) {
    return fail(
      id,
      "horizon",
      title,
      `the same decision was settled more than once (${scope})`,
      "1 transaction",
      `${scan.hashes.length}: ${scan.hashes.join(", ")}`,
    );
  }
  return pass(id, "horizon", title, `exactly one, and it is this one (${scope})`);
}

/**
 * The contract that was queried is the one the published registry names.
 *
 * Without this, a receipt could point the verifier at a contract of its own
 * choosing — one that happily returns an Approved, settled decision for any id.
 * Every RPC check below would then pass while proving nothing. The registry is
 * in the repository, so it is the one place a contract ID can be pinned from
 * outside the receipt.
 */
export function checkRegistryContract(
  contractIdUsed: string,
  registryContractId: string,
  registryPath: string,
): Check {
  const title = "the contract queried is the one the published registry names";
  return contractIdUsed === registryContractId
    ? pass("registry.contract", "registry", title, `${contractIdUsed}, per ${registryPath}`)
    : fail(
        "registry.contract",
        "registry",
        title,
        "the receipt pointed the verifier at a contract the repository does not publish, so nothing the contract said counts",
        registryContractId,
        contractIdUsed,
      );
}
