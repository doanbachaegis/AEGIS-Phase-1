/**
 * Money. Nothing here imports `node:crypto`, so this module is safe to load in a
 * browser — `./intent.js` and `./memo.js` are not, and the root entry point pulls
 * them in. The reviewer console imports `@aegis/canonical/amount` for exactly that
 * reason.
 *
 * README invariant #3: amounts are `bigint` stroops end to end. There is one
 * formatter and one parser in the whole repo, and they live here. A `Number()` on
 * the way past either of them silently corrupts `per_intent_cap` — the "budget
 * drift" failure mode this project sells a solution for.
 */

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
