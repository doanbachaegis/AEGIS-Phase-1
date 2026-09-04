/**
 * These are regression tests for two inputs that reached `intentHash()` and made
 * Fastify answer 500 instead of 400. `server.ts` calls the hasher without a
 * try/catch, so "the schema rejects it" and "the API behaves" are the same
 * statement.
 */
import { describe, expect, it } from "vitest";
import { IntentRequest } from "../src/schema.js";

const valid = {
  agent_id: "agent-1",
  service_id: "svc-1",
  asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  amount: "12.5",
  purpose: "unit test",
  client_ref: "ref-1",
};

describe("IntentRequest", () => {
  it("accepts a well-formed intent", () => {
    expect(IntentRequest.safeParse(valid).success).toBe(true);
  });

  // Bug 1: the regex accepted zero, and parseAmount("0") -> 0n, which
  // canonicalIntent rejects with `RangeError: amount must be > 0`.
  it.each(["0", "0.0", "0.0000000", "00"])("rejects a non-positive amount %j", (amount) => {
    expect(IntentRequest.safeParse({ ...valid, amount }).success).toBe(false);
  });

  it.each(["0.0000001", "1", "0.5"])("still accepts the positive amount %j", (amount) => {
    expect(IntentRequest.safeParse({ ...valid, amount }).success).toBe(true);
  });

  // Bug 2: max(255) counted UTF-16 code units, but ByteWriter.str8 counts UTF-8
  // bytes after NFC. 255 "đ" is 255 characters and 510 bytes.
  it("rejects a str8 field that is within 255 characters but over 255 bytes", () => {
    const overBudget = "đ".repeat(255);
    expect(overBudget.length).toBe(255);
    expect(new TextEncoder().encode(overBudget.normalize("NFC")).length).toBe(510);

    for (const field of ["agent_id", "service_id", "asset", "client_ref"] as const) {
      expect(IntentRequest.safeParse({ ...valid, [field]: overBudget }).success).toBe(false);
    }
  });

  it("accepts multi-byte text that fits the byte budget", () => {
    // 127 x 2 bytes = 254 bytes, inside the str8 limit.
    expect(IntentRequest.safeParse({ ...valid, agent_id: "đ".repeat(127) }).success).toBe(true);
  });

  it("rejects a purpose over the str16 budget of 65535 bytes", () => {
    // str16's limit, hit with multi-byte characters rather than length alone.
    expect(IntentRequest.safeParse({ ...valid, purpose: "đ".repeat(33000) }).success).toBe(false);
    expect(IntentRequest.safeParse({ ...valid, purpose: "đ".repeat(32767) }).success).toBe(true);
  });

  it("counts bytes after NFC, exactly as the hasher does", () => {
    // Decomposed "e" + U+0301 is 3 UTF-8 bytes; NFC folds it to 2. 127 of them
    // are 381 bytes raw and 254 after NFC, so this is accepted only because the
    // check normalizes first — the same order ByteWriter.str8 uses.
    const decomposed = "e\u0301".repeat(127);
    expect(new TextEncoder().encode(decomposed).length).toBe(381);
    expect(new TextEncoder().encode(decomposed.normalize("NFC")).length).toBe(254);
    expect(IntentRequest.safeParse({ ...valid, client_ref: decomposed }).success).toBe(true);
  });

  it("still rejects empty identity fields", () => {
    expect(IntentRequest.safeParse({ ...valid, agent_id: "" }).success).toBe(false);
  });
});
