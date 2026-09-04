/**
 * Horizon access — the LEDGER side of the evidence.
 *
 * Plain `fetch` against the REST API rather than the SDK's `Horizon.Server`, for
 * two reasons. The requests stay visible as URLs a reviewer can paste into a
 * browser and compare against what this tool reports; and the payment operation
 * arrives as Horizon's own structured JSON (`{type, from, to, asset_code,
 * asset_issuer, amount}`), which is literally the "amount, asset and
 * destination" triple SOW §4.1 D3 asks the verifier to check.
 *
 * Horizon, not Soroban RPC, is the settlement source of record: RPC retains only
 * about 7 days of ledgers (measured `ledgerRetentionWindow` 120960), while
 * Horizon keeps the full history, so a receipt stays checkable a year later.
 */

/** A source that could not be reached or answered nonsense. Never a verification failure. */
export class SourceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SourceUnavailableError";
  }
}

export interface HorizonTransaction {
  hash: string;
  successful: boolean;
  ledger: number;
  created_at: string;
  source_account: string;
  operation_count: number;
  memo_type: string;
  /** Base64 for `memo_type: "hash"`. Absent when `memo_type` is `"none"`. */
  memo?: string;
}

export interface HorizonOperation {
  type: string;
  /** Present on `payment`. */
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

const base = (url: string): string => url.replace(/\/+$/, "");

async function getJson(url: string): Promise<unknown | "not-found"> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new SourceUnavailableError(`Horizon request failed: ${url}`, { cause: e });
  }
  // 404 is an ANSWER — "this does not exist on the ledger" — not an outage.
  if (res.status === 404) return "not-found";
  if (!res.ok) {
    throw new SourceUnavailableError(`Horizon returned HTTP ${res.status} for ${url}`);
  }
  try {
    return await res.json();
  } catch (e) {
    throw new SourceUnavailableError(`Horizon returned a non-JSON body for ${url}`, { cause: e });
  }
}

const asRecord = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null) {
    throw new SourceUnavailableError(`Horizon returned an unexpected shape for ${what}`);
  }
  return v as Record<string, unknown>;
};

export async function fetchTransaction(
  horizon: string,
  hash: string,
): Promise<HorizonTransaction | "not-found"> {
  const body = await getJson(`${base(horizon)}/transactions/${hash}`);
  if (body === "not-found") return "not-found";
  const r = asRecord(body, "a transaction");
  const tx: HorizonTransaction = {
    hash: String(r["hash"] ?? ""),
    successful: r["successful"] === true,
    ledger: Number(r["ledger"] ?? r["ledger_attr"] ?? 0),
    created_at: String(r["created_at"] ?? ""),
    source_account: String(r["source_account"] ?? ""),
    operation_count: Number(r["operation_count"] ?? 0),
    memo_type: String(r["memo_type"] ?? ""),
  };
  if (typeof r["memo"] === "string") tx.memo = r["memo"];
  return tx;
}

export async function fetchOperations(horizon: string, hash: string): Promise<HorizonOperation[]> {
  const body = await getJson(`${base(horizon)}/transactions/${hash}/operations?limit=200`);
  if (body === "not-found") return [];
  const records = asRecord(asRecord(body, "operations")["_embedded"], "operations")["records"];
  if (!Array.isArray(records)) {
    throw new SourceUnavailableError("Horizon returned no operation records");
  }
  return records.map((raw) => {
    const r = asRecord(raw, "an operation");
    const op: HorizonOperation = { type: String(r["type"] ?? "") };
    for (const k of ["from", "to", "amount", "asset_type", "asset_code", "asset_issuer"] as const) {
      if (typeof r[k] === "string") op[k] = r[k];
    }
    return op;
  });
}

export interface MemoScan {
  /** Hashes of SUCCESSFUL transactions carrying the memo, in the accounts scanned. */
  hashes: string[];
  /** Which accounts were walked, so the report can state the scope honestly. */
  accounts: string[];
  /** False when a page cap was hit before the history ran out — then the scan proves nothing. */
  exhaustive: boolean;
}

const PAGE = 200;
const MAX_PAGES = 25;

/**
 * Replay scan: walk the full transaction history of the given accounts and
 * collect every successful transaction carrying `memoBase64`.
 *
 * Horizon has no global memo index, so "on the network" is approximated by "in
 * the history of the accounts that this settlement touched" — the submitter and
 * the payee. That is exactly where a double-settle would have to show up, and
 * `accounts` is reported alongside the count so the scope is never overstated.
 */
export async function scanForMemo(
  horizon: string,
  accounts: readonly string[],
  memoBase64: string,
): Promise<MemoScan> {
  const seen = new Set<string>();
  const scanned: string[] = [];
  let exhaustive = true;

  for (const account of new Set(accounts.filter((a) => a.length > 0))) {
    scanned.push(account);
    let url =
      `${base(horizon)}/accounts/${account}/transactions` +
      `?limit=${PAGE}&order=asc&include_failed=false`;

    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) {
        exhaustive = false;
        break;
      }
      const body = await getJson(url);
      if (body === "not-found") {
        // An account with no history on this network. Nothing to scan, and
        // nothing wrong: it simply carries no transactions.
        break;
      }
      const embedded = asRecord(asRecord(body, "a transaction page")["_embedded"], "a transaction page");
      const records = embedded["records"];
      if (!Array.isArray(records)) {
        throw new SourceUnavailableError("Horizon returned no transaction records");
      }
      for (const raw of records) {
        const r = asRecord(raw, "a transaction");
        if (r["successful"] === true && r["memo_type"] === "hash" && r["memo"] === memoBase64) {
          seen.add(String(r["hash"]));
        }
      }
      if (records.length < PAGE) break;
      const next = asRecord(asRecord(body, "links")["_links"], "links")["next"];
      const href = typeof next === "object" && next !== null ? (next as Record<string, unknown>)["href"] : undefined;
      if (typeof href !== "string") break;
      url = href;
    }
  }

  return { hashes: [...seen].sort(), accounts: scanned, exhaustive };
}
