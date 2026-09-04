/**
 * Building the settlement payment.
 *
 * ## Why a classic payment and not a SAC `transfer`
 *
 * The executor is required to precompute the transaction hash and commit it
 * BEFORE submitting, because that hash is the only handle recovery has on a
 * transaction whose fate is unknown. A classic payment envelope is fully
 * determined offline — source, sequence, fee, operation, memo, time bounds are
 * all known before any network call, so its hash is too. A Soroban invocation
 * is not: it must be assembled from a simulation whose footprint and resource
 * fees depend on live ledger state, so its bytes (and therefore its hash) are
 * not knowable until the moment of assembly. "Precompute the hash before
 * submitting" and "assemble from a fresh simulation" cannot both be true.
 *
 * Two further consequences fall out in the verifier's favour: Horizon exposes a
 * classic payment as structured `{from, to, asset_code, asset_issuer, amount}`
 * fields rather than XDR a reviewer must decode, and Horizon keeps that history
 * for ever where Soroban RPC keeps about a week.
 *
 * ## The memo is the commitment
 *
 * `Memo.hash(sha256(intent_hash || policy_version_be || decision_id))` is what
 * turns a payment on a public ledger into a payment that provably refers to one
 * specific governance decision (SOW §6.3). It is fixed when the transaction is
 * signed and cannot be edited afterwards.
 */
import { Buffer } from "node:buffer";
import {
  Account,
  Asset,
  Memo,
  Operation,
  TransactionBuilder,
  type Keypair,
} from "@stellar/stellar-sdk";
import { formatAmount } from "@aegis/canonical";
import { SettlementError } from "./errors.js";

/** A Stellar classic amount is an int64 of stroops. An i128 decision amount may not fit. */
export const MAX_INT64_STROOPS = 9223372036854775807n;

/**
 * Fixed at prepare time because the fee is part of the envelope and therefore
 * part of the hash. Chosen generously (1000x base) so that surge pricing does
 * not strand a settlement: a fee too low would force a fee bump, and although a
 * fee bump legitimately preserves the inner hash, not needing one is simpler.
 */
export const PAYMENT_FEE_STROOPS = "100000";

export interface PreparedPayment {
  /** Precomputed, before submission. Lowercase hex. */
  txHash: string;
  /** The SIGNED envelope, base64. Re-POSTed byte-for-byte on retry. */
  envelopeXdr: string;
  source: string;
  /** The sequence number this envelope consumes, decimal string. */
  sequence: string;
  /** Absolute unix seconds. Past this, non-inclusion becomes provable. */
  maxTime: number;
  destination: string;
  amountStroops: bigint;
  /** The decimal form Horizon will echo back, e.g. "12.5". */
  amountDecimal: string;
  memoHash: Uint8Array;
}

/**
 * `Asset(code, issuer).contractId(passphrase)` — a pure function of the network
 * passphrase, the code and the issuer, with no AEGIS input anywhere in it.
 * Recomputing it is what binds the `CODE:ISSUER` the ledger will show to the SAC
 * address the contract compared, which is why the executor derives it rather
 * than reading `USDC_SAC_ADDRESS` out of the environment.
 */
export const deriveSac = (code: string, issuer: string, networkPassphrase: string): string =>
  new Asset(code, issuer).contractId(networkPassphrase);

/** Throws `AMOUNT_OUT_OF_RANGE` unless the i128 amount fits the classic int64 rail. */
export function assertPayableAmount(stroops: bigint): void {
  if (stroops <= 0n) {
    throw new SettlementError("AMOUNT_OUT_OF_RANGE", "the decision authorizes a non-positive amount", {
      expected: "> 0 stroops",
      actual: `${stroops} stroops`,
    });
  }
  if (stroops > MAX_INT64_STROOPS) {
    throw new SettlementError(
      "AMOUNT_OUT_OF_RANGE",
      "the decision's i128 amount does not fit an int64 classic payment",
      { expected: `<= ${MAX_INT64_STROOPS} stroops`, actual: `${stroops} stroops` },
    );
  }
}

export function preparePayment(options: {
  executor: Keypair;
  /** The account's CURRENT sequence, as Horizon reports it. The envelope uses this + 1. */
  currentSequence: string;
  destination: string;
  assetCode: string;
  assetIssuer: string;
  amountStroops: bigint;
  memoHash: Uint8Array;
  networkPassphrase: string;
  maxTime: number;
}): PreparedPayment {
  const { executor, currentSequence, destination, amountStroops, memoHash, networkPassphrase, maxTime } =
    options;

  assertPayableAmount(amountStroops);
  if (memoHash.length !== 32) {
    throw new SettlementError("MEMO_MISMATCH", "the memo is not 32 bytes", {
      expected: "32 bytes",
      actual: `${memoHash.length} bytes`,
    });
  }

  const amountDecimal = formatAmount(amountStroops);
  const asset = new Asset(options.assetCode, options.assetIssuer);
  const source = executor.publicKey();

  const tx = new TransactionBuilder(new Account(source, currentSequence), {
    fee: PAYMENT_FEE_STROOPS,
    networkPassphrase,
    memo: Memo.hash(Buffer.from(memoHash)),
  })
    .addOperation(Operation.payment({ destination, asset, amount: amountDecimal }))
    // An explicit absolute maxTime, never `setTimeout(n)`: the recovery proof
    // needs a value that is fixed in the signed bytes and readable back from
    // the store, so that "Horizon's latest ledger closed after max_time and the
    // hash still 404s" can be evaluated by a process that did not build it.
    .setTimebounds(0, maxTime)
    .build();

  // Signatures are not part of the hash preimage, so this value is identical
  // before and after signing — but sign first anyway, so the envelope that gets
  // stored is the one that can actually be submitted.
  tx.sign(executor);

  return {
    txHash: tx.hash().toString("hex"),
    envelopeXdr: tx.toEnvelope().toXDR("base64"),
    source,
    sequence: tx.sequence,
    maxTime,
    destination,
    amountStroops,
    amountDecimal,
    memoHash,
  };
}
