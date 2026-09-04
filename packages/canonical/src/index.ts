export { ByteWriter, toHex, fromHex } from "./bytes.js";
export { type Intent, INTENT_DOMAIN, canonicalIntent, intentHash } from "./intent.js";
export { DECISION_DOMAIN, memoHash, decisionId } from "./memo.js";

// Money lives in its own module so a browser can import it without dragging in
// `node:crypto` via ./intent.js and ./memo.js — see ./amount.ts. Re-exported here so
// every existing importer of "@aegis/canonical" is untouched.
export { STROOPS_PER_UNIT, parseAmount, formatAmount } from "./amount.js";
