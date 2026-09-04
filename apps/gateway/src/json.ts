/**
 * BigInt does not survive `JSON.stringify`, and both of the gateway's output
 * paths go through it: Fastify's serializer and pino's. Either one throws
 * `TypeError: Do not know how to serialize a BigInt` on the first stroop amount
 * that reaches it — and on the logging path that means LOSING the transcript
 * record that §6.1 D2 is scored on, at exactly the moment it matters.
 *
 * The rule is to convert at every boundary, with `formatAmount` where the value
 * is an amount (so the reviewer reads "12.5", not "125000000") and `.toString()`
 * everywhere else. `jsonSafe` is the net under that rule, not a replacement for
 * it: it is applied to log payloads so a bigint that slips through downgrades to
 * a decimal string instead of taking the record with it.
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value instanceof Date || value instanceof Error) return value;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}
