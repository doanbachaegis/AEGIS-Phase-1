/**
 * Executor configuration, resolved once and validated up front.
 *
 * Two rules shape this file:
 *
 * 1. **Secrets come from the environment, facts come from the registry.** The
 *    only things read from `.env` are the two signing keys and the URLs to
 *    reach public infrastructure. Every value the settlement is *judged* on —
 *    the contract ID, the executor account, the asset, the destination — comes
 *    from `services.json` or from the chain, and `.env` is cross-checked
 *    against it rather than trusted (see `registry.ts`).
 * 2. **Fail before any I/O.** A misconfigured executor must refuse while it is
 *    still harmless, not halfway through a settlement.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { SettlementError } from "./errors.js";

export interface ExecutorConfig {
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  contractId: string;
  /**
   * Signs and sources the classic payment. `services.json` publishes this
   * account as the single settlement source for Phase 1.
   */
  executor: Keypair;
  /**
   * Signs `mark_settled` as `caller`. The contract accepts the owner or the
   * configured operator ONLY (`Error #4 NotAuthorizedCaller`), and the executor
   * account is neither — so this is a genuinely separate key, not a convenience.
   *
   * That separation also removes a sequence-number hazard: `mark_settled` and
   * the payment are submitted by different accounts, so the payment envelope's
   * sequence number cannot be disturbed by the settle call that must precede it.
   */
  operator: Keypair;
  /** Absolute path to the published service registry. */
  registryPath: string;
  /** Absolute path to the SQLite settlement journal. */
  databasePath: string;
  /**
   * Seconds of validity given to the payment envelope's `maxTime`.
   *
   * This number is the whole crash-recovery story: once Horizon's latest ledger
   * has closed after `max_time` and the stored hash still 404s, the transaction
   * can never be included, and "unknown" becomes "proven absent". Too short and
   * a busy network abandons good payments; too long and reconciliation stalls.
   */
  timeoutSeconds: number;
}

const DEFAULTS = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  registryPath: "services.json",
  databasePath: "apps/executor/.data/settlements.db",
  timeoutSeconds: 180,
} as const;

const bad = (message: string, detail?: { expected?: string; actual?: string; cause?: unknown }) =>
  new SettlementError("CONFIG_INVALID", message, detail);

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (v === undefined || v === "") {
    throw bad(`${key} is not set`, { expected: `${key}=<value>`, actual: "empty" });
  }
  return v;
}

function keypair(env: NodeJS.ProcessEnv, key: string): Keypair {
  const secret = requireEnv(env, key);
  try {
    return Keypair.fromSecret(secret);
  } catch (cause) {
    // Never echo the value: this is the one place a secret could reach a log.
    throw bad(`${key} is not a valid Stellar secret key`, { expected: "S…", cause });
  }
}

/**
 * Load `.env` from `cwd` if present. Absent is not an error — a deployment may
 * set the environment directly, and Node's own loader is used so no dotenv
 * dependency enters a process that holds signing keys.
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, ".env");
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ExecutorConfig {
  const contractId = requireEnv(env, "CONTRACT_ID");
  if (!/^C[A-Z2-7]{55}$/.test(contractId)) {
    throw bad("CONTRACT_ID is not a contract address", { expected: "C… (56 base32)", actual: contractId });
  }

  const timeoutRaw = env["SETTLEMENT_TIMEOUT_SECONDS"]?.trim();
  const timeoutSeconds = timeoutRaw ? Number(timeoutRaw) : DEFAULTS.timeoutSeconds;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 3600) {
    throw bad("SETTLEMENT_TIMEOUT_SECONDS must be an integer in [30, 3600]", {
      expected: "30..3600",
      actual: String(timeoutRaw),
    });
  }

  return {
    networkPassphrase: requireEnv(env, "STELLAR_NETWORK_PASSPHRASE"),
    rpcUrl: env["STELLAR_RPC_URL"]?.trim() || DEFAULTS.rpcUrl,
    horizonUrl: env["HORIZON_URL"]?.trim() || DEFAULTS.horizonUrl,
    contractId,
    executor: keypair(env, "EXECUTOR_SECRET"),
    operator: keypair(env, "OPERATOR_SECRET"),
    registryPath: resolve(cwd, env["SERVICE_REGISTRY_PATH"]?.trim() || DEFAULTS.registryPath),
    databasePath: resolve(cwd, env["EXECUTOR_DB_PATH"]?.trim() || DEFAULTS.databasePath),
    timeoutSeconds,
  };
}
