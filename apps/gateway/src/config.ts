import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MIN_WRITE_KEY_LENGTH } from "./writeAuth.js";
import { Keypair } from "@aegis/bindings";
import { parseCorsOrigins } from "./cors.js";

/**
 * Gateway configuration, resolved once at boot.
 *
 * Everything the request path needs is settled here so a misconfiguration fails
 * at startup with a named variable rather than mid-request with a stack trace.
 */

/**
 * Load `.env` if one is sitting next to us. Node 24 does this natively, so the
 * gateway carries no dotenv dependency. A missing file is not an error — in a
 * container the variables are already in the environment.
 */
export function loadEnvFile(path = ".env"): void {
  const abs = resolve(path);
  if (!existsSync(abs)) return;
  try {
    process.loadEnvFile(abs);
  } catch {
    // A malformed .env must not take the process down; the checks below will
    // report whatever is actually missing, by name.
  }
}

export interface GatewayConfig {
  port: number;
  logLevel: string;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  /** `caller` for `authorize` — the owner or the configured operator (DECISIONS.md #7). */
  caller: Keypair;
  /** Whether `caller` came from OPERATOR_SECRET or fell back to OWNER_SECRET. */
  callerRole: "operator" | "owner";
  /** `resolve()` is owner-only on chain, so it needs its own key. */
  owner: Keypair | undefined;
  /** agent `G…` address -> secret key. Phase 1 only — DECISIONS.md #10. */
  agentSecrets: ReadonlyMap<string, string>;
  databaseUrl: string | undefined;
  servicesPath: string;
  registryPath: string;
  /** How long to wait for a submitted transaction to close before giving up. */
  txTimeoutSeconds: number;
  /**
   * Origins allowed to call this API from a browser (`CORS_ORIGIN`). Empty means
   * CORS is not enabled at all — see `cors.ts` for why that default is safe.
   */
  corsOrigins: readonly string[];
  /**
   * Bearer key for the two WRITE paths. Undefined disables writes rather than opening
   * them — see ./writeAuth.ts. Reads never consult it.
   */
  writeKey: string | undefined;
}

const req = (env: NodeJS.ProcessEnv, name: string): string => {
  const v = env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
};

const keypair = (name: string, secret: string): Keypair => {
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new Error(`${name} is not a valid Stellar secret key (S…)`);
  }
};

/**
 * `AGENT_SECRETS` is a JSON object mapping the agent's public key to its secret
 * key. It is keyed by ADDRESS rather than by `agent_id` on purpose: the signing
 * loop matches against whatever addresses `needsNonInvokerSigningBy()` reports,
 * which are addresses, never gateway-side identifiers.
 */
function parseAgentSecrets(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!raw || raw.trim() === "") return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AGENT_SECRETS must be a JSON object of {\"G…\": \"S…\"}");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("AGENT_SECRETS must be a JSON object of {\"G…\": \"S…\"}");
  }
  for (const [address, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof secret !== "string") {
      throw new Error(`AGENT_SECRETS["${address}"] must be a secret key string`);
    }
    const kp = keypair(`AGENT_SECRETS["${address}"]`, secret);
    if (kp.publicKey() !== address) {
      // Silently trusting the key would mean signing an auth entry as an agent
      // the operator did not think it was signing for.
      throw new Error(
        `AGENT_SECRETS key mismatch: entry "${address}" holds the secret for ${kp.publicKey()}`,
      );
    }
    out.set(address, secret);
  }
  return out;
}

/**
 * A key too short to resist guessing is refused at BOOT, not at request time: a weak
 * value must not be able to sit unnoticed in a running deployment. Absent is a valid
 * configuration and means "reads only".
 */
function readWriteKey(raw: string | undefined): string | undefined {
  const key = raw?.trim();
  if (!key) return undefined;
  if (key.length < MIN_WRITE_KEY_LENGTH) {
    throw new Error(
      `AEGIS_WRITE_KEY is ${key.length} characters; at least ${MIN_WRITE_KEY_LENGTH} are required. ` +
        "Generate one with: openssl rand -hex 32",
    );
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const operatorSecret = env.OPERATOR_SECRET?.trim();
  const ownerSecret = env.OWNER_SECRET?.trim();

  // DECISIONS.md #7: `caller` is accepted iff it is the owner OR the configured
  // operator, so either key works. Prefer the operator — it is the least
  // privileged of the two and cannot change policy or revoke an agent.
  const callerSecret = operatorSecret || ownerSecret;
  if (!callerSecret) {
    throw new Error("set OPERATOR_SECRET (preferred) or OWNER_SECRET — authorize() needs a caller");
  }

  return {
    port: Number(env.PORT ?? 8080),
    logLevel: env.LOG_LEVEL ?? "info",
    rpcUrl: req(env, "STELLAR_RPC_URL"),
    networkPassphrase: req(env, "STELLAR_NETWORK_PASSPHRASE"),
    contractId: req(env, "CONTRACT_ID"),
    caller: keypair(operatorSecret ? "OPERATOR_SECRET" : "OWNER_SECRET", callerSecret),
    callerRole: operatorSecret ? "operator" : "owner",
    owner: ownerSecret ? keypair("OWNER_SECRET", ownerSecret) : undefined,
    agentSecrets: parseAgentSecrets(env.AGENT_SECRETS),
    databaseUrl: env.DATABASE_URL?.trim() || undefined,
    // Defaults resolve from THIS module, not from the working directory: both
    // `src/config.ts` and `dist/config.js` sit one level under `apps/gateway`,
    // so the gateway starts the same way from anywhere.
    servicesPath: env.SERVICE_REGISTRY_PATH
      ? resolve(env.SERVICE_REGISTRY_PATH)
      : resolve(import.meta.dirname, "../../../services.json"),
    registryPath: env.GATEWAY_REGISTRY_PATH
      ? resolve(env.GATEWAY_REGISTRY_PATH)
      : resolve(import.meta.dirname, "../registry.json"),
    txTimeoutSeconds: Number(env.TX_TIMEOUT_SECONDS ?? 45),
    corsOrigins: parseCorsOrigins(env.CORS_ORIGIN),
    writeKey: readWriteKey(env.AEGIS_WRITE_KEY),
  };
}
