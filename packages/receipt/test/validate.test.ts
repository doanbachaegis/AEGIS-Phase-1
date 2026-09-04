/**
 * The validator is a trust boundary: the receipt is the one input that may have
 * been handed to the reviewer by the party under scrutiny. So these tests are
 * mostly about what it REJECTS. A field that slips through unvalidated is a field
 * the verifier will later compare without ever having established its shape.
 */
import { describe, expect, it } from "vitest";
import {
  RECEIPT_VERSION,
  ReceiptValidationError,
  parseReceipt,
  parseReceiptJson,
  safeParseReceipt,
} from "../src/index.js";

/** The live testnet decision, so the fixture is a real document, not a shape. */
const valid = {
  version: RECEIPT_VERSION,
  network: {
    passphrase: "Test SDF Network ; September 2015",
    contract_id: "CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA",
    horizon: "https://horizon-testnet.stellar.org",
    rpc: "https://soroban-testnet.stellar.org",
  },
  chain: {
    decision_id: "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e",
    intent_hash: "c51c74d5c445350d848e85fe3bb9cb1949fb73675893a09e654126bfb93b7a10",
    policy_version: 1,
    agent: "GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH",
    service_id: "openai-api",
    asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    amount: "125000000",
  },
  settlement: {
    tx_hash: "0000000000000000000000000000000000000000000000000000000000000000",
    memo_hash: "44bdf40bed60f3b99b98d3cf298497b63dece3d9056d260a6544136cd1e0b3de",
    memo_preimage:
      "c51c74d5c445350d848e85fe3bb9cb1949fb73675893a09e654126bfb93b7a10" +
      "00000001" +
      "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e",
    source: "GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3",
    destination: "GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY",
    asset: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  },
};

/** Deep clone, then apply a mutation, so each case starts from a known-good document. */
const withChange = (mutate: (r: typeof valid) => void): unknown => {
  const copy = structuredClone(valid) as typeof valid;
  mutate(copy);
  return copy;
};

const issuesOf = (input: unknown): readonly string[] => {
  const r = safeParseReceipt(input);
  expect(r.ok).toBe(false);
  return r.ok ? [] : r.issues;
};

describe("a well-formed receipt", () => {
  it("parses", () => {
    const r = parseReceipt(valid);
    expect(r.version).toBe(RECEIPT_VERSION);
    expect(r.chain.amount).toBe("125000000");
    expect(r.settlement.memo_preimage).toHaveLength(136);
  });

  it("accepts an optional issued_at without checking anything against it", () => {
    const r = parseReceipt(withChange((x) => {
      (x as Record<string, unknown>)["issued_at"] = "2026-09-04T10:00:00Z";
    }));
    expect(r.issued_at).toBe("2026-09-04T10:00:00Z");
  });

  it("normalizes hex to lowercase so later comparisons are byte-exact", () => {
    const r = parseReceipt(withChange((x) => {
      x.chain.decision_id = x.chain.decision_id.toUpperCase();
    }));
    expect(r.chain.decision_id).toBe(valid.chain.decision_id);
  });
});

describe("structure", () => {
  it("rejects a non-object", () => {
    expect(issuesOf("not a receipt")[0]).toContain("expected a JSON object");
  });

  it("rejects the wrong schema version", () => {
    expect(issuesOf(withChange((x) => {
      (x as Record<string, unknown>)["version"] = "aegis-receipt/2";
    }))[0]).toContain("version");
  });

  it("rejects an unknown top-level field", () => {
    // A typo'd field would otherwise be silently ignored — and a field the
    // verifier never reads is a field nobody checks.
    expect(issuesOf(withChange((x) => {
      (x as Record<string, unknown>)["chian"] = {};
    })).join()).toContain("unknown field");
  });

  it("rejects an unknown field inside a block", () => {
    expect(issuesOf(withChange((x) => {
      (x.settlement as Record<string, unknown>)["fee"] = "100";
    })).join()).toContain("settlement.fee");
  });

  it("rejects a missing block", () => {
    expect(issuesOf(withChange((x) => {
      delete (x as Partial<typeof valid>).chain;
    })).join()).toContain("chain: expected an object");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const issues = issuesOf(withChange((x) => {
      x.chain.decision_id = "zz";
      x.chain.amount = "-1";
      x.settlement.source = "nope";
    }));
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("hex fields", () => {
  it("rejects a short hash", () => {
    expect(issuesOf(withChange((x) => {
      x.chain.intent_hash = "c51c74d5";
    })).join()).toContain("expected 32 bytes");
  });

  it("rejects a 0x prefix", () => {
    expect(issuesOf(withChange((x) => {
      x.chain.intent_hash = `0x${x.chain.intent_hash}`;
    })).join()).toContain("hex characters only");
  });

  it("requires the preimage to be exactly 68 bytes", () => {
    // 32 + 4 + 32. A preimage of any other length cannot be the one §6.3 describes.
    expect(issuesOf(withChange((x) => {
      x.settlement.memo_preimage = x.settlement.memo_preimage.slice(0, 128);
    })).join()).toContain("expected 68 bytes");
  });
});

describe("amounts", () => {
  it("rejects a JSON number outright", () => {
    // Coercing here would silently lose precision that an i128 needs.
    expect(issuesOf(withChange((x) => {
      (x.chain as unknown as Record<string, unknown>)["amount"] = 125000000;
    })).join()).toContain("cannot hold an i128");
  });

  it("rejects a decimal point — the field is stroops, not units", () => {
    expect(issuesOf(withChange((x) => {
      x.chain.amount = "12.5";
    })).join()).toContain("digits only");
  });

  it("rejects zero and negatives", () => {
    expect(issuesOf(withChange((x) => {
      x.chain.amount = "0";
    })).join()).toContain("> 0");
    expect(issuesOf(withChange((x) => {
      x.chain.amount = "-5";
    })).join()).toContain("digits only");
  });

  it("rejects a leading zero, which would make two spellings of one amount", () => {
    expect(issuesOf(withChange((x) => {
      x.chain.amount = "0125000000";
    })).join()).toContain("leading zero");
  });
});

describe("addresses", () => {
  it("requires the contract id to be a C-address", () => {
    expect(issuesOf(withChange((x) => {
      x.network.contract_id = valid.chain.agent;
    })).join()).toContain("network.contract_id");
  });

  it("requires the SAC to be a C-address, not the CODE:ISSUER string", () => {
    expect(issuesOf(withChange((x) => {
      x.chain.asset = valid.settlement.asset;
    })).join()).toContain("chain.asset");
  });

  it("requires source and destination to be G-accounts", () => {
    expect(issuesOf(withChange((x) => {
      x.settlement.destination = valid.chain.asset;
    })).join()).toContain("settlement.destination");
  });

  it("accepts a C-address agent, since an agent may be a contract", () => {
    const r = parseReceipt(withChange((x) => {
      x.chain.agent = valid.chain.asset;
    }));
    expect(r.chain.agent).toBe(valid.chain.asset);
  });
});

describe("the settlement asset string", () => {
  it("requires the canonical CODE:ISSUER form", () => {
    expect(issuesOf(withChange((x) => {
      x.settlement.asset = "USDC";
    })).join()).toContain("CODE:ISSUER");
  });

  it("rejects an issuer that is not an account", () => {
    expect(issuesOf(withChange((x) => {
      x.settlement.asset = `USDC:${valid.chain.asset}`;
    })).join()).toContain("CODE:ISSUER");
  });

  it("rejects an over-long asset code", () => {
    expect(issuesOf(withChange((x) => {
      x.settlement.asset = `USDCUSDCUSDCU:${valid.settlement.asset.split(":")[1]}`;
    })).join()).toContain("1-12 alphanumeric");
  });
});

describe("URLs", () => {
  it("rejects a relative URL", () => {
    expect(issuesOf(withChange((x) => {
      x.network.horizon = "/horizon";
    })).join()).toContain("absolute URL");
  });

  it("rejects a non-http scheme", () => {
    expect(issuesOf(withChange((x) => {
      x.network.rpc = "file:///etc/passwd";
    })).join()).toContain("http(s)");
  });
});

describe("entry points", () => {
  it("parseReceiptJson reports malformed JSON as an issue, not a crash", () => {
    const r = parseReceiptJson("{ nope");
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.issues.join()).toContain("not valid JSON");
  });

  it("parseReceiptJson round-trips a good document", () => {
    const r = parseReceiptJson(JSON.stringify(valid));
    expect(r.ok).toBe(true);
  });

  it("parseReceipt throws with every issue attached", () => {
    try {
      parseReceipt({});
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReceiptValidationError);
      expect((e as ReceiptValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});
