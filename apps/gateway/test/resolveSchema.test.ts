import { describe, expect, it } from "vitest";
import { ApprovalsQuery, DecisionIdParam, Hash32Hex, ResolveRequest } from "../src/schema.js";

describe("ResolveRequest", () => {
  /**
   * `approve` has no default on purpose. The whole point of an escalation is
   * that a human said something; a missing field read as "approve" would let a
   * malformed request settle money.
   */
  it("refuses to infer approval from a missing field", () => {
    expect(ResolveRequest.safeParse({}).success).toBe(false);
    expect(ResolveRequest.safeParse({ note: "looks fine" }).success).toBe(false);
  });

  it("accepts an explicit decision either way", () => {
    expect(ResolveRequest.parse({ approve: true }).approve).toBe(true);
    expect(ResolveRequest.parse({ approve: false }).approve).toBe(false);
  });

  it("refuses a truthy string standing in for the boolean", () => {
    expect(ResolveRequest.safeParse({ approve: "true" }).success).toBe(false);
    expect(ResolveRequest.safeParse({ approve: 1 }).success).toBe(false);
  });
});

describe("Hash32Hex", () => {
  const valid = "8a67dcdd52e65c657151f0ba09e23ae50035aaa04daf0c4aca0c09e3cf4ee421";

  it("accepts a 32-byte lowercase hex digest", () => {
    expect(DecisionIdParam.parse({ id: valid }).id).toBe(valid);
  });

  it.each([
    ["too short", valid.slice(0, 63)],
    ["too long", `${valid}00`],
    ["uppercase", valid.toUpperCase()],
    ["0x prefixed", `0x${valid}`],
    ["not hex", "z".repeat(64)],
  ])("rejects a %s digest", (_label, value) => {
    expect(Hash32Hex.safeParse(value).success).toBe(false);
  });
});

describe("ApprovalsQuery", () => {
  it("defaults and clamps the page size", () => {
    expect(ApprovalsQuery.parse({}).limit).toBe(50);
    expect(ApprovalsQuery.parse({ limit: "10" }).limit).toBe(10);
    expect(ApprovalsQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(ApprovalsQuery.safeParse({ limit: "1000" }).success).toBe(false);
  });
});
