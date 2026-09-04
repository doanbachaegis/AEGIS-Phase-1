/**
 * NON-authoritative display data. Deliberately kept out of `./chain.ts`.
 *
 * `purpose` and `client_ref` are the two fields a reviewer wants to read but that the
 * contract never stores: they enter `intent_hash` as bytes and are then gone. They can
 * only come from the AEGIS database, which is precisely the dependency §6.3 forbids
 * for anything authoritative. So they live here, they are fetched separately, and the
 * UI tags them "display only" — see `SourceTag` in ./ui.tsx.
 *
 * Nothing in this module ever throws or blocks the evidence page. If the API is down,
 * misconfigured or absent, the on-chain evidence is complete without it; that is the
 * whole claim being demonstrated.
 */

import { env } from "./env.js";
import type { Hex32 } from "./chain.js";

export interface IntentDisplay {
  purpose: string | null;
  clientRef: string | null;
  /**
   * Hash of the settle transaction. NOT on the `Decision` — the contract records that a
   * decision was settled, never which Stellar transaction did it. So the link to the
   * transaction is display-only, and the reviewer confirms it by checking that the
   * transaction's MEMO_HASH equals the `memo_hash()` value read from the contract.
   */
  settlementTxHash: string | null;
}

export type AegisApiLookup =
  | { status: "disabled" }
  | { status: "found"; data: IntentDisplay }
  | { status: "absent" }
  | { status: "error"; message: string };

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function fetchIntentDisplay(intentHash: Hex32): Promise<AegisApiLookup> {
  if (env.aegisApiUrl === null) return { status: "disabled" };

  try {
    const res = await fetch(`${env.aegisApiUrl}/v1/intents/${intentHash}`, {
      headers: { accept: "application/json" },
    });

    if (res.status === 404) return { status: "absent" };
    if (!res.ok) return { status: "error", message: `AEGIS API responded ${res.status}` };

    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) {
      return { status: "error", message: "AEGIS API returned a non-object body" };
    }

    const record = body as Record<string, unknown>;
    return {
      status: "found",
      data: {
        purpose: pickString(record["purpose"]),
        clientRef: pickString(record["client_ref"]) ?? pickString(record["clientRef"]),
        settlementTxHash:
          pickString(record["settlement_tx_hash"]) ?? pickString(record["settlementTxHash"]),
      },
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
