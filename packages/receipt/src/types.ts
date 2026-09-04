/**
 * The AEGIS settlement receipt (D3).
 *
 * A receipt is a CLAIM, never evidence. Every field in it is something the
 * verifier re-derives from Horizon or Soroban RPC and then compares; nothing is
 * believed because the receipt said it. The schema exists so that the executor
 * that writes the claim and the verifier that refutes it cannot drift apart —
 * the same discipline `@aegis/canonical` applies to the hash preimages.
 *
 * Consequence for the field layout: the receipt is split by WHERE the verifier
 * goes to check each block, not by what the executor happened to have in hand.
 *
 *   network      how to reach the two public sources, plus the contract ID
 *   chain        what the executor claims the on-chain Decision says  -> Soroban RPC
 *   settlement   what the executor claims the ledger says             -> Horizon
 *
 * All hashes are lowercase hex, unprefixed. All amounts are decimal strings of
 * STROOPS — never numbers, because a JSON number cannot hold i128 and a float
 * cannot hold a Stellar amount exactly.
 */

/** The only schema version Phase 1 accepts. */
export const RECEIPT_VERSION = "aegis-receipt/1";

/** Lowercase hex, no prefix. 64 characters = 32 bytes. */
export type Hex = string;

export interface ReceiptNetwork {
  /** e.g. "Test SDF Network ; September 2015". Every default the CLI uses comes from here. */
  passphrase: string;
  /** The AEGIS authorization contract, `C…`. The verifier needs nothing else to read the decision. */
  contract_id: string;
  /** Horizon base URL — the ledger side. Full history, so the settlement stays checkable for ever. */
  horizon: string;
  /** Soroban RPC base URL — the contract side. Retains only ~7 days of ledgers. */
  rpc: string;
}

/** Claims about the on-chain `Decision`. Checked against `get_decision(decision_id)`. */
export interface ReceiptChain {
  decision_id: Hex;
  intent_hash: Hex;
  /** u32. Frozen at authorize() time and bound into both decision_id and memo_hash. */
  policy_version: number;
  /** The agent the decision was issued to, `G…` or `C…`. */
  agent: string;
  service_id: string;
  /** The asset's SAC address as held on-chain, `C…`. Compared against a value DERIVED from the payment. */
  asset: string;
  /** Stroops, decimal digits, > 0. */
  amount: string;
}

/** Claims about the settlement transaction. Checked against Horizon. */
export interface ReceiptSettlement {
  /** 64 hex characters. Must equal the `--tx` argument. */
  tx_hash: Hex;
  /** The 32-byte MEMO_HASH the transaction carries. */
  memo_hash: Hex;
  /**
   * The full 68-byte preimage, 136 hex characters:
   * `intent_hash[32] || policy_version_be_u32[4] || decision_id[32]`.
   *
   * Redundant with `chain` on purpose — it lets a reviewer hash one field of the
   * receipt and land on the on-ledger memo without re-implementing the layout.
   */
  memo_preimage: Hex;
  /** The account that submitted the payment — must be the published executor. */
  source: string;
  /** The account that was paid — must be the registry entry for `chain.service_id`. */
  destination: string;
  /** Canonical `CODE:ISSUER` form, matching `canonical_intent` field 4 (SPEC.md §5). */
  asset: string;
}

export interface Receipt {
  version: typeof RECEIPT_VERSION;
  network: ReceiptNetwork;
  chain: ReceiptChain;
  settlement: ReceiptSettlement;
  /** Non-authoritative, informational only. RFC 3339. Nothing is checked against it. */
  issued_at?: string;
}
