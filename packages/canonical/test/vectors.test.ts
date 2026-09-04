/** Asserts the TS implementation matches the fixture shared with Rust. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalIntent, intentHash, memoHash, decisionId, toHex,
  parseAmount, formatAmount, STROOPS_PER_UNIT, type Intent,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(resolve(here, "../../../vectors/canonical-vectors.json"), "utf8"),
) as {
  vectors: {
    name: string;
    intent: Omit<Intent, "amount"> & { amount: string };
    policy_version: number;
    canonical_hex: string;
    intent_hash: string;
    decision_id: string;
    memo_hash: string;
  }[];
};

describe("canonical vectors", () => {
  it("fixture is not empty", () => {
    expect(fixture.vectors.length).toBeGreaterThan(0);
  });

  for (const v of fixture.vectors) {
    it(`matches vector: ${v.name}`, () => {
      const intent: Intent = { ...v.intent, amount: BigInt(v.intent.amount) };
      expect(toHex(canonicalIntent(intent))).toBe(v.canonical_hex);

      const ih = intentHash(intent);
      expect(toHex(ih)).toBe(v.intent_hash);

      const did = decisionId(ih, v.policy_version);
      expect(toHex(did)).toBe(v.decision_id);

      expect(toHex(memoHash(ih, v.policy_version, did))).toBe(v.memo_hash);
    });
  }
});

describe("spec invariants", () => {
  const base: Intent = {
    agentId: "a", serviceId: "s", asset: "USDC:GTEST",
    amount: 5n * STROOPS_PER_UNIT, purpose: "p", clientRef: "r",
  };

  it("length prefixes prevent ambiguity between adjacent fields", () => {
    const a = intentHash({ ...base, agentId: "ab", serviceId: "c" });
    const b = intentHash({ ...base, agentId: "a", serviceId: "bc" });
    expect(toHex(a)).not.toBe(toHex(b));
  });

  it("rejects an amount passed as a number instead of a bigint", () => {
    expect(() => canonicalIntent({ ...base, amount: 5 as unknown as bigint })).toThrow(TypeError);
  });

  it("rejects a non-positive amount", () => {
    expect(() => canonicalIntent({ ...base, amount: 0n })).toThrow(RangeError);
  });

  it("memo_hash requires exactly 32 bytes", () => {
    expect(() => memoHash(new Uint8Array(31), 1, new Uint8Array(32))).toThrow(RangeError);
    expect(() => memoHash(new Uint8Array(32), 1, new Uint8Array(33))).toThrow(RangeError);
  });

  it("policy_version must fit in a u32", () => {
    const ih = new Uint8Array(32);
    expect(() => memoHash(ih, -1, ih)).toThrow(RangeError);
    expect(() => memoHash(ih, 2 ** 32, ih)).toThrow(RangeError);
  });
});

describe("amounts never pass through a float", () => {
  it.each([
    ["1", 10_000_000n], ["12.5", 125_000_000n],
    ["0.0000001", 1n], ["1000000.1234567", 10_000_001_234_567n],
  ])("parseAmount(%s)", (input, expected) => {
    expect(parseAmount(input as string)).toBe(expected);
  });

  it("rejects more than 7 decimal places", () => {
    expect(() => parseAmount("0.00000001")).toThrow(RangeError);
  });

  it("round-trip parse/format", () => {
    for (const s of ["1", "12.5", "0.0000001", "1000000.1234567"]) {
      expect(formatAmount(parseAmount(s))).toBe(s);
    }
  });
});
