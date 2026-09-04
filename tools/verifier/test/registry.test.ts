/**
 * The registry parser, including the real `services.json` this repository ships.
 *
 * That last test is the one that matters: the registry is authored elsewhere in
 * the project, so a schema change there must break a test here rather than
 * quietly turn the destination check into `unavailable`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RegistryError, parseRegistry } from "../src/registry.js";
import * as f from "./fixtures.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("parseRegistry", () => {
  it("reads services given as a map", () => {
    const r = parseRegistry(
      { executor: f.EXECUTOR, services: { "openai-api": { destination: f.MERCHANT } } },
      "s.json",
    );
    expect(r.services.get("openai-api")).toBe(f.MERCHANT);
    expect(r.executor).toBe(f.EXECUTOR);
  });

  it("reads services given as an array", () => {
    const r = parseRegistry(
      { services: [{ service_id: "openai-api", destination: f.MERCHANT }] },
      "s.json",
    );
    expect(r.services.get("openai-api")).toBe(f.MERCHANT);
  });

  it("reads a bare destination string", () => {
    const r = parseRegistry({ services: { "openai-api": f.MERCHANT } }, "s.json");
    expect(r.services.get("openai-api")).toBe(f.MERCHANT);
  });

  it("reads the executor from an object under any of its usual keys", () => {
    for (const key of ["account_id", "account", "public_key", "address"]) {
      const r = parseRegistry({ executor: { [key]: f.EXECUTOR }, services: {} }, "s.json");
      expect(r.executor).toBe(f.EXECUTOR);
    }
  });

  it("picks up a pinned contract id", () => {
    const r = parseRegistry({ network: { contract_id: f.CONTRACT_ID }, services: {} }, "s.json");
    expect(r.contractId).toBe(f.CONTRACT_ID);
  });

  it("leaves the executor unset rather than guessing when none is published", () => {
    const r = parseRegistry({ services: {} }, "s.json");
    expect(r.executor).toBeUndefined();
  });

  it("rejects a destination that is not an account address", () => {
    // Being lenient about SPELLING is safe; being lenient about the VALUE is not.
    expect(() => parseRegistry({ services: { a: "not-an-account" } }, "s.json"))
      .toThrow(RegistryError);
    expect(() => parseRegistry({ services: { a: f.CONTRACT_ID } }, "s.json"))
      .toThrow(RegistryError);
  });

  it("rejects an entry with no destination at all", () => {
    expect(() => parseRegistry({ services: { a: { name: "x" } } }, "s.json")).toThrow(RegistryError);
  });

  it("rejects an array entry with no id", () => {
    expect(() => parseRegistry({ services: [{ destination: f.MERCHANT }] }, "s.json"))
      .toThrow(RegistryError);
  });

  it("rejects a document with no services key", () => {
    expect(() => parseRegistry({ executor: f.EXECUTOR }, "s.json")).toThrow(RegistryError);
  });
});

describe("the repository's own services.json", () => {
  const path = resolve(REPO_ROOT, "services.json");

  it.runIf(existsSync(path))("parses, and publishes the accounts the verifier needs", () => {
    const registry = parseRegistry(JSON.parse(readFileSync(path, "utf8")), path);
    expect(registry.executor).toBeDefined();
    expect(registry.contractId).toBe(f.CONTRACT_ID);
    // The service_id the live decision carries must resolve to a destination,
    // otherwise `payment.destination` could never be checked for it.
    expect(registry.services.get("openai-api")).toMatch(/^G[A-Z2-7]{55}$/);
  });
});
