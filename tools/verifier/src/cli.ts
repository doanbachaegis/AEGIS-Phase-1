#!/usr/bin/env node
/**
 * Standalone verifier (D3 evidence).
 *
 * Takes ONE transaction hash + ONE receipt, then confirms that the payment
 * matches what was authorized — using PUBLIC data ONLY. It never calls the
 * AEGIS API.
 *
 *   aegis-verify --tx <hash> --receipt receipt.json
 *
 * Checks:
 *   1. the on-ledger MEMO_HASH === sha256(intent_hash || policy_version || decision_id)
 *   2. the on-chain decision has verdict Approved
 *   3. the tx amount / asset / destination match the on-chain decision
 */
import { memoHash, toHex, fromHex } from "@aegis/canonical";

void memoHash; void toHex; void fromHex;
console.error("not implemented — see README, a contract ID is required first");
process.exit(1);
