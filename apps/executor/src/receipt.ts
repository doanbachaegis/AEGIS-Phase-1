/**
 * Writing the settlement receipt.
 *
 * A receipt is a CLAIM, never evidence — every field in it is something
 * `tools/verifier` re-derives from Horizon or Soroban RPC and then compares.
 * The schema is `@aegis/receipt`'s and is not redesigned here; this module only
 * fills it in and then runs it through that package's own validator before
 * handing it back, so the executor can never emit a document its verifier would
 * reject for shape.
 *
 * Every value written comes from the CHAIN decision or from the confirmed
 * Horizon transaction. Nothing is copied out of the settlement journal: the
 * journal holds transport state and has no opinion about amounts or assets.
 */
import { ByteWriter, toHex } from "@aegis/canonical";
import { RECEIPT_VERSION, type Receipt, parseReceipt } from "@aegis/receipt";
import type { OnChainDecision } from "./chain.js";

export interface ReceiptInputs {
  decision: OnChainDecision;
  networkPassphrase: string;
  contractId: string;
  horizonUrl: string;
  rpcUrl: string;
  txHash: string;
  memoHash: Uint8Array;
  source: string;
  destination: string;
  assetCode: string;
  assetIssuer: string;
  issuedAt?: string;
}

/**
 * `intent_hash[32] || policy_version_be_u32[4] || decision_id[32]` — 68 bytes.
 *
 * Written into the receipt so a reviewer can hash ONE field and land on the
 * on-ledger memo without re-implementing the byte layout. Built with the same
 * `ByteWriter` `memoHash()` itself uses, so the two cannot drift.
 */
export const memoPreimage = (d: OnChainDecision): Uint8Array =>
  new ByteWriter().raw(d.intentHash).u32(d.policyVersion).raw(d.decisionId).finish();

export function buildReceipt(input: ReceiptInputs): Receipt {
  const d = input.decision;
  const candidate = {
    version: RECEIPT_VERSION,
    network: {
      passphrase: input.networkPassphrase,
      contract_id: input.contractId,
      horizon: input.horizonUrl,
      rpc: input.rpcUrl,
    },
    chain: {
      decision_id: toHex(d.decisionId),
      intent_hash: toHex(d.intentHash),
      policy_version: d.policyVersion,
      agent: d.agent,
      service_id: d.serviceId,
      asset: d.asset,
      // Stroops as a DECIMAL STRING: a JSON number cannot hold an i128, and the
      // validator rejects one outright rather than losing the precision quietly.
      amount: d.amount.toString(),
    },
    settlement: {
      tx_hash: input.txHash,
      memo_hash: toHex(input.memoHash),
      memo_preimage: toHex(memoPreimage(d)),
      source: input.source,
      destination: input.destination,
      // The canonical `CODE:ISSUER` form of SPEC.md §5, field 4 of canonical_intent.
      asset: `${input.assetCode}:${input.assetIssuer}`,
    },
    ...(input.issuedAt === undefined ? {} : { issued_at: input.issuedAt }),
  };

  // Validate with the shared validator rather than trusting the shape above.
  // The executor writes the claim and the verifier refutes it; running the same
  // parser on both sides is what stops them drifting apart.
  return parseReceipt(candidate);
}
