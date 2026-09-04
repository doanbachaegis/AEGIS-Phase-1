import { describe, expect, it } from "vitest";
import { formatAmount } from "@aegis/canonical";
import { jsonSafe } from "../src/json.js";

/**
 * `TypeError: Do not know how to serialize a BigInt` thrown inside a pino call
 * does not merely lose a line — it loses the transcript record that §6.1 D2 is
 * scored on, at exactly the moment there is something worth recording.
 */
describe("jsonSafe", () => {
  it("survives JSON.stringify where a raw bigint would not", () => {
    const payload = { amount: 125000000n, nested: { cap: 2000000000n }, list: [1n, 2n] };
    expect(() => JSON.stringify(payload)).toThrow(TypeError);
    expect(JSON.parse(JSON.stringify(jsonSafe(payload)))).toEqual({
      amount: "125000000",
      nested: { cap: "2000000000" },
      list: ["1", "2"],
    });
  });

  it("leaves everything that already serializes alone", () => {
    const payload = { a: 1, b: "x", c: true, d: null, e: [1, "2"], f: { g: 3 } };
    expect(jsonSafe(payload)).toEqual(payload);
  });

  it("keeps Errors intact so pino's own serializer can handle them", () => {
    const err = new Error("boom");
    expect((jsonSafe({ err }) as { err: Error }).err).toBe(err);
  });

  /**
   * The net is not the rule. Amounts are meant to reach the reader as decimal
   * units via formatAmount; jsonSafe only stops a stray stroop value from
   * taking the record down with it.
   */
  it("is a net, not a substitute for formatAmount at the boundary", () => {
    expect(formatAmount(125000000n)).toBe("12.5");
    expect(jsonSafe(125000000n)).toBe("125000000");
  });
});
