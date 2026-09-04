import { createHash } from "node:crypto";
import { ByteWriter } from "./bytes.js";

export const INTENT_DOMAIN = "AEGIS-INTENT-v1";

/**
 * Payment intent submitted by an agent to the gateway.
 * `amount` is a bigint denominated in STROOPS (Stellar's 7 decimal places) — never a number.
 */
export interface Intent {
  agentId: string;
  serviceId: string;
  /** Format "CODE:ISSUER", e.g. "USDC:GBBD47IF..." */
  asset: string;
  /** stroops; must be > 0 */
  amount: bigint;
  purpose: string;
  clientRef: string;
}

/** Fixed byte layout — see SPEC.md §1. */
export function canonicalIntent(i: Intent): Uint8Array {
  if (typeof i.amount !== "bigint") {
    throw new TypeError("amount must be a bigint (stroops), not a number");
  }
  if (i.amount <= 0n) throw new RangeError(`amount must be > 0, got ${i.amount}`);

  return new ByteWriter()
    .ascii(INTENT_DOMAIN)
    .str8(i.agentId)
    .str8(i.serviceId)
    .str8(i.asset)
    .i128(i.amount)
    .str16(i.purpose)
    .str8(i.clientRef)
    .finish();
}

export function intentHash(i: Intent): Uint8Array {
  return new Uint8Array(createHash("sha256").update(canonicalIntent(i)).digest());
}
