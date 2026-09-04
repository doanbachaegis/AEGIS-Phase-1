import { describe, expect, it } from "vitest";
import {
  MIN_WRITE_KEY_LENGTH,
  bearerToken,
  classify,
  isGuardedWrite,
  keyMatches,
} from "../src/writeAuth.js";
import { Keypair } from "@aegis/bindings";
import { loadConfig } from "../src/config.js";

const KEY = "0123456789abcdef0123456789abcdef";

describe("isGuardedWrite", () => {
  it("guards every non-read method under the API prefixes", () => {
    expect(isGuardedWrite("POST", "/v1/intents")).toBe(true);
    expect(isGuardedWrite("POST", "/v1/decisions/abc/resolve")).toBe(true);
    // Scoped by METHOD, not by a list of paths, so a write route added later is
    // covered by default rather than by someone remembering to add it here.
    expect(isGuardedWrite("PUT", "/v1/anything-added-later")).toBe(true);
    expect(isGuardedWrite("DELETE", "/v1/anything-added-later")).toBe(true);
    expect(isGuardedWrite("PATCH", "/v1/anything-added-later")).toBe(true);
  });

  it("leaves reads public — §6.3 depends on a stranger being able to check a decision", () => {
    expect(isGuardedWrite("GET", "/v1/decisions/abc")).toBe(false);
    expect(isGuardedWrite("GET", "/v1/approvals?limit=5")).toBe(false);
    expect(isGuardedWrite("HEAD", "/v1/intents/abc")).toBe(false);
    expect(isGuardedWrite("GET", "/health")).toBe(false);
  });

  it("never challenges a CORS preflight", () => {
    expect(isGuardedWrite("OPTIONS", "/v1/intents")).toBe(false);
  });

  it("does not guard the console's own assets", () => {
    expect(isGuardedWrite("POST", "/")).toBe(false);
    expect(isGuardedWrite("POST", "/assets/App-abc.js")).toBe(false);
    // /v1x is a different prefix, not a child of /v1
    expect(isGuardedWrite("POST", "/v1x/intents")).toBe(false);
  });

  it("cannot be slipped past with a query string or fragment", () => {
    expect(isGuardedWrite("POST", "/v1/intents?x=/public")).toBe(true);
    expect(isGuardedWrite("POST", "/v1/intents#/public")).toBe(true);
  });

  it("accepts a lowercase method — Node normalizes, but the guard must not depend on it", () => {
    expect(isGuardedWrite("post", "/v1/intents")).toBe(true);
    expect(isGuardedWrite("get", "/v1/intents")).toBe(false);
  });
});

describe("bearerToken", () => {
  it("reads the token out of a well-formed header, case-insensitively", () => {
    expect(bearerToken(`Bearer ${KEY}`)).toBe(KEY);
    expect(bearerToken(`bearer ${KEY}`)).toBe(KEY);
    expect(bearerToken(`  Bearer   ${KEY}  `)).toBe(KEY);
  });

  it("rejects anything that is not a bearer token", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken(KEY)).toBeNull();
    expect(bearerToken(`Basic ${KEY}`)).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
  });
});

describe("keyMatches", () => {
  it("accepts the key and rejects near misses", () => {
    expect(keyMatches(KEY, KEY)).toBe(true);
    expect(keyMatches(KEY.slice(0, -1) + "0", KEY)).toBe(false);
    expect(keyMatches(KEY.toUpperCase(), KEY)).toBe(false);
  });

  it("compares different LENGTHS without throwing", () => {
    // timingSafeEqual throws on unequal lengths, so a short guess must not become a 500 —
    // and the length itself must not be observable. Both sides are digested first.
    expect(keyMatches("", KEY)).toBe(false);
    expect(keyMatches("x", KEY)).toBe(false);
    expect(keyMatches(KEY + KEY, KEY)).toBe(false);
  });
});

describe("classify", () => {
  it("lets a correct key through and turns a wrong one away", () => {
    expect(classify("POST", "/v1/intents", `Bearer ${KEY}`, KEY)).toBe("allowed");
    expect(classify("POST", "/v1/intents", "Bearer wrong", KEY)).toBe("unauthorized");
    expect(classify("POST", "/v1/intents", undefined, KEY)).toBe("unauthorized");
  });

  it("FAILS CLOSED: an unset key disables writes rather than opening them", () => {
    // The whole point of the module. An unconfigured deploy must refuse intents, not
    // serve them to the internet.
    expect(classify("POST", "/v1/intents", undefined, undefined)).toBe("writes-disabled");
    expect(classify("POST", "/v1/intents", `Bearer ${KEY}`, undefined)).toBe("writes-disabled");
    expect(classify("POST", "/v1/intents", `Bearer ${KEY}`, "")).toBe("writes-disabled");
  });

  it("never consults the key for a read", () => {
    expect(classify("GET", "/v1/decisions/abc", undefined, undefined)).toBe("not-a-write");
    expect(classify("GET", "/health", undefined, KEY)).toBe("not-a-write");
  });

  it("guards resolve, which the contract's require_owner does NOT protect from HTTP", () => {
    // resolve() is owner-only ON CHAIN, but this process holds OWNER_SECRET and signs as
    // the owner for whoever reaches the endpoint. The contract gate defends the key
    // hierarchy; this defends the door.
    expect(classify("POST", "/v1/decisions/abc/resolve", undefined, KEY)).toBe("unauthorized");
  });
});

describe("loadConfig — AEGIS_WRITE_KEY", () => {
  const base = {
    STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
    STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
    CONTRACT_ID: "CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA",
    // Generated per run -- no real secret key is ever written into this repo.
    OPERATOR_SECRET: Keypair.random().secret(),
  } as NodeJS.ProcessEnv;

  it("is optional, and absent means reads only", () => {
    expect(loadConfig(base).writeKey).toBeUndefined();
    expect(loadConfig({ ...base, AEGIS_WRITE_KEY: "   " }).writeKey).toBeUndefined();
  });

  it("refuses a short key at BOOT, so a weak value cannot sit in a running deployment", () => {
    expect(() => loadConfig({ ...base, AEGIS_WRITE_KEY: "short" })).toThrow(/AEGIS_WRITE_KEY/);
    expect(() => loadConfig({ ...base, AEGIS_WRITE_KEY: "x".repeat(MIN_WRITE_KEY_LENGTH - 1) })).toThrow(
      /at least 24/,
    );
  });

  it("accepts a key at the minimum length and trims it", () => {
    const key = "y".repeat(MIN_WRITE_KEY_LENGTH);
    expect(loadConfig({ ...base, AEGIS_WRITE_KEY: `  ${key}  ` }).writeKey).toBe(key);
  });
});
