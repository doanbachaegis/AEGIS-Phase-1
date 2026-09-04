/**
 * Decision-Gated Settlement Executor (D3).
 *
 * INVARIANT: the only input is `decision_id`. There is no path from a raw agent
 * request to a payment. The executor RE-READS the decision from the contract
 * immediately before submitting — it does not trust the application database
 * (SOW §4.1 D3).
 *
 * ⚠️ Phase 1 trusts the executor key: the memo commitment makes abuse DETECTABLE,
 *    not impossible. Phase 2 moves settlement into the contract.
 *    See DECISIONS.md #6.
 */
import { memoHash, toHex } from "@aegis/canonical";

export interface SettleResult {
  decisionId: string;
  txHash: string;
  memoHash: string;
}

export async function settle(decisionId: string): Promise<SettleResult> {
  // 1. RE-READ the decision from the contract (never from the DB)
  // TODO(D3): const d = await contract.get_decision({ decision_id })
  //           abort if d.verdict !== Approved || d.settled

  // 2. Compute MEMO_HASH — the same implementation as the verifier and gateway
  // TODO(D3): const memo = memoHash(d.intent_hash, d.policy_version, d.decision_id)

  // 3. Build the USDC payment, set maxTime on the time bounds
  // 4. ⚠️ PRECOMPUTE the tx hash BEFORE SUBMITTING and persist it to the DB.
  //    Without this step the reconciliation in step 6 is meaningless.
  // 5. mark_settled(decision_id) — the contract guards against double-settle
  // 6. Submit. On a timeout or lost response -> LOOK UP the stored tx hash on
  //    the network; NEVER resubmit with a new sequence number.

  void memoHash;
  void toHex;
  throw new Error(`not implemented: settle(${decisionId}) — see README`);
}
