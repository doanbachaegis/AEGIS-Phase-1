/**
 * The ledger side of settlement, over Horizon's REST API.
 *
 * Horizon rather than Soroban RPC, deliberately — the same reasoning that makes
 * the payment a CLASSIC payment rather than a SAC transfer:
 *
 * - Horizon returns `{type: "payment", from, to, asset_code, asset_issuer,
 *   amount}` as structured data. That is literally the "amount, asset and
 *   destination" the verifier is told to check (SOW §4.1 D3). A SAC `transfer`
 *   is a contract invocation whose arguments a reviewer must decode from XDR.
 * - Horizon keeps FULL history. Soroban RPC retains roughly seven days, so a
 *   settlement checked through it stops being checkable after a week.
 *
 * Plain `fetch` rather than the SDK's Horizon client, for one reason that
 * matters: this module has to distinguish "404, no such transaction" from "the
 * request did not complete". Those are opposite facts — the first can become a
 * proof of non-inclusion, the second can never become anything at all — and a
 * client that turns both into a thrown Error erases the distinction.
 */
import { SettlementError } from "./errors.js";

export interface HorizonBalance {
  balance: string;
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  is_authorized?: boolean;
}

export interface HorizonAccount {
  id: string;
  sequence: string;
  balances: HorizonBalance[];
}

export interface HorizonTransaction {
  hash: string;
  ledger: number;
  successful: boolean;
  created_at: string;
  source_account: string;
  memo_type: string;
  memo?: string;
}

/** The outcome of POSTing an envelope. Every case is named; none of them throw. */
export type SubmitOutcome =
  /** Horizon confirmed inclusion. */
  | { kind: "included"; hash: string; ledger: number; successful: boolean }
  /**
   * Horizon did not answer in time, or answered 504. The transaction may or may
   * not be on the ledger — the ONLY correct next step is to poll the stored
   * hash. Rebuilding here is what pays twice.
   */
  | { kind: "unknown"; detail: string }
  /**
   * Horizon rejected the envelope outright with result codes. It was not
   * included and, at this sequence number, never will be under these codes.
   */
  | { kind: "rejected"; detail: string; resultCodes?: unknown };

export interface HorizonClient {
  account(accountId: string): Promise<HorizonAccount | "not-found">;
  transaction(hash: string): Promise<HorizonTransaction | "not-found">;
  submit(envelopeXdr: string): Promise<SubmitOutcome>;
  /** Close time of the latest ledger Horizon has ingested, in unix seconds. */
  latestLedgerCloseTime(): Promise<number>;
}

const unavailable = (message: string, cause?: unknown) =>
  new SettlementError("SOURCE_UNAVAILABLE", message, cause === undefined ? undefined : { cause });

export function horizonClient(baseUrl: string, fetchImpl: typeof fetch = fetch): HorizonClient {
  const root = baseUrl.replace(/\/+$/, "");

  const getJson = async (path: string): Promise<unknown | "not-found"> => {
    let res: Response;
    try {
      res = await fetchImpl(`${root}${path}`, { headers: { accept: "application/json" } });
    } catch (cause) {
      throw unavailable(`Horizon request to ${path} did not complete`, cause);
    }
    if (res.status === 404) return "not-found";
    if (!res.ok) throw unavailable(`Horizon answered ${res.status} for ${path}`);
    try {
      return await res.json();
    } catch (cause) {
      throw unavailable(`Horizon returned a malformed body for ${path}`, cause);
    }
  };

  return {
    async account(accountId) {
      const body = await getJson(`/accounts/${accountId}`);
      if (body === "not-found") return "not-found";
      const a = body as HorizonAccount;
      if (typeof a?.sequence !== "string" || !Array.isArray(a?.balances)) {
        throw unavailable(`Horizon returned an unrecognizable account for ${accountId}`);
      }
      return a;
    },

    async transaction(hash) {
      const body = await getJson(`/transactions/${hash}`);
      if (body === "not-found") return "not-found";
      const t = body as HorizonTransaction;
      if (typeof t?.hash !== "string") {
        throw unavailable(`Horizon returned an unrecognizable transaction for ${hash}`);
      }
      return { ...t, ledger: Number(t.ledger), successful: t.successful === true };
    },

    async submit(envelopeXdr) {
      let res: Response;
      try {
        res = await fetchImpl(`${root}/transactions`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ tx: envelopeXdr }).toString(),
        });
      } catch (cause) {
        // A dropped connection says nothing about whether Horizon received and
        // forwarded the envelope. "unknown", never "failed".
        return { kind: "unknown", detail: `the POST did not complete: ${(cause as Error).message}` };
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch {
        body = undefined;
      }

      if (res.ok) {
        const t = body as Partial<HorizonTransaction> | undefined;
        if (typeof t?.hash !== "string") {
          return { kind: "unknown", detail: "Horizon accepted the transaction but returned no hash" };
        }
        return {
          kind: "included",
          hash: t.hash,
          ledger: Number(t.ledger ?? 0),
          successful: t.successful === true,
        };
      }

      const problem = body as { type?: string; extras?: { result_codes?: unknown } } | undefined;
      // 504 / timeout is Horizon saying "I stopped waiting", not "it did not
      // happen". Stellar Core may still include it before max_time.
      if (res.status === 504 || String(problem?.type ?? "").includes("timeout")) {
        return { kind: "unknown", detail: `Horizon timed out (${res.status}); the transaction may still be included` };
      }
      const codes = problem?.extras?.result_codes;
      return {
        kind: "rejected",
        detail: `Horizon rejected the envelope with ${res.status}`,
        ...(codes === undefined ? {} : { resultCodes: codes }),
      };
    },

    async latestLedgerCloseTime() {
      const body = await getJson("/");
      if (body === "not-found") throw unavailable("Horizon has no root document");
      const closedAt = (body as { history_latest_ledger_closed_at?: string }).history_latest_ledger_closed_at;
      if (typeof closedAt !== "string") {
        throw unavailable("Horizon's root document carries no history_latest_ledger_closed_at");
      }
      const seconds = Math.floor(Date.parse(closedAt) / 1000);
      if (!Number.isFinite(seconds)) {
        throw unavailable(`Horizon reported an unparsable ledger close time: ${closedAt}`);
      }
      return seconds;
    },
  };
}

/** The USDC (or any credit asset) trustline on an account, if it holds one. */
export const trustline = (
  account: HorizonAccount,
  code: string,
  issuer: string,
): HorizonBalance | undefined =>
  account.balances.find((b) => b.asset_code === code && b.asset_issuer === issuer);
