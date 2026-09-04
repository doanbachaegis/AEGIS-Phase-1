/**
 * Configuration, validated once at module load.
 *
 * A reviewer opening a shared link is the whole point of D4 (SOW §6.1: the evidence
 * is "a public link to the console" plus a list of intent references). A deploy that
 * silently lost its contract ID would render a page that looks like a decision that
 * does not exist — the worst possible failure mode for an evidence artifact. So this
 * module throws on load, and `main.tsx` turns that into a loud configuration screen
 * that still carries the mandatory testnet label.
 */

export class MissingEnvError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Console configuration is incomplete:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "MissingEnvError";
    this.problems = problems;
  }
}

/**
 * Fails loudly. `value` is passed in rather than looked up by name because Vite only
 * substitutes static `import.meta.env.VITE_*` accesses at build time.
 */
export function requireEnv(name: string, value: string | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MissingEnvError([`${name} is not set`]);
  }
  return value.trim();
}

/** Stellar strkey for a contract: 'C' + 55 base32 characters. */
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;

export interface ConsoleEnv {
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  readonly contractId: string;
  readonly stellarExpertNetwork: string;
  /** Null when unset — the console then prints the raw SAC address with no friendly name. */
  readonly usdcSacAddress: string | null;
  /**
   * Base URL of the AEGIS API, with no trailing slash.
   *
   * The EMPTY STRING is the normal value and means same-origin: the gateway
   * serves this bundle, so `/v1/...` reaches the API that served the page —
   * correct by construction, and correct without a rebuild when the deployment
   * moves to a new domain. `VITE_AEGIS_API_URL` overrides it, which is only
   * needed when the console is NOT being served by the gateway (`vite dev`
   * against a remote gateway, or a copy of the bundle hosted elsewhere).
   */
  readonly aegisApiUrl: string;
  readonly sampleIntents: readonly string[];
}

function optional(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function readEnv(): ConsoleEnv {
  const problems: string[] = [];

  const req = (name: string, value: string | undefined): string => {
    try {
      return requireEnv(name, value);
    } catch {
      problems.push(`${name} is not set`);
      return "";
    }
  };

  const rpcUrl = req("VITE_STELLAR_RPC_URL", import.meta.env.VITE_STELLAR_RPC_URL);
  const networkPassphrase = req(
    "VITE_STELLAR_NETWORK_PASSPHRASE",
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE,
  );
  const contractId = req("VITE_CONTRACT_ID", import.meta.env.VITE_CONTRACT_ID);

  if (rpcUrl) {
    try {
      new URL(rpcUrl);
    } catch {
      problems.push(`VITE_STELLAR_RPC_URL is not a URL: ${rpcUrl}`);
    }
  }
  if (contractId && !CONTRACT_ID.test(contractId)) {
    problems.push(`VITE_CONTRACT_ID is not a contract address (C...): ${contractId}`);
  }

  if (problems.length > 0) throw new MissingEnvError(problems);

  return {
    rpcUrl,
    networkPassphrase,
    contractId,
    stellarExpertNetwork: optional(import.meta.env.VITE_STELLAR_EXPERT_NETWORK) ?? "testnet",
    usdcSacAddress: optional(import.meta.env.VITE_USDC_SAC_ADDRESS),
    // Trailing slashes stripped so the call sites can concatenate a rooted path.
    // Unset collapses to "", which is same-origin — see the field's comment.
    aegisApiUrl: optional(import.meta.env.VITE_AEGIS_API_URL)?.replace(/\/+$/, "") ?? "",
    sampleIntents: (optional(import.meta.env.VITE_SAMPLE_INTENTS) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  };
}

/** Throws at import time on a misconfigured deploy. See the module comment. */
export const env: ConsoleEnv = readEnv();
