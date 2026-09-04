import { createHash } from "node:crypto";
import { ByteWriter } from "./bytes.js";

export const DECISION_DOMAIN = "AEGIS-DECISION-v1";

const need32 = (b: Uint8Array, name: string) => {
  if (b.length !== 32) throw new RangeError(`${name} must be 32 bytes, got ${b.length}`);
};

/**
 * MEMO_HASH attached to the settle transaction.
 *
 *   sha256( intent_hash[32] || policy_version_be_u32[4] || decision_id[32] )
 *
 * Matches the acceptance criteria §6.3 verbatim. No domain separator: all three fields
 * are fixed-width, so the concatenation is already unambiguous — see SPEC.md §2.
 */
export function memoHash(
  intentHash: Uint8Array,
  policyVersion: number,
  decisionId: Uint8Array,
): Uint8Array {
  need32(intentHash, "intent_hash");
  need32(decisionId, "decision_id");
  const pre = new ByteWriter().raw(intentHash).u32(policyVersion).raw(decisionId).finish();
  return new Uint8Array(createHash("sha256").update(pre).digest());
}

/**
 * ⚠️ ABI NOT YET FINALIZED — see DECISIONS.md #4.
 * Deterministic derivation so a reviewer can recompute decision_id from public data.
 */
export function decisionId(intentHash: Uint8Array, policyVersion: number): Uint8Array {
  need32(intentHash, "intent_hash");
  const pre = new ByteWriter()
    .ascii(DECISION_DOMAIN)
    .raw(intentHash)
    .u32(policyVersion)
    .finish();
  return new Uint8Array(createHash("sha256").update(pre).digest());
}
