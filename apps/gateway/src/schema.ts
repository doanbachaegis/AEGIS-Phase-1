import { z } from "zod";

/**
 * The gateway's job here is to reject anything the canonical hasher would throw
 * on. `intentHash()` is called without a try/catch (server.ts), so a `RangeError`
 * escaping `canonicalIntent` / `ByteWriter` becomes a Fastify 500 — a caller
 * error reported as a server error. Every constraint in `packages/canonical/SPEC.md`
 * §1 therefore has to be enforced *here*, in the same terms the hasher uses.
 */

/**
 * `ByteWriter.str8` / `str16` measure the string **after NFC normalization, in
 * UTF-8 bytes**. `z.string().max(n)` measures JS UTF-16 code units, which is a
 * different number for anything outside ASCII: "đ" × 255 is 255 characters but
 * 510 bytes, and would sail past `max(255)` straight into
 * `RangeError: str8 too long`. Normalize exactly the way the hasher normalizes,
 * then count bytes.
 */
const utf8ByteLength = (s: string): number => new TextEncoder().encode(s.normalize("NFC")).length;

/** `limit` is a byte budget from SPEC.md §1; `minLength` guards the non-empty fields. */
const bounded = (limit: number, minLength = 0) =>
  z
    .string()
    .min(minLength)
    .refine((s) => utf8ByteLength(s) <= limit, {
      message: `at most ${limit} bytes once NFC-normalized and UTF-8 encoded`,
    });

/**
 * POST /v1/intents — SOW §4.1 D2.
 * `amount` is taken as a STRING and then parsed into bigint stroops. It must
 * never travel as a JSON number: silent float rounding is exactly the "Budget
 * drift" failure mode.
 */
export const IntentRequest = z.object({
  agent_id: bounded(255, 1),
  service_id: bounded(255, 1),
  /** in the form "CODE:ISSUER" — see SPEC.md §5 for the Phase 1 value */
  asset: bounded(255, 1),
  /** decimal string, at most 7 decimal places, e.g. "12.5" */
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/, "at most 7 decimal places")
    // SPEC.md §1 requires amount > 0, and `canonicalIntent` enforces it. The
    // regex alone accepts "0", "0.0", "0.0000000" — all of which parse to 0n.
    // Given the regex, a value is positive iff it contains a non-zero digit.
    .refine((s) => /[1-9]/.test(s), "must be greater than zero"),
  purpose: bounded(65535),
  client_ref: bounded(255),
});

export type IntentRequest = z.infer<typeof IntentRequest>;

/**
 * POST /v1/decisions/:id/resolve — the human approver path (SOW §4.1 D2, §6.3).
 *
 * `approve` is required and has no default. A missing field must not be read as
 * "approve": the whole point of the escalation is that somebody said so.
 */
export const ResolveRequest = z.object({
  approve: z.boolean(),
  /** free-text note for the transcript; not hashed, not sent on-chain */
  note: bounded(1024).optional(),
});

export type ResolveRequest = z.infer<typeof ResolveRequest>;

/** 32-byte lowercase hex — `decision_id` and `intent_hash` are both this shape. */
export const Hash32Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters (32 bytes)");

export const DecisionIdParam = z.object({ id: Hash32Hex });
export const IntentHashParam = z.object({ intent_hash: Hash32Hex });

export const ApprovalsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
