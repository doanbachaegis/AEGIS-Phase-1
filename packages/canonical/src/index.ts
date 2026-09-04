export { ByteWriter, toHex, fromHex } from "./bytes.js";
export { type Intent, INTENT_DOMAIN, canonicalIntent, intentHash } from "./intent.js";
export { DECISION_DOMAIN, memoHash, decisionId } from "./memo.js";

/** 1 asset unit = 10^7 stroops (Stellar uses 7 decimal places). */
export const STROOPS_PER_UNIT = 10_000_000n;

/** "12.5" -> 125000000n. Parsed from the string directly, never through a float. */
export function parseAmount(decimal: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(decimal.trim());
  if (!m) throw new RangeError(`invalid amount: ${decimal} (at most 7 decimal places)`);
  const [, whole = "0", frac = ""] = m;
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(frac.padEnd(7, "0"));
}

/** 125000000n -> "12.5" */
export function formatAmount(stroops: bigint): string {
  const neg = stroops < 0n;
  const a = neg ? -stroops : stroops;
  const frac = (a % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${a / STROOPS_PER_UNIT}${frac ? "." + frac : ""}`;
}
