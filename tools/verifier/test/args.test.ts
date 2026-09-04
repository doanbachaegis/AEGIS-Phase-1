/**
 * Argument parsing and exit-code arithmetic.
 *
 * The exit codes carry the tool's whole meaning to a CI job that never reads the
 * report, so the precedence between them is tested directly rather than inferred
 * from an end-to-end run.
 */
import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { EXIT, exitCodeFor, fail, pass, unavailable, verdictFor } from "../src/types.js";

const TX = "11".repeat(32);

describe("parseArgs", () => {
  it("takes the two required arguments", () => {
    const r = parseArgs(["--tx", TX, "--receipt", "r.json"]);
    expect(r.kind).toBe("run");
    if (r.kind !== "run") return;
    expect(r.options.tx).toBe(TX);
    expect(r.options.receipt).toBe("r.json");
    expect(r.options.strict).toBe(false);
    expect(r.options.json).toBe(false);
  });

  it("accepts --flag=value as well as --flag value", () => {
    const r = parseArgs([`--tx=${TX}`, "--receipt=r.json", "--strict", "--json"]);
    expect(r.kind).toBe("run");
    if (r.kind !== "run") return;
    expect(r.options.tx).toBe(TX);
    expect(r.options.strict).toBe(true);
    expect(r.options.json).toBe(true);
  });

  it("lowercases the transaction hash so comparisons are byte-exact", () => {
    const r = parseArgs(["--tx", TX.toUpperCase(), "--receipt", "r.json"]);
    expect(r.kind === "run" && r.options.tx).toBe(TX);
  });

  it("carries every override through", () => {
    const r = parseArgs([
      "--tx", TX, "--receipt", "r.json",
      "--horizon", "https://h", "--rpc", "https://r",
      "--contract", "C1", "--network", "Some Passphrase", "--registry", "s.json",
    ]);
    expect(r.kind).toBe("run");
    if (r.kind !== "run") return;
    expect(r.options.horizon).toBe("https://h");
    expect(r.options.rpc).toBe("https://r");
    expect(r.options.contract).toBe("C1");
    expect(r.options.network).toBe("Some Passphrase");
    expect(r.options.registry).toBe("s.json");
  });

  it("leaves overrides unset when they are not given, so the receipt supplies them", () => {
    const r = parseArgs(["--tx", TX, "--receipt", "r.json"]);
    expect(r.kind === "run" && r.options.horizon).toBeUndefined();
  });

  it("requires --tx and --receipt", () => {
    expect(parseArgs(["--receipt", "r.json"])).toMatchObject({ kind: "usage" });
    expect(parseArgs(["--tx", TX])).toMatchObject({ kind: "usage" });
  });

  it("rejects a transaction hash that is not 64 hex characters", () => {
    const r = parseArgs(["--tx", "abc", "--receipt", "r.json"]);
    expect(r.kind).toBe("usage");
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    const r = parseArgs(["--tx", TX, "--receipt", "r.json", "--insecure"]);
    expect(r).toMatchObject({ kind: "usage" });
  });

  it("rejects a flag given twice, which would silently pick one", () => {
    const r = parseArgs(["--tx", TX, "--tx", TX, "--receipt", "r.json"]);
    expect(r).toMatchObject({ kind: "usage" });
  });

  it("rejects a value flag whose value is missing or is another flag", () => {
    expect(parseArgs(["--tx"])).toMatchObject({ kind: "usage" });
    expect(parseArgs(["--tx", "--receipt", "r.json"])).toMatchObject({ kind: "usage" });
  });

  it("handles help and version before anything else", () => {
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseArgs(["--tx", TX, "-V"])).toEqual({ kind: "version" });
  });
});

describe("exit codes", () => {
  const ok = pass("a", "receipt", "t", "d");
  const bad = fail("b", "horizon", "t", "d");
  const unknown = unavailable("c", "horizon", "t", "d");

  it("0 when every check passed", () => {
    expect(exitCodeFor([ok, ok])).toBe(EXIT.VERIFIED);
  });

  it("3 when nothing failed but something could not be checked", () => {
    // The distinction the whole tool turns on: "could not check" is not "fine".
    expect(exitCodeFor([ok, unknown])).toBe(EXIT.UNAVAILABLE);
  });

  it("1 when a real mismatch was found, even alongside unavailable checks", () => {
    // A detected mismatch stands on its own; it does not become less true because
    // some other source was unreachable.
    expect(exitCodeFor([ok, unknown, bad])).toBe(EXIT.FAILED);
  });

  it("names each code unambiguously", () => {
    expect(verdictFor(EXIT.VERIFIED)).toBe("VERIFIED");
    expect(verdictFor(EXIT.FAILED)).toBe("FAILED");
    expect(verdictFor(EXIT.UNAVAILABLE)).toBe("UNAVAILABLE");
  });
});
