/**
 * The service registry — the only PUBLISHED, non-chain input the verifier takes.
 *
 * `service_id` is a string on the chain; the account that string is allowed to be
 * paid is not. Without a published mapping, "the money went where the decision
 * said" cannot be checked at all: any destination would satisfy a decision. So
 * the registry is a genuine part of the evidence, and it must come from the
 * repository — never from the receipt, which is exactly what is under scrutiny.
 *
 * Expected shape (`services.json` at the repository root):
 *
 * ```json
 * {
 *   "network": "testnet",
 *   "executor": "GBZZ…",
 *   "services": {
 *     "openai-api": { "name": "OpenAI proxy", "destination": "GB4U…" }
 *   }
 * }
 * ```
 *
 * The file is authored by a different part of the project, so the parser accepts
 * the handful of equivalent spellings that shape naturally comes in (a bare
 * string instead of an object, an array instead of a map, `account`/`address`
 * for `destination`) and rejects everything else loudly. Being forgiving about
 * spelling is safe; being forgiving about a MISSING entry is not, and a missing
 * entry is reported as `unavailable`, never as a pass.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryError";
  }
}

export interface ServiceRegistry {
  /** Where it was read from — printed in the report so the input is never implicit. */
  path: string;
  /** The published executor account, if the registry names one. */
  executor?: string;
  /** The contract the registry says these services belong to, if it names one. */
  contractId?: string;
  /** service_id -> destination account. */
  services: ReadonlyMap<string, string>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const STRKEY = /^[A-Z2-7]{56}$/;

const account = (v: unknown, where: string): string => {
  if (typeof v !== "string" || !STRKEY.test(v) || !v.startsWith("G")) {
    throw new RegistryError(`${where}: expected a "G…" account address, got ${JSON.stringify(v)}`);
  }
  return v;
};

const destinationOf = (v: unknown, where: string): string => {
  if (typeof v === "string") return account(v, where);
  if (isRecord(v)) {
    for (const key of ["destination", "account", "address"]) {
      if (v[key] !== undefined) return account(v[key], `${where}.${key}`);
    }
    throw new RegistryError(`${where}: no "destination" field`);
  }
  throw new RegistryError(`${where}: expected a destination account or an object holding one`);
};

export function parseRegistry(input: unknown, path: string): ServiceRegistry {
  if (!isRecord(input)) throw new RegistryError(`${path}: expected a JSON object`);

  const services = new Map<string, string>();
  const raw = input["services"];

  if (isRecord(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      services.set(id, destinationOf(value, `services.${id}`));
    }
  } else if (Array.isArray(raw)) {
    raw.forEach((value, i) => {
      if (!isRecord(value)) throw new RegistryError(`services[${i}]: expected an object`);
      const id = value["id"] ?? value["service_id"];
      if (typeof id !== "string" || id.length === 0) {
        throw new RegistryError(`services[${i}]: missing a string "id"`);
      }
      services.set(id, destinationOf(value, `services[${i}]`));
    });
  } else {
    throw new RegistryError(`${path}: expected a "services" map or array`);
  }

  const registry: ServiceRegistry = { path, services };

  const exec = input["executor"] ?? input["executor_account"];
  if (typeof exec === "string") {
    registry.executor = account(exec, "executor");
  } else if (isRecord(exec)) {
    for (const key of ["account_id", "account", "public_key", "address"]) {
      if (exec[key] !== undefined) {
        registry.executor = account(exec[key], `executor.${key}`);
        break;
      }
    }
  }

  // The registry may also pin the contract these services belong to. When it
  // does, the verifier can confirm it queried the contract the repository
  // publishes rather than one the receipt nominated for it.
  const net = input["network"];
  const contractId = isRecord(net) ? net["contract_id"] : input["contract_id"];
  if (typeof contractId === "string") {
    if (!STRKEY.test(contractId) || !contractId.startsWith("C")) {
      throw new RegistryError(`network.contract_id: expected a "C…" contract address, got ${JSON.stringify(contractId)}`);
    }
    registry.contractId = contractId;
  }
  return registry;
}

/**
 * Resolve the registry path: the explicit flag, else `services.json` beside the
 * receipt, else in the working directory. Returns undefined when there is none —
 * the caller turns that into `unavailable`, not into a pass.
 */
export function findRegistryPath(explicit: string | undefined, receiptPath: string): string | undefined {
  if (explicit !== undefined) return resolve(explicit);
  for (const candidate of [
    resolve(dirname(resolve(receiptPath)), "services.json"),
    resolve(process.cwd(), "services.json"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export function loadRegistry(path: string): ServiceRegistry {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new RegistryError(`${path}: cannot be read — ${(e as Error).message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new RegistryError(`${path}: not valid JSON — ${(e as Error).message}`);
  }
  return parseRegistry(value, path);
}
