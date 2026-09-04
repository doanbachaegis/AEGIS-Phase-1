import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fromHex, memoHash, toHex } from "@aegis/canonical";
import { RECEIPT_VERSION, safeParseReceipt } from "@aegis/receipt";
import { buildReceipt, memoPreimage } from "../src/receipt.js";
import { CONTRACT_ID, ISSUER, MERCHANT, NETWORK, EXECUTOR, makeDecision } from "./fixtures.js";

const decision = makeDecision();
const memo = memoHash(decision.intentHash, decision.policyVersion, decision.decisionId);

const receipt = buildReceipt({
  decision,
  networkPassphrase: NETWORK,
  contractId: CONTRACT_ID,
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  txHash: "c".repeat(64),
  memoHash: memo,
  source: EXECUTOR.publicKey(),
  destination: MERCHANT.publicKey(),
  assetCode: "USDC",
  assetIssuer: ISSUER.publicKey(),
  issuedAt: "2026-09-04T12:00:00Z",
});

describe("buildReceipt", () => {
  it("emits a document @aegis/receipt's own validator accepts", () => {
    // The executor writes the claim and the verifier refutes it. Running the
    // shared parser on the way out is what stops the two drifting apart.
    expect(safeParseReceipt(JSON.parse(JSON.stringify(receipt)))).toMatchObject({ ok: true });
    expect(receipt.version).toBe(RECEIPT_VERSION);
  });

  it("writes the amount as a decimal STRING of stroops", () => {
    // A JSON number cannot hold an i128; the validator rejects one outright.
    expect(receipt.chain.amount).toBe("125000000");
    expect(typeof receipt.chain.amount).toBe("string");
  });

  it("writes a 68-byte preimage that hashes to the memo it states", () => {
    const preimage = fromHex(receipt.settlement.memo_preimage);
    expect(preimage).toHaveLength(68);
    expect(toHex(new Uint8Array(createHash("sha256").update(preimage).digest()))).toBe(
      receipt.settlement.memo_hash,
    );
  });

  it("spells out its own chain fields in that preimage: intent_hash || policy_version || decision_id", () => {
    const preimage = fromHex(receipt.settlement.memo_preimage);
    expect(toHex(preimage.subarray(0, 32))).toBe(receipt.chain.intent_hash);
    expect(new DataView(preimage.buffer, preimage.byteOffset).getUint32(32, false)).toBe(
      receipt.chain.policy_version,
    );
    expect(toHex(preimage.subarray(36))).toBe(receipt.chain.decision_id);
  });

  it("uses the same byte layout as memoHash itself", () => {
    expect(toHex(memoPreimage(decision))).toBe(receipt.settlement.memo_preimage);
  });

  it("writes the canonical CODE:ISSUER asset form", () => {
    expect(receipt.settlement.asset).toBe(`USDC:${ISSUER.publicKey()}`);
    expect(receipt.chain.asset).toBe(decision.asset);
  });
});
