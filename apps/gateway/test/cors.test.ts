import { describe, expect, it } from "vitest";
import { corsOptions, originAllowed, parseCorsOrigins } from "../src/cors.js";

/**
 * The console is same-origin now, so these stand in for the OTHER browser
 * callers `CORS_ORIGIN` still exists for — and for a provider that mints a
 * fresh subdomain per environment, which is what the wildcard form is for.
 */
const APEX = "https://aegis-console.up.railway.app";
const PREVIEW = "https://*.up.railway.app";

describe("parseCorsOrigins", () => {
  it("treats unset and blank as no CORS at all", () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins("")).toEqual([]);
    expect(parseCorsOrigins("  ,  ,")).toEqual([]);
  });

  it("splits a comma-separated list and trims each entry", () => {
    expect(parseCorsOrigins(` ${APEX} , ${PREVIEW} `)).toEqual([APEX, PREVIEW]);
  });
});

describe("originAllowed", () => {
  it("matches an exact origin and nothing else", () => {
    expect(originAllowed([APEX], APEX)).toBe(true);
    expect(originAllowed([APEX], "https://aegis-console.up.railway.app.attacker.test")).toBe(false);
    // Scheme is part of the origin; an http:// twin is a different origin.
    expect(originAllowed([APEX], "http://aegis-console.up.railway.app")).toBe(false);
  });

  it("lets `*` stand for exactly one label, which is what a per-environment subdomain needs", () => {
    expect(originAllowed([PREVIEW], "https://aegis-pr-7.up.railway.app")).toBe(true);
    // The bare apex is not a match: the pattern requires a label before the dot.
    expect(originAllowed([PREVIEW], "https://up.railway.app")).toBe(false);
  });

  /**
   * The reason the wildcard is a hand-written matcher rather than a
   * `startsWith`/`endsWith` pair: a dot inside the wildcard segment would let an
   * attacker-controlled domain satisfy a pattern written for one subdomain.
   */
  it("refuses a dot inside the wildcard segment", () => {
    expect(originAllowed([PREVIEW], "https://evil.attacker.up.railway.app")).toBe(false);
  });

  it("allows any origin under `*`", () => {
    expect(originAllowed(["*"], "https://anything.example")).toBe(true);
  });

  it("accepts an origin matching any one entry of the list", () => {
    expect(originAllowed([APEX, PREVIEW], "https://aegis-pr-7.up.railway.app")).toBe(true);
    expect(originAllowed([APEX, PREVIEW], "https://other.example")).toBe(false);
  });
});

describe("corsOptions", () => {
  const decide = (patterns: readonly string[], origin: string | undefined): boolean => {
    let allowed: boolean | undefined;
    corsOptions(patterns).origin(origin, (_err, ok) => {
      allowed = ok;
    });
    if (allowed === undefined) throw new Error("origin callback was not invoked");
    return allowed;
  };

  /**
   * Railway's health probe and every curl of `/health` send no `Origin`. If the
   * allowlist rejected those, enabling CORS would take the service down.
   */
  it("allows requests that carry no Origin header", () => {
    expect(decide([APEX], undefined)).toBe(true);
  });

  it("applies the allowlist to browser requests", () => {
    expect(decide([APEX], APEX)).toBe(true);
    expect(decide([APEX], "https://other.example")).toBe(false);
  });

  it("never enables credentials — the gateway has no session to protect", () => {
    expect(corsOptions([APEX]).credentials).toBe(false);
  });
});
