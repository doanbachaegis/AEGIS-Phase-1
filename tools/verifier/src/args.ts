/** Argument parsing. Pure and total: it never reads a file, a network or an env var. */

export interface CliOptions {
  /** The settlement transaction hash to verify, 64 hex characters. */
  tx: string;
  /** Path to the receipt JSON. */
  receipt: string;
  /** Overrides. Every one of these defaults to the receipt's own `network` block. */
  horizon?: string;
  rpc?: string;
  contract?: string;
  network?: string;
  /** Path to the service registry. Defaults to `services.json` beside the receipt, then in cwd. */
  registry?: string;
  json: boolean;
  strict: boolean;
}

export type ParsedArgs =
  | { kind: "run"; options: CliOptions }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "usage"; message: string };

export const USAGE = `aegis-verify — independently verify an AEGIS settlement

USAGE
  aegis-verify --tx <hash> --receipt <path> [options]

REQUIRED
  --tx <hash>          settlement transaction hash (64 hex characters)
  --receipt <path>     path to the receipt JSON

OPTIONS
  --horizon <url>      Horizon base URL          (default: receipt.network.horizon)
  --rpc <url>          Soroban RPC base URL      (default: receipt.network.rpc)
  --contract <C...>    authorization contract ID (default: receipt.network.contract_id)
  --network <phrase>   network passphrase        (default: receipt.network.passphrase)
  --registry <path>    service registry JSON     (default: services.json next to the
                       receipt, then ./services.json)
  --strict             also check the decision_id derivation and that mark_settled
                       landed at or before the payment
  --json               emit machine-readable JSON instead of the report
  -h, --help           show this text
  -V, --version        show the version

EXIT CODES
  0  VERIFIED     every check passed
  1  FAILED       at least one check found a real mismatch
  2  USAGE        bad arguments
  3  UNAVAILABLE  nothing contradicted the receipt, but at least one check could
                  not be run. This is NOT a pass.

The verifier reads Horizon and Soroban RPC only. It never contacts the AEGIS API,
and it fetches the contract ABI from the chain rather than importing generated
bindings, so it runs against nothing but a contract ID and public infrastructure.
`;

const VALUE_FLAGS = ["tx", "receipt", "horizon", "rpc", "contract", "network", "registry"] as const;
type ValueFlag = (typeof VALUE_FLAGS)[number];

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const values: Partial<Record<ValueFlag, string>> = {};
  let json = false;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;

    if (arg === "-h" || arg === "--help") return { kind: "help" };
    if (arg === "-V" || arg === "--version") return { kind: "version" };
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }

    // Accept both `--flag value` and `--flag=value`; they are equally common in
    // the shell snippets a reviewer will copy out of the README.
    const eq = arg.indexOf("=");
    const name = (arg.startsWith("--") ? (eq === -1 ? arg.slice(2) : arg.slice(2, eq)) : "") as ValueFlag;

    if (!VALUE_FLAGS.includes(name)) {
      return { kind: "usage", message: `unknown argument: ${arg}` };
    }
    let value: string | undefined;
    if (eq === -1) {
      value = argv[i + 1];
      i++;
    } else {
      value = arg.slice(eq + 1);
    }
    if (value === undefined || value.startsWith("--")) {
      return { kind: "usage", message: `--${name} needs a value` };
    }
    if (values[name] !== undefined) {
      return { kind: "usage", message: `--${name} was given more than once` };
    }
    values[name] = value;
  }

  const tx = values.tx;
  const receipt = values.receipt;
  if (tx === undefined) return { kind: "usage", message: "--tx is required" };
  if (receipt === undefined) return { kind: "usage", message: "--receipt is required" };
  if (!/^[0-9a-fA-F]{64}$/.test(tx)) {
    return { kind: "usage", message: `--tx must be 64 hex characters, got ${JSON.stringify(tx)}` };
  }

  const options: CliOptions = { tx: tx.toLowerCase(), receipt, json, strict };
  if (values.horizon !== undefined) options.horizon = values.horizon;
  if (values.rpc !== undefined) options.rpc = values.rpc;
  if (values.contract !== undefined) options.contract = values.contract;
  if (values.network !== undefined) options.network = values.network;
  if (values.registry !== undefined) options.registry = values.registry;
  return { kind: "run", options };
}
