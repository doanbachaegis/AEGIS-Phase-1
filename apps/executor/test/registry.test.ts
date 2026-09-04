import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SettlementError } from "../src/errors.js";
import { deriveSac } from "../src/payment.js";
import { loadRegistry } from "../src/registry.js";
import { NETWORK } from "./fixtures.js";

const PUBLISHED = resolve(import.meta.dirname, "../../../services.json");

const withTempRegistry = <T>(mutate: (json: Record<string, unknown>) => void, fn: (path: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "aegis-registry-"));
  try {
    const json = JSON.parse(readFileSync(PUBLISHED, "utf8")) as Record<string, unknown>;
    mutate(json);
    const path = join(dir, "services.json");
    writeFileSync(path, JSON.stringify(json, null, 2));
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("the published registry", () => {
  it("loads and exposes the Phase 1 settlement facts", () => {
    const r = loadRegistry(PUBLISHED);
    expect(r.networkPassphrase).toBe(NETWORK);
    expect(r.contractId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(r.executorAccount).toMatch(/^G[A-Z2-7]{55}$/);
    expect(r.asset.code).toBe("USDC");
  });

  it("publishes a SAC that is exactly what its own code and issuer derive to", () => {
    // If this ever fails the registry contradicts itself, and every asset
    // comparison downstream would be checking against the wrong value.
    const r = loadRegistry(PUBLISHED);
    expect(deriveSac(r.asset.code, r.asset.issuer, r.networkPassphrase)).toBe(r.asset.sac);
  });

  it("resolves an active service and refuses an unpublished one", () => {
    const r = loadRegistry(PUBLISHED);
    expect(r.destinationFor("openai-api")).toMatch(/^G[A-Z2-7]{55}$/);
    expect(r.destinationFor("not-a-service")).toBeUndefined();
  });

  it("hashes the RAW BYTES on disk, per the registry's own hashing_rule", () => {
    // No canonicalization step: the caveats in `trust_model` are inside the
    // hashed payload and cannot be stripped without changing the hash.
    const r = loadRegistry(PUBLISHED);
    expect(r.registryHash).toBe(createHash("sha256").update(readFileSync(PUBLISHED)).digest("hex"));
  });

  it("refuses an unknown schema", () => {
    withTempRegistry(
      (j) => { j["schema"] = "something-else"; },
      (path) => expect(() => loadRegistry(path)).toThrowError(SettlementError),
    );
  });

  it("refuses a duplicated active service_id rather than silently taking the last", () => {
    withTempRegistry(
      (j) => {
        const services = j["services"] as unknown[];
        services.push({ ...(services[0] as object) });
      },
      (path) => expect(() => loadRegistry(path)).toThrowError(/listed twice/),
    );
  });

  it("skips inactive services", () => {
    withTempRegistry(
      (j) => {
        const services = j["services"] as Array<Record<string, unknown>>;
        for (const s of services) s["active"] = false;
      },
      (path) => expect(loadRegistry(path).destinationFor("openai-api")).toBeUndefined(),
    );
  });

  it("refuses a destination that is not a G… account", () => {
    withTempRegistry(
      (j) => {
        const services = j["services"] as Array<Record<string, unknown>>;
        (services[0] as Record<string, unknown>)["destination"] = "not-an-account";
      },
      (path) => expect(() => loadRegistry(path)).toThrowError(SettlementError),
    );
  });
});
