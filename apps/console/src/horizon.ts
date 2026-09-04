/**
 * 🔑 INVARIANT: this file reads PUBLIC LEDGER DATA from Horizon. It never touches
 * the AEGIS API.
 *
 * It sits beside `./chain.ts` rather than inside it because that file's invariant is
 * narrower and worth keeping literally true: everything there is a Soroban RPC read of
 * the authorization contract. The rule both files serve is §6.3 — the evidence must be
 * reproducible "independently of the AEGIS database" — and Horizon is Stellar
 * infrastructure, not an AEGIS service. A reviewer can issue every request below from a
 * browser tab with no relationship to this project.
 *
 * WHY A SCAN, AND NOT A STORED HASH
 *
 * The contract records THAT a decision settled; it never records WHICH transaction did
 * it. The AEGIS database could hand the console a `settlement_tx_hash`, but the reviewer
 * would then be trusting the party under review to name its own receipt. The binding
 * that is NOT a matter of trust is the memo: `memo_hash()` is computed by the CONTRACT
 * over (intent_hash ‖ policy_version ‖ decision_id), and the settle transaction has to
 * carry exactly those 32 bytes as its MEMO_HASH. So the console searches for the memo
 * instead of being told the answer, which makes the link DERIVED from public data rather
 * than ASSERTED. It is the same replay scan `tools/verifier` performs for check X3.
 *
 * WHAT A MISS DOES NOT MEAN
 *
 * `Decision.settled` is the authoritative settlement flag and it comes from the contract.
 * A scan that finds nothing NEVER downgrades that flag — it only means no matching
 * transaction was found in the window scanned, and the caller reports the scope it
 * actually covered. Two matches is not an error here either: it is a double-settle, and
 * the UI must show both rather than pick one.
 */

import { Buffer } from "buffer";
import { env } from "./env.js";
import type { Hex32 } from "./chain.js";

/** Horizon paginates at 200; settlements are recent, so `order=desc` finds them on page 1. */
const PAGE = 200;
/** 5 × 200 = the last 1000 transactions per account. A bounded page walk, not an unbounded one. */
const MAX_PAGES = 5;

export interface SettlementPayment {
  from: string;
  to: string;
  /** Horizon's decimal string, e.g. "12.5000000". */
  amount: string;
  assetCode: string;
  assetIssuer: string;
}

export interface SettlementMatch {
  hash: string;
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  /** Null when the operation list could not be read — the hash is still a real match. */
  payment: SettlementPayment | null;
}

/**
 * `not-found` carries `exhaustive`: false means a page cap was hit before the account's
 * history ran out, so the absence proves nothing and the UI has to say so.
 */
export type SettlementScan =
  | { status: "found"; matches: readonly SettlementMatch[]; scanned: readonly string[] }
  | { status: "not-found"; scanned: readonly string[]; exhaustive: boolean }
  | { status: "unconfigured" }
  | { status: "unavailable"; message: string };

class HorizonUnavailable extends Error {}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

async function getJson(url: string): Promise<unknown | "not-found"> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new HorizonUnavailable(
      `${env.horizonUrl} could not be reached: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  // 404 is an ANSWER — "no such account on this network" — not an outage.
  if (res.status === 404) return "not-found";
  if (!res.ok) throw new HorizonUnavailable(`${env.horizonUrl} responded HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new HorizonUnavailable(`${env.horizonUrl} returned a body that is not JSON`);
  }
}

/** The `payment` operation of a settle transaction, or null if it cannot be read. */
async function paymentOf(hash: string): Promise<SettlementPayment | null> {
  let body: unknown | "not-found";
  try {
    body = await getJson(`${env.horizonUrl}/transactions/${hash}/operations?limit=200`);
  } catch {
    // Supporting detail. A failure here must not discard a hash that already matched.
    return null;
  }
  if (body === "not-found") return null;
  const records = asRecord(asRecord(body)?.["_embedded"])?.["records"];
  if (!Array.isArray(records)) return null;

  for (const raw of records) {
    const r = asRecord(raw);
    if (r === null || r["type"] !== "payment") continue;
    return {
      from: str(r["from"]),
      to: str(r["to"]),
      amount: str(r["amount"]),
      assetCode: str(r["asset_code"]),
      assetIssuer: str(r["asset_issuer"]),
    };
  }
  return null;
}

/**
 * Walk the recent transaction history of `accounts` and collect every SUCCESSFUL
 * transaction whose MEMO_HASH is `memoHash`.
 *
 * Horizon has no global memo index, so "on the network" is approximated by "in the
 * history of the accounts a settlement must touch" — the published executor, and the
 * payee. `scanned` is returned so the page can state that scope rather than imply the
 * whole ledger was searched.
 */
export async function findSettlement(memoHash: Hex32): Promise<SettlementScan> {
  const accounts = env.settlementAccounts;
  if (accounts.length === 0) return { status: "unconfigured" };

  const memoBase64 = Buffer.from(memoHash, "hex").toString("base64");
  const found = new Map<string, { ledger: number; createdAt: string; sourceAccount: string }>();
  const scanned: string[] = [];
  let exhaustive = true;

  try {
    for (const account of accounts) {
      scanned.push(account);
      let url =
        `${env.horizonUrl}/accounts/${account}/transactions` +
        `?limit=${PAGE}&order=desc&include_failed=false`;

      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) {
          exhaustive = false;
          break;
        }
        const body = await getJson(url);
        // An account with no history on this network. Nothing to scan, nothing wrong.
        if (body === "not-found") break;

        const records = asRecord(asRecord(body)?.["_embedded"])?.["records"];
        if (!Array.isArray(records)) {
          throw new HorizonUnavailable(`${env.horizonUrl} returned no transaction records`);
        }
        for (const raw of records) {
          const r = asRecord(raw);
          if (r === null) continue;
          if (r["successful"] === true && r["memo_type"] === "hash" && r["memo"] === memoBase64) {
            found.set(str(r["hash"]), {
              ledger: Number(r["ledger"] ?? 0),
              createdAt: str(r["created_at"]),
              sourceAccount: str(r["source_account"]),
            });
          }
        }
        if (records.length < PAGE) break;

        const href = asRecord(asRecord(asRecord(body)?.["_links"])?.["next"])?.["href"];
        if (typeof href !== "string") break;
        url = href;
      }
    }
  } catch (e) {
    if (e instanceof HorizonUnavailable) return { status: "unavailable", message: e.message };
    throw e;
  }

  if (found.size === 0) return { status: "not-found", scanned, exhaustive };

  const matches = await Promise.all(
    [...found.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(async ([hash, meta]) => ({ hash, ...meta, payment: await paymentOf(hash) })),
  );
  return { status: "found", matches, scanned };
}
