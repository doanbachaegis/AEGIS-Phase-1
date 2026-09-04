import { describe, expect, it } from "vitest";
import { decisionHref, intentHref, parseRoute } from "../src/router.js";

const REF = "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e";

/**
 * §6.1 D4 makes the evidence "a public link to the console" plus a list of intent
 * references. A link that only works when clicked from inside the app is not evidence,
 * so `/intent/:ref` has to parse from a cold `window.location.pathname`.
 */
describe("parseRoute", () => {
  it("routes / to the lookup form", () => {
    expect(parseRoute("/")).toEqual({ kind: "home" });
    expect(parseRoute("")).toEqual({ kind: "home" });
  });

  it("resolves a deep link to an intent reference", () => {
    expect(parseRoute(`/intent/${REF}`)).toEqual({ kind: "reference", ref: REF, prefer: "intent" });
  });

  it("resolves a deep link to a decision id", () => {
    expect(parseRoute(`/decision/${REF}`)).toEqual({
      kind: "reference",
      ref: REF,
      prefer: "decision",
    });
  });

  it("tolerates a trailing slash", () => {
    expect(parseRoute(`/intent/${REF}/`)).toEqual({
      kind: "reference",
      ref: REF,
      prefer: "intent",
    });
  });

  it("decodes a percent-encoded segment", () => {
    expect(parseRoute("/intent/0x%41")).toEqual({ kind: "reference", ref: "0xA", prefer: "intent" });
  });

  it("reports anything else as unknown instead of silently showing the home page", () => {
    expect(parseRoute("/intent")).toEqual({ kind: "unknown", path: "/intent" });
    expect(parseRoute("/intent/a/b")).toEqual({ kind: "unknown", path: "/intent/a/b" });
    expect(parseRoute("/nope")).toEqual({ kind: "unknown", path: "/nope" });
  });

  it("round-trips the hrefs it generates", () => {
    expect(parseRoute(intentHref(REF))).toEqual({ kind: "reference", ref: REF, prefer: "intent" });
    expect(parseRoute(decisionHref(REF))).toEqual({
      kind: "reference",
      ref: REF,
      prefer: "decision",
    });
  });
});
