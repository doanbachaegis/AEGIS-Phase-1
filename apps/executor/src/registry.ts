/**
 * The published `service_id` -> destination registry.
 *
 * The contract's `Decision` carries `service_id` but **no destination account**,
 * so the chain cannot constrain where the money goes (DECISIONS.md #6, and the
 * `trust_model` block inside `services.json` itself). This file is the
 * out-of-band binding the verifier checks the payee against, which makes a
 * misdirected payment DETECTABLE after the fact — not impossible.
 *
 * The executor therefore treats the registry, not `.env`, as the authority for
 * every value a reviewer will later re-check: the contract ID, the source
 * account, the asset, and the payee. `.env` is cross-checked against it and a
 * disagreement is a refusal, never a silent preference for one side.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SettlementError } from "./errors.js";

export interface RegistryAsset {
  code: string;
  issuer: string;
  /** The SAC address as it appears in `Decision.asset`. Cross-checked, never trusted. */
  sac: string;
}

export interface ServiceRegistry {
  path: string;
  /**
   * `sha256` over the file's raw bytes exactly as committed, per the registry's
   * own `hashing_rule`: no canonicalization, so the caveats in `trust_model`
   * are inside the hashed payload and cannot be stripped without changing it.
   */
  registryHash: string;
  registryVersion: number;
  networkPassphrase: string;
  contractId: string;
  executorAccount: string;
  asset: RegistryAsset;
  /** The published payee for an ACTIVE service, or undefined. */
  destinationFor(serviceId: string): string | undefined;
}

const STRKEY = /^[A-Z2-7]{56}$/;

const bad = (message: string, detail?: { expected?: string; actual?: string }) =>
  new SettlementError("REGISTRY_INVALID", message, detail);

const asObject = (v: unknown, what: string): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw bad(`${what} is not an object`);
  }
  return v as Record<string, unknown>;
};

const strkey = (o: Record<string, unknown>, key: string, prefix: string, what: string): string => {
  const v = o[key];
  if (typeof v !== "string" || !STRKEY.test(v) || !v.startsWith(prefix)) {
    throw bad(`${what} is not a "${prefix}…" address`, { expected: `${prefix}… (56 base32)`, actual: String(v) });
  }
  return v;
};

const text = (o: Record<string, unknown>, key: string, what: string): string => {
  const v = o[key];
  if (typeof v !== "string" || v === "") throw bad(`${what} is missing`);
  return v;
};

export function loadRegistry(path: string): ServiceRegistry {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (cause) {
    throw new SettlementError("REGISTRY_INVALID", `cannot read the service registry at ${path}`, { cause });
  }
  // Hash the BYTES, before parsing. Parsing normalizes; the published rule does not.
  const registryHash = createHash("sha256").update(raw).digest("hex");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (cause) {
    throw new SettlementError("REGISTRY_INVALID", `${path} is not valid JSON`, { cause });
  }
  const root = asObject(parsed, path);
  if (root["schema"] !== "aegis.service-registry.v1") {
    throw bad("unsupported registry schema", {
      expected: "aegis.service-registry.v1",
      actual: String(root["schema"]),
    });
  }

  const network = asObject(root["network"], "network");
  const assetObj = asObject(root["asset"], "asset");
  const executorObj = asObject(root["executor"], "executor");

  const registryVersion = root["registry_version"];
  if (typeof registryVersion !== "number" || !Number.isInteger(registryVersion)) {
    throw bad("registry_version is not an integer");
  }

  const services = root["services"];
  if (!Array.isArray(services)) throw bad("services is not an array");

  // Built once so a duplicated service_id is a load-time refusal rather than a
  // silent last-one-wins at payment time.
  const destinations = new Map<string, string>();
  for (const entry of services) {
    const s = asObject(entry, "services[]");
    const id = text(s, "service_id", "services[].service_id");
    const destination = strkey(s, "destination", "G", `services[${id}].destination`);
    if (s["active"] !== true) continue;
    if (destinations.has(id)) throw bad(`service_id "${id}" is listed twice among the active services`);
    destinations.set(id, destination);
  }

  const code = text(assetObj, "code", "asset.code");
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) {
    throw bad("asset.code is not 1-12 alphanumeric characters", { actual: code });
  }

  return {
    path,
    registryHash,
    registryVersion,
    networkPassphrase: text(asObject(network, "network"), "passphrase", "network.passphrase"),
    contractId: strkey(network, "contract_id", "C", "network.contract_id"),
    executorAccount: strkey(executorObj, "account_id", "G", "executor.account_id"),
    asset: {
      code,
      issuer: strkey(assetObj, "issuer", "G", "asset.issuer"),
      sac: strkey(assetObj, "sac", "C", "asset.sac"),
    },
    destinationFor: (serviceId) => destinations.get(serviceId),
  };
}
