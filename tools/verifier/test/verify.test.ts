/**
 * End-to-end through `verify()`, with both public sources stubbed.
 *
 * Phase 1 has no settlement on the ledger yet, so this is the only place a fully
 * VERIFIED run can be exercised — and it needs to exist before the executor
 * lands, or the passing path would first be exercised in front of the client.
 * Horizon is stubbed at `fetch`, so the URL shapes and the JSON field names the
 * real tool depends on are part of what is asserted here.
 *
 * The registry is NOT stubbed: these run against the repository's real
 * `services.json`.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Receipt } from "@aegis/receipt";
import type { CliOptions } from "../src/args.js";
import { renderReport } from "../src/report.js";
import { EXIT } from "../src/types.js";
import { verify } from "../src/verify.js";
import * as f from "./fixtures.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const REGISTRY = join(REPO_ROOT, "services.json");

// The chain module is replaced wholesale: `connect` is the single seam through
// which every Soroban RPC fact enters the verifier.
const chainState = {
  decision: f.decision(),
  memoHash: f.MEMO,
  settledLedger: 4494400,
};

vi.mock("../src/chain.js", () => ({
  connect: async () => ({
    getDecision: async () => chainState.decision,
    memoHash: async () => chainState.memoHash,
    decisionEntryLastModifiedLedger: async () => chainState.settledLedger,
  }),
}));

const horizonState = {
  transaction: f.transaction(),
  operations: [f.payment()],
  /** Extra transactions the replay scan should find in the accounts' histories. */
  extraInHistory: [] as { hash: string; memo: string }[],
};

const txRecord = (hash: string, memo: string): Record<string, unknown> => ({
  hash,
  successful: true,
  memo_type: "hash",
  memo,
});

function stubFetch(): void {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const json = (body: unknown): Response =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    if (url.includes("/operations")) {
      return json({ _embedded: { records: horizonState.operations } });
    }
    if (/\/accounts\/[^/]+\/transactions/.test(url)) {
      const records = [
        txRecord(horizonState.transaction.hash, horizonState.transaction.memo ?? ""),
        ...horizonState.extraInHistory.map((t) => txRecord(t.hash, t.memo)),
      ];
      return json({ _embedded: { records }, _links: {} });
    }
    if (url.includes("/transactions/")) {
      return json(horizonState.transaction);
    }
    return new Response("not found", { status: 404 });
  });
}

let dir: string;

const writeReceipt = (receipt: Receipt): string => {
  const path = join(dir, "receipt.json");
  writeFileSync(path, JSON.stringify(receipt, null, 2));
  return path;
};

const options = (receiptPath: string, over: Partial<CliOptions> = {}): CliOptions => ({
  tx: f.TX_HASH,
  receipt: receiptPath,
  registry: REGISTRY,
  json: false,
  strict: true,
  ...over,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aegis-verify-"));
  chainState.decision = f.decision();
  chainState.memoHash = f.MEMO;
  chainState.settledLedger = 4494400;
  horizonState.transaction = f.transaction();
  horizonState.operations = [f.payment()];
  horizonState.extraInHistory = [];
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("an honest settlement", () => {
  it("verifies, with every check passing", async () => {
    const report = await verify(options(writeReceipt(f.receipt())));
    const notPassing = report.checks.filter((c) => c.status !== "pass");
    expect(notPassing.map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(report.verdict).toBe("VERIFIED");
    expect(report.exitCode).toBe(EXIT.VERIFIED);
  });

  it("checks the §6.3 commitment three independent ways", async () => {
    const report = await verify(options(writeReceipt(f.receipt())));
    const ids = report.checks.filter((c) => c.status === "pass").map((c) => c.id);
    expect(ids).toContain("commitment.memo_matches"); // recomputed locally
    expect(ids).toContain("rpc.contract_memo_hash"); // recomputed by the contract
    expect(ids).toContain("receipt.preimage"); // hashed from the receipt
  });

  it("renders a report whose verdict cannot be misread", async () => {
    const report = await verify(options(writeReceipt(f.receipt())));
    const text = renderReport(report);
    expect(text).toContain("VERDICT: VERIFIED");
    expect(text).toContain("Horizon + Soroban RPC");
    // Every line carries the source of its evidence, and none of them is AEGIS.
    expect(text).not.toMatch(/aegis-api|api\.aegis/i);
  });

  it("skips the strict-only checks when --strict is not given", async () => {
    const report = await verify(options(writeReceipt(f.receipt()), { strict: false }));
    expect(report.checks.map((c) => c.id)).not.toContain("strict.decision_id");
    expect(report.exitCode).toBe(EXIT.VERIFIED);
  });
});

describe("a settlement that does not match its authorization", () => {
  const failing = async (
    mutate: () => string,
  ): Promise<{ id: string; detail: string }[]> => {
    const path = mutate();
    const report = await verify(options(path));
    expect(report.exitCode).toBe(EXIT.FAILED);
    expect(report.verdict).toBe("FAILED");
    return report.checks.filter((c) => c.status === "fail").map((c) => ({ id: c.id, detail: c.detail }));
  };

  it("catches a payment that commits to a different decision", async () => {
    const fails = await failing(() => {
      horizonState.transaction = f.transaction({ memo: Buffer.alloc(32, 7).toString("base64") });
      return writeReceipt(f.receipt());
    });
    expect(fails.map((x) => x.id)).toContain("commitment.memo_matches");
  });

  it("catches an amount the contract never authorized", async () => {
    const fails = await failing(() => {
      horizonState.operations = [f.payment({ amount: "125.0000000" })];
      return writeReceipt(f.receipt());
    });
    expect(fails.map((x) => x.id)).toContain("payment.amount");
  });

  it("catches money sent to an unpublished account", async () => {
    const fails = await failing(() => {
      horizonState.operations = [f.payment({ to: f.AGENT })];
      return writeReceipt(f.receipt());
    });
    expect(fails.map((x) => x.id)).toContain("payment.destination");
  });

  it("catches a decision that was never marked settled", async () => {
    // The state the live decision is in today.
    const fails = await failing(() => {
      chainState.decision = f.decision({ settled: false });
      return writeReceipt(f.receipt());
    });
    expect(fails.map((x) => x.id)).toContain("rpc.settled");
  });

  it("catches the same decision being settled twice", async () => {
    const fails = await failing(() => {
      horizonState.extraInHistory = [{ hash: "44".repeat(32), memo: f.MEMO_BASE64 }];
      return writeReceipt(f.receipt());
    });
    expect(fails.map((x) => x.id)).toContain("replay.unique");
  });

  it("catches a receipt pointing at a contract the registry does not publish", async () => {
    const fails = await failing(() => {
      const r = f.receipt();
      r.network.contract_id = f.SAC;
      return writeReceipt(r);
    });
    expect(fails.map((x) => x.id)).toContain("registry.contract");
  });

  it("prints expected and actual side by side so a failure reads unmistakably", async () => {
    chainState.decision = f.decision({ settled: false });
    const report = await verify(options(writeReceipt(f.receipt())));
    const text = renderReport(report);
    expect(text).toContain("VERDICT: FAILED");
    expect(text).toContain("expected: settled == true");
    expect(text).toContain("actual:   settled == false");
    expect(text).toContain("not a transient problem");
  });
});

describe("a receipt that does not parse", () => {
  it("fails with the parse issues and attempts nothing else", async () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ version: "aegis-receipt/1" }));
    const report = await verify(options(path));
    expect(report.exitCode).toBe(EXIT.FAILED);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.id).toBe("receipt.parse");
  });
});

describe("a source that cannot be reached", () => {
  it("reports UNAVAILABLE, never VERIFIED, when Horizon is down", async () => {
    // The distinction the exit codes exist for: an outage is not a pass.
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const report = await verify(options(writeReceipt(f.receipt()), { strict: false }));
    expect(report.exitCode).toBe(EXIT.UNAVAILABLE);
    expect(report.verdict).toBe("UNAVAILABLE");
    expect(report.checks.some((c) => c.status === "fail")).toBe(false);
    expect(renderReport(report)).toContain("This is NOT a pass");
  });

  it("still fails outright when a real mismatch is found alongside an outage", async () => {
    chainState.decision = f.decision({ verdict: "Rejected", reasonCode: "CapExceeded" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    const report = await verify(options(writeReceipt(f.receipt()), { strict: false }));
    expect(report.exitCode).toBe(EXIT.FAILED);
  });
});
