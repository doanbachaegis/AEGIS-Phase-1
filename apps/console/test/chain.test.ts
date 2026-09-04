import { describe, expect, it } from "vitest";
import { Errors } from "@aegis/bindings";
import { contractErrorName, normalizeRef, stellarExpert } from "../src/chain.js";
import { MissingEnvError, requireEnv } from "../src/env.js";

const REF = "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e";

describe("normalizeRef", () => {
  it("accepts a bare 32-byte hex reference", () => {
    expect(normalizeRef(REF)).toBe(REF);
  });

  it("accepts the 0x prefix and any casing a reviewer might paste", () => {
    expect(normalizeRef(`0x${REF.toUpperCase()}`)).toBe(REF);
    expect(normalizeRef(`  ${REF}  `)).toBe(REF);
  });

  it("rejects anything that is not exactly 32 bytes of hex", () => {
    expect(normalizeRef("")).toBeNull();
    expect(normalizeRef(REF.slice(0, 63))).toBeNull();
    expect(normalizeRef(`${REF}00`)).toBeNull();
    expect(normalizeRef(REF.replace("2", "z"))).toBeNull();
  });
});

describe("stellarExpert links", () => {
  it("points at the network this console is configured for", () => {
    expect(stellarExpert.contract("CABC")).toBe(
      "https://stellar.expert/explorer/testnet/contract/CABC",
    );
    expect(stellarExpert.tx("deadbeef")).toBe("https://stellar.expert/explorer/testnet/tx/deadbeef");
  });
});

describe("requireEnv", () => {
  it("fails loudly rather than returning an empty string", () => {
    expect(() => requireEnv("VITE_CONTRACT_ID", undefined)).toThrow(MissingEnvError);
    expect(() => requireEnv("VITE_CONTRACT_ID", "   ")).toThrow(MissingEnvError);
    expect(() => requireEnv("VITE_CONTRACT_ID", "")).toThrow(/VITE_CONTRACT_ID/);
  });

  it("trims a value that is present", () => {
    expect(requireEnv("VITE_CONTRACT_ID", "  CABC  ")).toBe("CABC");
  });
});

/**
 * The trap this decoding exists to avoid.
 *
 * `stellar-sdk` builds its error table from the ABI as
 * `{ [case.value()]: { message: case.doc().toString() } }` — the case's DOC COMMENT.
 * `DecisionNotFound` has no doc comment in the contract, so
 * `result.unwrapErr().message` is the EMPTY STRING and every undocumented error looks
 * identical. The numeric discriminant does not have that problem, and `Errors` from the
 * committed bindings maps it back to the identifier.
 */
describe("contractErrorName", () => {
  const HOST_ERROR =
    'HostError: Error(Contract, #6)\n\nEvent log (newest first):\n' +
    '   0: [Diagnostic Event] topics:[error, Error(Contract, #6)]\n';

  it("decodes DecisionNotFound out of a failed simulation", () => {
    expect(contractErrorName(HOST_ERROR)).toBe("DecisionNotFound");
  });

  it("decodes the other codes the console reacts to", () => {
    expect(contractErrorName("HostError: Error(Contract, #1)")).toBe("NotInitialized");
    expect(contractErrorName("HostError: Error(Contract, #5)")).toBe("AgentNotRegistered");
    expect(contractErrorName("HostError: Error(Contract, #12)")).toBe("AgentRevoked");
  });

  it("returns null when the failure is not a contract error", () => {
    expect(contractErrorName("fetch failed")).toBeNull();
    expect(contractErrorName("Error(Storage, MissingValue)")).toBeNull();
  });

  it("returns null for a code the committed ABI does not define", () => {
    expect(contractErrorName("HostError: Error(Contract, #9999)")).toBeNull();
  });

  it("keeps the ABI table keyed by identifier, which is what makes the mapping work", () => {
    const table = Errors as Record<number, { message: string } | undefined>;
    expect(table[6]?.message).toBe("DecisionNotFound");
  });
});
