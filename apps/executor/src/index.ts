/**
 * Decision-Gated Settlement Executor (D3).
 *
 * INVARIANT: the only input is `decision_id`. There is no path from a raw agent
 * request to a payment. The executor RE-READS the decision from the contract
 * immediately before submitting — it does not trust the application database
 * (SOW §4.1 D3). The settlement journal is built so that it structurally cannot
 * be trusted for anything that matters: it has no column for an amount, an
 * asset or a verdict.
 *
 * ⚠️ Phase 1 trusts the executor key: the memo commitment makes abuse DETECTABLE,
 *    not impossible. Phase 2 moves settlement into the contract.
 *    See DECISIONS.md #6.
 *
 * The state machine, the ordering argument and the recovery matrix all live in
 * `settle.ts`; this file only wires the default dependencies together.
 */
export { SettlementError, isGateCode, type SettlementErrorCode } from "./errors.js";
export { loadConfig, loadDotEnv, type ExecutorConfig } from "./config.js";
export { loadRegistry, type ServiceRegistry } from "./registry.js";
export { connect as connectChain, type ChainClient, type OnChainDecision } from "./chain.js";
export { horizonClient, type HorizonClient } from "./horizon.js";
export {
  deriveSac,
  preparePayment,
  assertPayableAmount,
  MAX_INT64_STROOPS,
  type PreparedPayment,
} from "./payment.js";
export { buildReceipt, memoPreimage } from "./receipt.js";
export {
  MemorySettlementStore,
  SqliteSettlementStore,
  isTerminal,
  type SettlementRecord,
  type SettlementStatus,
  type SettlementStore,
} from "./store/index.js";
export {
  createExecutor,
  type Executor,
  type ExecutorDeps,
  type SettleOptions,
  type SettleResult,
} from "./settle.js";

import { connect as connectChain } from "./chain.js";
import { loadConfig, loadDotEnv, type ExecutorConfig } from "./config.js";
import { loadRegistry } from "./registry.js";
import { createExecutor, type Executor, type SettleOptions, type SettleResult } from "./settle.js";
import { SqliteSettlementStore } from "./store/index.js";

export interface RuntimeHandle {
  executor: Executor;
  config: ExecutorConfig;
  close(): Promise<void>;
}

/**
 * Build the production executor: config from the environment, facts from the
 * published registry, the contract over Soroban RPC, and the durable SQLite
 * journal. Callers own the returned handle and must `close()` it.
 */
export function createRuntime(cwd: string = process.cwd()): RuntimeHandle {
  loadDotEnv(cwd);
  const config = loadConfig(process.env, cwd);
  const registry = loadRegistry(config.registryPath);
  const store = new SqliteSettlementStore(config.databasePath);
  const chain = connectChain({
    contractId: config.contractId,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    operator: config.operator,
  });
  return {
    executor: createExecutor({ config, registry, chain, store }),
    config,
    close: () => store.close(),
  };
}

/**
 * Settle one decision, end to end, with the default wiring.
 *
 * The signature the rest of the workspace already imports. Everything
 * interesting is in {@link createExecutor}; this is the one-liner for callers
 * that just want a settlement.
 */
export async function settle(decisionId: string, options: SettleOptions = {}): Promise<SettleResult> {
  const runtime = createRuntime();
  try {
    return await runtime.executor.settle(decisionId, options);
  } finally {
    await runtime.close();
  }
}
