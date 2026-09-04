/**
 * 🔑 INVARIANT: everything in this file reads DIRECTLY from Soroban RPC.
 *
 * §6.3: "Every decision can be read on-chain by contract ID, independently of
 * the AEGIS database." Adding a single fetch to the AEGIS API here would break
 * the strongest piece of evidence in the whole project.
 *
 * NON-authoritative data (purpose, client_ref) goes through `./aegisApi.ts`
 * and must be labelled separately in the UI.
 */

export interface ChainDecision {
  decisionId: string;
  intentHash: string;
  agent: string;
  serviceId: string;
  asset: string;
  /** stroops, kept as bigint — never parse into a number */
  amount: bigint;
  policyVersion: number;
  verdict: "Approved" | "Rejected" | "RequiresApproval";
  reasonCode: string;
  ledgerSeq: number;
  resolved: boolean;
  settled: boolean;
}

export async function fetchDecisionByIntent(_intentHash: string): Promise<ChainDecision> {
  // TODO(D4): import { Client } from "@aegis/bindings" and call
  //   client.decision_by_intent({ intent_hash })
  //   through rpc.Server(import.meta.env.VITE_STELLAR_RPC_URL) — simulate, do not submit.
  throw new Error("waiting on bindings: CONTRACT_ID=C... pnpm bindings");
}

export const stellarExpert = {
  contract: (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`,
  tx: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
};
