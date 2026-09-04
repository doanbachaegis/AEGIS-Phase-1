/**
 * One test per property, on both sides: the honest settlement passes, and the
 * specific way a dishonest one differs is caught.
 *
 * These are the tests that can run TODAY. Phase 1 has an approved decision on
 * chain but no settlement transaction, so the Horizon-side properties have no
 * live subject yet — the fixtures stand in for one, and the pure functions here
 * are the same ones the CLI calls against real Horizon data.
 */
import { describe, expect, it } from "vitest";
import { fromHex, toHex } from "@aegis/canonical";
import * as check from "../src/checks.js";
import type { MemoScan } from "../src/horizon.js";
import * as f from "./fixtures.js";

describe("the receipt names the transaction under verification", () => {
  it("passes when --tx and the receipt agree", () => {
    expect(check.checkTxMatchesReceipt(f.TX_HASH, f.receipt()).status).toBe("pass");
  });

  it("fails when the receipt describes a different transaction", () => {
    const c = check.checkTxMatchesReceipt("22".repeat(32), f.receipt());
    expect(c.status).toBe("fail");
    expect(c.actual).toBe("22".repeat(32));
  });
});

describe("Horizon: the transaction itself", () => {
  it("passes for a successful transaction", () => {
    expect(check.checkTransactionSuccessful(f.transaction()).status).toBe("pass");
  });

  it("fails for a transaction that is on the ledger but failed", () => {
    // A failed transaction still has a hash and still carries the memo. Without
    // this check a receipt could point at one and look settled.
    const c = check.checkTransactionSuccessful(f.transaction({ successful: false }));
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("no money moved");
  });

  it("reports a missing transaction as a failure, not as unavailable", () => {
    // 404 is an answer from Horizon: this settlement never happened.
    expect(check.checkTransactionNotFound(f.TX_HASH).status).toBe("fail");
  });
});

describe("Horizon: exactly one payment operation", () => {
  it("passes for a single payment", () => {
    const r = check.checkSinglePaymentOperation(f.transaction(), [f.payment()]);
    expect(r.check.status).toBe("pass");
    expect(r.payment?.to).toBe(f.MERCHANT);
  });

  it("fails when a second operation rides along under the same memo", () => {
    const r = check.checkSinglePaymentOperation(
      f.transaction({ operation_count: 2 }),
      [f.payment(), f.payment({ to: f.AGENT })],
    );
    expect(r.check.status).toBe("fail");
    expect(r.payment).toBeUndefined();
  });

  it("fails when the single operation is not a payment", () => {
    const r = check.checkSinglePaymentOperation(f.transaction(), [{ type: "create_account" }]);
    expect(r.check.status).toBe("fail");
    expect(r.check.actual).toBe("create_account");
  });
});

describe("Horizon: the memo", () => {
  it("decodes a 32-byte hash memo", () => {
    const r = check.checkMemoIsHash32(f.transaction());
    expect(r.check.status).toBe("pass");
    expect(toHex(r.memo as Uint8Array)).toBe(f.MEMO_HEX);
  });

  it("fails when the transaction carries no hash memo at all", () => {
    const r = check.checkMemoIsHash32(f.transaction({ memo_type: "none", memo: undefined }));
    expect(r.check.status).toBe("fail");
    expect(r.check.detail).toContain("no commitment");
  });

  it("fails when the memo decodes to the wrong length", () => {
    const short = Buffer.from("short").toString("base64");
    const r = check.checkMemoIsHash32(f.transaction({ memo: short }));
    expect(r.check.status).toBe("fail");
  });

  it("rejects non-canonical base64 rather than accepting what it decodes to", () => {
    const r = check.decodeMemo(f.transaction({ memo: `${f.MEMO_BASE64}###` }));
    expect(r).not.toBeInstanceOf(Uint8Array);
  });
});

describe("Soroban RPC: the decision", () => {
  it("passes when the contract holds the decision", () => {
    expect(check.checkDecisionFound(f.decision()).status).toBe("pass");
  });

  it("fails when the contract holds no such decision", () => {
    expect(check.checkDecisionNotFound(f.DECISION_ID).status).toBe("fail");
  });

  it("passes on an Approved verdict", () => {
    expect(check.checkVerdictApproved(f.decision()).status).toBe("pass");
  });

  it("fails on Rejected and on RequiresApproval alike", () => {
    for (const verdict of ["Rejected", "RequiresApproval"]) {
      const c = check.checkVerdictApproved(f.decision({ verdict }));
      expect(c.status).toBe("fail");
      expect(c.actual).toBe(verdict);
    }
  });

  it("passes when settled is true", () => {
    expect(check.checkSettled(f.decision()).status).toBe("pass");
  });

  it("fails when the decision was never marked settled", () => {
    // This is the path the live decision takes today: Approved but unsettled.
    const c = check.checkSettled(f.decision({ settled: false }));
    expect(c.status).toBe("fail");
    expect(c.actual).toBe("settled == false");
  });
});

describe("the receipt's chain block against the decision the contract holds", () => {
  it("passes when all seven fields agree", () => {
    expect(check.checkReceiptMatchesDecision(f.receipt(), f.decision()).status).toBe("pass");
  });

  it("catches an amount the memo does not commit to", () => {
    // amount is OUTSIDE the memo preimage, so nothing else would catch this.
    const c = check.checkReceiptMatchesDecision(
      f.receipt({ chain: { amount: "999" } }),
      f.decision(),
    );
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("amount");
  });

  it("catches a restated service_id, which is also outside the memo", () => {
    const c = check.checkReceiptMatchesDecision(
      f.receipt({ chain: { service_id: "anthropic-api" } }),
      f.decision(),
    );
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("service_id");
  });

  it("lists every field that differs, not just the first", () => {
    const c = check.checkReceiptMatchesDecision(
      f.receipt({ chain: { amount: "1", agent: f.MERCHANT, service_id: "x" } }),
      f.decision(),
    );
    expect(c.actual).toContain("3 field(s)");
  });
});

describe("★ the §6.3 commitment", () => {
  it("recomputes the on-ledger memo from the decision's own fields", () => {
    const c = check.checkMemoCommitment(f.receipt(), f.MEMO);
    expect(c.status).toBe("pass");
    expect(c.detail).toContain(f.MEMO_HEX);
  });

  it("fails when the payment commits to a different decision", () => {
    const other = fromHex("00".repeat(32));
    const c = check.checkMemoCommitment(f.receipt(), other);
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("does NOT commit to this decision");
  });

  it("is sensitive to the policy_version encoding", () => {
    // policy_version is the one field of the preimage whose encoding the SOW
    // left open; SPEC.md §2 pins it to a big-endian u32. Bumping it must move
    // the hash, or the pinning would be decorative.
    const c = check.checkMemoCommitment(f.receipt({ chain: { policy_version: 2 } }), f.MEMO);
    expect(c.status).toBe("fail");
  });

  it("agrees with the contract's own on-chain computation", () => {
    expect(check.checkContractMemoHash(f.MEMO, f.MEMO).status).toBe("pass");
  });

  it("fails when the contract computes a different commitment", () => {
    const c = check.checkContractMemoHash(fromHex("00".repeat(32)), f.MEMO);
    expect(c.status).toBe("fail");
  });
});

describe("the receipt's 68-byte preimage", () => {
  it("hashes to the on-ledger memo", () => {
    expect(check.checkReceiptPreimage(f.receipt(), f.MEMO).status).toBe("pass");
  });

  it("fails when the preimage does not spell out the receipt's own chain fields", () => {
    const tampered = `${"00".repeat(32)}00000001${f.DECISION_ID}`;
    const c = check.checkReceiptPreimage(
      f.receipt({ settlement: { memo_preimage: tampered } }),
      f.MEMO,
    );
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("does not spell out");
  });

  it("fails when the preimage is consistent but the ledger carries another memo", () => {
    const c = check.checkReceiptPreimage(f.receipt(), fromHex("00".repeat(32)));
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("hashes to something else");
  });

  it("fails when the receipt states a memo the ledger does not carry", () => {
    const c = check.checkReceiptMemoHash(
      f.receipt({ settlement: { memo_hash: "00".repeat(32) } }),
      f.MEMO,
    );
    expect(c.status).toBe("fail");
  });
});

describe("the amount", () => {
  it("passes when the payment equals the authorized stroops", () => {
    const c = check.checkPaymentAmount(f.payment(), f.decision());
    expect(c.status).toBe("pass");
    expect(c.detail).toContain("125000000 stroops");
  });

  it("catches a single stroop of overpayment", () => {
    // The whole point of parsing the decimal string instead of using a float:
    // 12.5000001 and 12.5 must not compare equal.
    const c = check.checkPaymentAmount(f.payment({ amount: "12.5000001" }), f.decision());
    expect(c.status).toBe("fail");
    expect(c.actual).toContain("125000001");
  });

  it("catches underpayment", () => {
    expect(check.checkPaymentAmount(f.payment({ amount: "12.4999999" }), f.decision()).status)
      .toBe("fail");
  });

  it("fails rather than throws on an unparseable amount", () => {
    expect(check.checkPaymentAmount(f.payment({ amount: "1e7" }), f.decision()).status).toBe("fail");
  });

  it("handles an amount larger than Number.MAX_SAFE_INTEGER without loss", () => {
    const huge = 92233720368547758n;
    const c = check.checkPaymentAmount(
      f.payment({ amount: "9223372036.8547758" }),
      f.decision({ amount: huge }),
    );
    expect(c.status).toBe("pass");
  });
});

describe("the asset, derived rather than trusted", () => {
  it("derives the SAC from the payment's code and issuer", () => {
    const c = check.checkPaymentAsset(f.payment(), f.PASSPHRASE, f.decision());
    expect(c.status).toBe("pass");
    expect(c.detail).toContain(f.SAC);
  });

  it("fails when a different issuer is paid under the same code", () => {
    // A look-alike USDC from another issuer derives to a different SAC. Comparing
    // the code alone would wave this through.
    const c = check.checkPaymentAsset(
      f.payment({ asset_issuer: f.AGENT }),
      f.PASSPHRASE,
      f.decision(),
    );
    expect(c.status).toBe("fail");
  });

  it("fails when XLM is paid against a credit-asset decision", () => {
    const c = check.checkPaymentAsset(
      f.payment({ asset_type: "native", asset_code: undefined, asset_issuer: undefined }),
      f.PASSPHRASE,
      f.decision(),
    );
    expect(c.status).toBe("fail");
  });

  it("derives a different SAC on a different network passphrase", () => {
    // The derivation binds the asset to a network; a mainnet-derived SAC must not
    // satisfy a testnet decision.
    const c = check.checkPaymentAsset(f.payment(), "Public Global Stellar Network ; September 2015", f.decision());
    expect(c.status).toBe("fail");
  });
});

describe("the parties, against the published registry", () => {
  it("passes when the payee is the published destination", () => {
    const c = check.checkDestination(f.payment(), "openai-api", f.MERCHANT, "services.json");
    expect(c.status).toBe("pass");
  });

  it("fails when the money went somewhere else", () => {
    const c = check.checkDestination(
      f.payment({ to: f.AGENT }),
      "openai-api",
      f.MERCHANT,
      "services.json",
    );
    expect(c.status).toBe("fail");
    expect(c.actual).toBe(f.AGENT);
  });

  it("passes when the published executor submitted the transaction", () => {
    expect(check.checkSource(f.transaction(), f.EXECUTOR, "services.json").status).toBe("pass");
  });

  it("fails when some other account submitted it", () => {
    const c = check.checkSource(f.transaction({ source_account: f.AGENT }), f.EXECUTOR, "services.json");
    expect(c.status).toBe("fail");
  });
});

describe("the registry pins the contract", () => {
  it("passes when the contract queried is the published one", () => {
    expect(check.checkRegistryContract(f.CONTRACT_ID, f.CONTRACT_ID, "services.json").status).toBe("pass");
  });

  it("fails when the receipt nominated a contract of its own", () => {
    // Otherwise a receipt could name a contract that returns Approved+settled
    // for anything, and every RPC check would pass while proving nothing.
    const c = check.checkRegistryContract(f.SAC, f.CONTRACT_ID, "services.json");
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("does not publish");
  });
});

describe("strict mode", () => {
  it("recomputes decision_id from intent_hash and policy_version", () => {
    const c = check.checkDecisionIdDerivation(f.decision());
    expect(c.status).toBe("pass");
    expect(c.detail).toContain(f.DECISION_ID);
  });

  it("fails when decision_id is not the derivation of its own inputs", () => {
    const c = check.checkDecisionIdDerivation(f.decision({ decisionId: fromHex("00".repeat(32)) }));
    expect(c.status).toBe("fail");
  });

  it("accepts mark_settled in the same ledger as the payment", () => {
    expect(check.checkSettlementOrder(4494400, 4494400).status).toBe("pass");
  });

  it("accepts mark_settled before the payment", () => {
    expect(check.checkSettlementOrder(4494399, 4494400).status).toBe("pass");
  });

  it("fails when the double-settle guard was taken after the money moved", () => {
    const c = check.checkSettlementOrder(4494401, 4494400);
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("guarded nothing");
  });
});

describe("the replay scan", () => {
  const scan = (over: Partial<MemoScan> = {}): MemoScan => ({
    hashes: [f.TX_HASH],
    accounts: [f.EXECUTOR, f.MERCHANT],
    exhaustive: true,
    ...over,
  });

  it("passes when exactly one transaction carries the memo", () => {
    const c = check.checkReplay(scan(), f.TX_HASH);
    expect(c.status).toBe("pass");
  });

  it("fails when the same decision was settled twice", () => {
    const c = check.checkReplay(scan({ hashes: [f.TX_HASH, "33".repeat(32)] }), f.TX_HASH);
    expect(c.status).toBe("fail");
    expect(c.actual).toContain("2:");
  });

  it("is unavailable, never a pass, when the page cap cut the scan short", () => {
    // A truncated scan cannot support a uniqueness claim, and saying so is the
    // difference between "checked" and "could not check".
    const c = check.checkReplay(scan({ exhaustive: false }), f.TX_HASH);
    expect(c.status).toBe("unavailable");
  });

  it("fails when the scan cannot even see the transaction under verification", () => {
    const c = check.checkReplay(scan({ hashes: [] }), f.TX_HASH);
    expect(c.status).toBe("fail");
    expect(c.detail).toContain("cannot be trusted");
  });
});
