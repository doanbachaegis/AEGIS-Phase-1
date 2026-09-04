import { afterEach, describe, expect, it, vi } from "vitest";
import { findSettlement } from "../src/horizon.js";

/**
 * The settlement link is the one value on the evidence page that is neither stored
 * on-chain nor taken from the AEGIS database — it is SEARCHED for. These tests pin the
 * two properties that make that search honest: it finds the transaction the memo
 * commits to, and it never overstates what it looked at.
 *
 * `fetch` is stubbed, so nothing here touches the network. The accounts come from
 * vitest.config.ts and are the real published ones.
 */

const EXECUTOR = "GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3";
const MERCHANT = "GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY";

/** A real memo_hash from evidence/d3-receipts/01-s01, with its real base64 encoding. */
const MEMO = "0510ea1a70eb2a1a1d3f9e4e0e6bb15c3fb2e1e0dfc0a4bb1e1f8e0a0e1c2d3f";
const MEMO_B64 = Buffer.from(MEMO, "hex").toString("base64");

const TX = "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb8888";

const txRecord = (over: Record<string, unknown> = {}) => ({
  hash: TX,
  successful: true,
  ledger: 1234,
  created_at: "2026-09-04T00:00:00Z",
  source_account: EXECUTOR,
  memo_type: "hash",
  memo: MEMO_B64,
  ...over,
});

const page = (records: unknown[], next?: string) => ({
  _embedded: { records },
  _links: next !== undefined ? { next: { href: next } } : {},
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Routes by URL so a test states what each account and each operations call returns. */
function stubFetch(routes: (url: string) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => routes(String(url))));
}

const emptyOps = ok(page([]));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findSettlement", () => {
  it("finds the transaction whose MEMO_HASH is the contract's memo_hash()", async () => {
    stubFetch((url) => {
      if (url.includes("/operations")) {
        return ok(
          page([
            { type: "create_account" },
            {
              type: "payment",
              from: EXECUTOR,
              to: MERCHANT,
              amount: "12.5000000",
              asset_code: "USDC",
              asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            },
          ]),
        );
      }
      return ok(page(url.includes(EXECUTOR) ? [txRecord()] : []));
    });

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("found");
    if (scan.status !== "found") return;
    expect(scan.matches).toHaveLength(1);
    expect(scan.matches[0]!.hash).toBe(TX);
    // The payment triple is what SOW §4.1 D3 asks a verifier to check, so it is carried
    // to the page rather than left as a bare link.
    expect(scan.matches[0]!.payment).toEqual({
      from: EXECUTOR,
      to: MERCHANT,
      amount: "12.5000000",
      assetCode: "USDC",
      assetIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });
  });

  it("counts one settlement once even though it appears in BOTH scanned accounts", async () => {
    // A settlement is a payment from the executor to the merchant, so it is genuinely in
    // both histories. Reporting it twice would look exactly like a double-settle.
    stubFetch((url) => (url.includes("/operations") ? emptyOps : ok(page([txRecord()]))));

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("found");
    if (scan.status !== "found") return;
    expect(scan.matches).toHaveLength(1);
    expect(scan.scanned).toEqual([EXECUTOR, MERCHANT]);
  });

  it("reports two matches rather than picking a winner", async () => {
    const other = TX.replace("aaaa1111", "9999cccc");
    stubFetch((url) =>
      url.includes("/operations")
        ? emptyOps
        : ok(page(url.includes(EXECUTOR) ? [txRecord(), txRecord({ hash: other })] : [])),
    );

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("found");
    if (scan.status !== "found") return;
    expect(scan.matches.map((m) => m.hash).sort()).toEqual([other, TX].sort());
  });

  it("ignores a transaction that carries a different memo, or none", async () => {
    stubFetch((url) =>
      url.includes("/operations")
        ? emptyOps
        : ok(
            page([
              txRecord({ memo: Buffer.alloc(32, 7).toString("base64") }),
              txRecord({ memo_type: "none", memo: undefined }),
              txRecord({ memo_type: "text", memo: "settlement" }),
            ]),
          ),
    );

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("not-found");
  });

  it("ignores a FAILED transaction even when its memo matches", async () => {
    // A failed envelope moved no money. Linking it would present a non-payment as a receipt.
    stubFetch((url) =>
      url.includes("/operations") ? emptyOps : ok(page([txRecord({ successful: false })])),
    );

    expect((await findSettlement(MEMO)).status).toBe("not-found");
  });

  it("treats an account with no history as empty, not as an outage", async () => {
    stubFetch(() => new Response("", { status: 404 }));

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("not-found");
    if (scan.status !== "not-found") return;
    expect(scan.exhaustive).toBe(true);
  });

  it("says the search was NOT exhaustive when it stops at the page cap", async () => {
    // A full page plus a `next` link means more history exists. After MAX_PAGES the scan
    // gives up, and an absence found that way is not proof of absence.
    const full = Array.from({ length: 200 }, (_, i) => txRecord({ hash: `f${i}`, memo: "x" }));
    stubFetch((url) =>
      url.includes("/operations") ? emptyOps : ok(page(full, `${url}&cursor=next`)),
    );

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("not-found");
    if (scan.status !== "not-found") return;
    expect(scan.exhaustive).toBe(false);
  });

  it("reports a Horizon failure as unavailable, never as not-found", async () => {
    // The difference matters: "not-found" beside settled=true reads as a discrepancy,
    // and an unreachable Horizon must not manufacture one.
    stubFetch(() => new Response("upstream", { status: 503 }));

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("unavailable");
    if (scan.status !== "unavailable") return;
    expect(scan.message).toMatch(/503/);
  });

  it("keeps a matched hash when the operation lookup fails", async () => {
    // The payment triple is supporting detail. Losing it must not lose the link.
    stubFetch((url) => {
      if (url.includes("/operations")) return new Response("nope", { status: 500 });
      return ok(page(url.includes(EXECUTOR) ? [txRecord()] : []));
    });

    const scan = await findSettlement(MEMO);
    expect(scan.status).toBe("found");
    if (scan.status !== "found") return;
    expect(scan.matches[0]!.hash).toBe(TX);
    expect(scan.matches[0]!.payment).toBeNull();
  });

  it("searches for the base64 of the memo, which is how Horizon reports it", async () => {
    const seen: string[] = [];
    stubFetch((url) => {
      seen.push(url);
      return url.includes("/operations") ? emptyOps : ok(page([]));
    });

    await findSettlement(MEMO);
    // The scan filters client-side, so the memo never appears in a URL — what the URLs
    // must show is both accounts, successful-only, newest first.
    expect(seen.some((u) => u.includes(EXECUTOR))).toBe(true);
    expect(seen.some((u) => u.includes(MERCHANT))).toBe(true);
    expect(seen.every((u) => u.includes("include_failed=false"))).toBe(true);
    expect(MEMO_B64).toBe("BRDqGnDrKhodP55ODmuxXD+y4eDfwKS7Hh+OCg4cLT8=");
  });
});
