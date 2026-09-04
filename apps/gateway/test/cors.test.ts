import { describe, expect, it } from "vitest";
import { corsOptions, originAllowed, parseCorsOrigins } from "../src/cors.js";

const PAGES = "https://aegis-console.pages.dev";
const PREVIEW = "https://*.aegis-console.pages.dev";

describe("parseCorsOrigins", () => {
  it("treats unset and blank as no CORS at all", () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins("")).toEqual([]);
    expect(parseCorsOrigins("  ,  ,")).toEqual([]);
  });

  it("splits a comma-separated list and trims each entry", () => {
    expect(parseCorsOrigins(` ${PAGES} , ${PREVIEW} `)).toEqual([PAGES, PREVIEW]);
  });
});

describe("originAllowed", () => {
  it("matches an exact origin and nothing else", () => {
    expect(originAllowed([PAGES], PAGES)).toBe(true);
    expect(originAllowed([PAGES], "https://aegis-console.pages.dev.attacker.test")).toBe(false);
    // Scheme is part of the origin; an http:// twin is a different origin.
    expect(originAllowed([PAGES], "http://aegis-console.pages.dev")).toBe(false);
  });

  it("lets `*` stand for exactly one label, which is what Pages previews need", () => {
    expect(originAllowed([PREVIEW], "https://abc123.aegis-console.pages.dev")).toBe(true);
    // The apex is not a preview: the pattern requires a label before the dot.
    expect(originAllowed([PREVIEW], PAGES)).toBe(false);
  });

  /**
   * The reason the wildcard is a hand-written matcher rather than a
   * `startsWith`/`endsWith` pair: a dot inside the wildcard segment would let an
   * attacker-controlled domain satisfy a pattern written for one subdomain.
   */
  it("refuses a dot inside the wildcard segment", () => {
    expect(originAllowed([PREVIEW], "https://evil.attacker.aegis-console.pages.dev")).toBe(false);
  });

  it("allows any origin under `*`", () => {
    expect(originAllowed(["*"], "https://anything.example")).toBe(true);
  });

  it("accepts an origin matching any one entry of the list", () => {
    expect(originAllowed([PAGES, PREVIEW], "https://abc123.aegis-console.pages.dev")).toBe(true);
    expect(originAllowed([PAGES, PREVIEW], "https://other.example")).toBe(false);
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
    expect(decide([PAGES], undefined)).toBe(true);
  });

  it("applies the allowlist to browser requests", () => {
    expect(decide([PAGES], PAGES)).toBe(true);
    expect(decide([PAGES], "https://other.example")).toBe(false);
  });

  it("never enables credentials — the gateway has no session to protect", () => {
    expect(corsOptions([PAGES]).credentials).toBe(false);
  });
});
