import { describe, expect, it } from "vitest";
import { Transaction } from "@stellar/stellar-sdk";
import { fromHex, memoHash, parseAmount, toHex } from "@aegis/canonical";
import { MAX_INT64_STROOPS, assertPayableAmount, deriveSac, preparePayment } from "../src/payment.js";
import { SettlementError } from "../src/errors.js";
import { DECISION_ID, EXECUTOR, INTENT_HASH, ISSUER, MERCHANT, NETWORK } from "./fixtures.js";

const memo = memoHash(fromHex(INTENT_HASH), 1, fromHex(DECISION_ID));

const build = (overrides: Partial<Parameters<typeof preparePayment>[0]> = {}) =>
  preparePayment({
    executor: EXECUTOR,
    currentSequence: "100",
    destination: MERCHANT.publicKey(),
    assetCode: "USDC",
    assetIssuer: ISSUER.publicKey(),
    amountStroops: 125_000_000n,
    memoHash: memo,
    networkPassphrase: NETWORK,
    maxTime: 1_800_000_180,
    ...overrides,
  });

describe("assertPayableAmount", () => {
  it("refuses a non-positive amount", () => {
    expect(() => assertPayableAmount(0n)).toThrowError(SettlementError);
    expect(() => assertPayableAmount(-1n)).toThrowError(/AMOUNT_OUT_OF_RANGE|non-positive/);
  });

  it("refuses an i128 that does not fit the classic int64 rail", () => {
    expect(() => assertPayableAmount(MAX_INT64_STROOPS + 1n)).toThrowError(/int64/);
    expect(() => assertPayableAmount(MAX_INT64_STROOPS)).not.toThrow();
  });
});

describe("preparePayment", () => {
  it("is fully determined offline: identical inputs give an identical hash", () => {
    // This is the property that makes 'precompute the hash before submitting'
    // possible at all, and the reason the rail is classic rather than a SAC call.
    expect(build().txHash).toBe(build().txHash);
    expect(build().envelopeXdr).toBe(build().envelopeXdr);
  });

  it("consumes currentSequence + 1", () => {
    expect(build({ currentSequence: "100" }).sequence).toBe("101");
  });

  it("carries the 32-byte MEMO_HASH, the amount, the asset and the destination", () => {
    const prepared = build();
    const tx = new Transaction(prepared.envelopeXdr, NETWORK);

    expect(tx.memo.type).toBe("hash");
    expect(toHex(Uint8Array.from(tx.memo.value as Buffer))).toBe(toHex(memo));

    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0];
    expect(op?.type).toBe("payment");
    if (op?.type !== "payment") throw new Error("unreachable");
    expect(op.destination).toBe(MERCHANT.publicKey());
    // Compared through parseAmount, exactly as the verifier compares it: the SDK
    // round-trips "12.5" as "12.5000000" and only the stroop value is meaningful.
    expect(parseAmount(op.amount)).toBe(125_000_000n);
    expect(op.asset.getCode()).toBe("USDC");
    expect(op.asset.getIssuer()).toBe(ISSUER.publicKey());
  });

  it("sets an absolute maxTime — the input to the non-inclusion proof", () => {
    const tx = new Transaction(build().envelopeXdr, NETWORK);
    expect(tx.timeBounds?.maxTime).toBe("1800000180");
    expect(tx.timeBounds?.minTime).toBe("0");
  });

  it("signs the stored envelope, so a retry can re-POST identical bytes", () => {
    const tx = new Transaction(build().envelopeXdr, NETWORK);
    expect(tx.signatures.length).toBe(1);
    // Signatures are outside the hash preimage: the stored hash is the signed hash.
    expect(tx.hash().toString("hex")).toBe(build().txHash);
  });

  it("refuses a memo that is not 32 bytes", () => {
    expect(() => build({ memoHash: new Uint8Array(31) })).toThrowError(/32 bytes/);
  });
});

describe("deriveSac", () => {
  it("is a pure function of passphrase, code and issuer", () => {
    expect(deriveSac("USDC", ISSUER.publicKey(), NETWORK)).toBe(
      deriveSac("USDC", ISSUER.publicKey(), NETWORK),
    );
    expect(deriveSac("USDC", ISSUER.publicKey(), NETWORK)).not.toBe(
      deriveSac("USDC", ISSUER.publicKey(), "Public Global Stellar Network ; September 2015"),
    );
  });

  it("reproduces the SAC the published registry names for testnet USDC", () => {
    // The one value in this suite taken from the live deployment: if
    // Asset(...).contractId() ever stopped agreeing with it, every asset gate in
    // the executor would be comparing against the wrong thing.
    expect(deriveSac("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", NETWORK)).toBe(
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    );
  });
});
