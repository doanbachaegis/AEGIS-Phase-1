/**
 * Hand-rolled receipt validator — no schema library, on purpose.
 *
 * The receipt is the one input a reviewer may have received from someone else,
 * so parsing it is a trust boundary. A hand-rolled validator keeps that boundary
 * readable in full, in one file, with no dependency to audit; it is the same
 * reason `@aegis/canonical` writes its own byte layout instead of reaching for a
 * serializer.
 *
 * It collects EVERY problem rather than throwing on the first: a reviewer fixing
 * a hand-written receipt should see the whole list in one run.
 */
import {
  RECEIPT_VERSION,
  type Receipt,
  type ReceiptChain,
  type ReceiptNetwork,
  type ReceiptSettlement,
} from "./types.js";

export class ReceiptValidationError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`invalid receipt:\n  - ${issues.join("\n  - ")}`);
    this.name = "ReceiptValidationError";
    this.issues = issues;
  }
}

export type ReceiptParseResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; issues: readonly string[] };

const U32_MAX = 0xffffffff;
/** Stellar strkeys are 56 characters of RFC 4648 base32 (no padding, no 0/1/8). */
const STRKEY = /^[A-Z2-7]{56}$/;

class Ctx {
  readonly issues: string[] = [];

  fail(path: string, message: string): void {
    this.issues.push(`${path}: ${message}`);
  }

  /** Returns the object at `path`, or undefined (having recorded an issue). */
  object(parent: Record<string, unknown>, path: string, keys: readonly string[]): Record<string, unknown> | undefined {
    const v = parent[path.split(".").pop() as string];
    if (!isPlainObject(v)) {
      this.fail(path, `expected an object, got ${describe(v)}`);
      return undefined;
    }
    for (const k of Object.keys(v)) {
      if (!keys.includes(k)) this.fail(`${path}.${k}`, "unknown field (receipts are parsed strictly)");
    }
    return v;
  }

  /**
   * Lowercase-normalized hex of exactly `bytes` bytes.
   * Mixed case is accepted and normalized; anything else is an issue.
   */
  hex(o: Record<string, unknown>, path: string, key: string, bytes: number): string {
    const v = o[key];
    if (typeof v !== "string") {
      this.fail(`${path}.${key}`, `expected a hex string, got ${describe(v)}`);
      return "";
    }
    const s = v.toLowerCase();
    if (!/^[0-9a-f]*$/.test(s)) {
      this.fail(`${path}.${key}`, "expected hex characters only (no 0x prefix)");
      return "";
    }
    if (s.length !== bytes * 2) {
      this.fail(`${path}.${key}`, `expected ${bytes} bytes (${bytes * 2} hex characters), got ${s.length / 2}`);
      return "";
    }
    return s;
  }

  /** A Stellar strkey with the given prefix: "G" for accounts, "C" for contracts. */
  strkey(o: Record<string, unknown>, path: string, key: string, prefix: string, what: string): string {
    const v = o[key];
    if (typeof v !== "string") {
      this.fail(`${path}.${key}`, `expected a ${what}, got ${describe(v)}`);
      return "";
    }
    if (!STRKEY.test(v) || !v.startsWith(prefix)) {
      this.fail(`${path}.${key}`, `expected a ${what} (56 base32 characters starting with "${prefix}"), got ${JSON.stringify(v)}`);
      return "";
    }
    return v;
  }

  /** A Stellar account (`G…`) or contract (`C…`) address — the agent may be either. */
  address(o: Record<string, unknown>, path: string, key: string): string {
    const v = o[key];
    if (typeof v !== "string") {
      this.fail(`${path}.${key}`, `expected an address, got ${describe(v)}`);
      return "";
    }
    if (!STRKEY.test(v) || !(v.startsWith("G") || v.startsWith("C"))) {
      this.fail(`${path}.${key}`, `expected a "G…" or "C…" address, got ${JSON.stringify(v)}`);
      return "";
    }
    return v;
  }

  nonEmptyString(o: Record<string, unknown>, path: string, key: string): string {
    const v = o[key];
    if (typeof v !== "string" || v.length === 0) {
      this.fail(`${path}.${key}`, `expected a non-empty string, got ${describe(v)}`);
      return "";
    }
    return v;
  }

  url(o: Record<string, unknown>, path: string, key: string): string {
    const v = this.nonEmptyString(o, path, key);
    if (v === "") return v;
    let parsed: URL;
    try {
      parsed = new URL(v);
    } catch {
      this.fail(`${path}.${key}`, `expected an absolute URL, got ${JSON.stringify(v)}`);
      return "";
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      this.fail(`${path}.${key}`, `expected an http(s) URL, got ${JSON.stringify(v)}`);
      return "";
    }
    return v;
  }

  u32(o: Record<string, unknown>, path: string, key: string): number {
    const v = o[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > U32_MAX) {
      this.fail(`${path}.${key}`, `expected an integer in [0, ${U32_MAX}], got ${describe(v)}`);
      return 0;
    }
    return v;
  }

  /**
   * A positive stroop amount as a decimal STRING.
   *
   * Rejects a JSON number outright rather than coercing it: an i128 amount does
   * not survive a double, and accepting one here would hide the loss instead of
   * reporting it.
   */
  stroops(o: Record<string, unknown>, path: string, key: string): string {
    const v = o[key];
    if (typeof v === "number") {
      this.fail(`${path}.${key}`, "expected a decimal STRING of stroops, got a number (a JSON number cannot hold an i128)");
      return "0";
    }
    if (typeof v !== "string") {
      this.fail(`${path}.${key}`, `expected a decimal string of stroops, got ${describe(v)}`);
      return "0";
    }
    if (!/^(?:0|[1-9][0-9]*)$/.test(v)) {
      this.fail(`${path}.${key}`, `expected digits only, no sign, no decimal point, no leading zero, got ${JSON.stringify(v)}`);
      return "0";
    }
    if (BigInt(v) <= 0n) {
      this.fail(`${path}.${key}`, "expected an amount > 0");
      return "0";
    }
    return v;
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const describe = (v: unknown): string => {
  if (v === undefined) return "nothing";
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
};

const NETWORK_KEYS = ["passphrase", "contract_id", "horizon", "rpc"] as const;
const CHAIN_KEYS = [
  "decision_id",
  "intent_hash",
  "policy_version",
  "agent",
  "service_id",
  "asset",
  "amount",
] as const;
const SETTLEMENT_KEYS = [
  "tx_hash",
  "memo_hash",
  "memo_preimage",
  "source",
  "destination",
  "asset",
] as const;
const TOP_KEYS = ["version", "network", "chain", "settlement", "issued_at"] as const;

/** Validate an already-parsed JSON value. Never throws. */
export function safeParseReceipt(input: unknown): ReceiptParseResult {
  const c = new Ctx();

  if (!isPlainObject(input)) {
    return { ok: false, issues: [`receipt: expected a JSON object, got ${describe(input)}`] };
  }
  for (const k of Object.keys(input)) {
    if (!(TOP_KEYS as readonly string[]).includes(k)) {
      c.fail(k, "unknown field (receipts are parsed strictly)");
    }
  }

  if (input["version"] !== RECEIPT_VERSION) {
    c.fail("version", `expected ${JSON.stringify(RECEIPT_VERSION)}, got ${JSON.stringify(input["version"]) ?? "nothing"}`);
  }

  const issuedAt = input["issued_at"];
  if (issuedAt !== undefined && typeof issuedAt !== "string") {
    c.fail("issued_at", `expected a string, got ${describe(issuedAt)}`);
  }

  const netObj = c.object(input, "network", NETWORK_KEYS as unknown as string[]);
  const chainObj = c.object(input, "chain", CHAIN_KEYS as unknown as string[]);
  const setObj = c.object(input, "settlement", SETTLEMENT_KEYS as unknown as string[]);

  const network: ReceiptNetwork = {
    passphrase: netObj ? c.nonEmptyString(netObj, "network", "passphrase") : "",
    contract_id: netObj ? c.strkey(netObj, "network", "contract_id", "C", "contract address") : "",
    horizon: netObj ? c.url(netObj, "network", "horizon") : "",
    rpc: netObj ? c.url(netObj, "network", "rpc") : "",
  };

  const chain: ReceiptChain = {
    decision_id: chainObj ? c.hex(chainObj, "chain", "decision_id", 32) : "",
    intent_hash: chainObj ? c.hex(chainObj, "chain", "intent_hash", 32) : "",
    policy_version: chainObj ? c.u32(chainObj, "chain", "policy_version") : 0,
    agent: chainObj ? c.address(chainObj, "chain", "agent") : "",
    service_id: chainObj ? c.nonEmptyString(chainObj, "chain", "service_id") : "",
    asset: chainObj ? c.strkey(chainObj, "chain", "asset", "C", "SAC contract address") : "",
    amount: chainObj ? c.stroops(chainObj, "chain", "amount") : "0",
  };

  const settlement: ReceiptSettlement = {
    tx_hash: setObj ? c.hex(setObj, "settlement", "tx_hash", 32) : "",
    memo_hash: setObj ? c.hex(setObj, "settlement", "memo_hash", 32) : "",
    memo_preimage: setObj ? c.hex(setObj, "settlement", "memo_preimage", 68) : "",
    source: setObj ? c.strkey(setObj, "settlement", "source", "G", "source account") : "",
    destination: setObj ? c.strkey(setObj, "settlement", "destination", "G", "destination account") : "",
    asset: setObj ? c.nonEmptyString(setObj, "settlement", "asset") : "",
  };

  // `CODE:ISSUER` — the canonical asset form of SPEC.md §5, field 4 of canonical_intent.
  // "native" is not accepted: Phase 1 settles exactly one credit asset (testnet USDC).
  if (settlement.asset !== "") {
    const parts = settlement.asset.split(":");
    const [code, issuer] = parts;
    if (parts.length !== 2 || !code || !issuer || !STRKEY.test(issuer) || !issuer.startsWith("G")) {
      c.fail("settlement.asset", `expected the canonical "CODE:ISSUER" form, got ${JSON.stringify(settlement.asset)}`);
    } else if (!/^[A-Za-z0-9]{1,12}$/.test(code)) {
      c.fail("settlement.asset", `asset code must be 1-12 alphanumeric characters, got ${JSON.stringify(code)}`);
    }
  }

  if (c.issues.length > 0) return { ok: false, issues: c.issues };

  const receipt: Receipt = { version: RECEIPT_VERSION, network, chain, settlement };
  if (typeof issuedAt === "string") receipt.issued_at = issuedAt;
  return { ok: true, receipt };
}

/** Validate an already-parsed JSON value, throwing {@link ReceiptValidationError}. */
export function parseReceipt(input: unknown): Receipt {
  const r = safeParseReceipt(input);
  if (!r.ok) throw new ReceiptValidationError(r.issues);
  return r.receipt;
}

/** Parse receipt JSON text. A malformed document is reported as an issue, not as a crash. */
export function parseReceiptJson(text: string): ReceiptParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [`receipt: not valid JSON — ${(e as Error).message}`] };
  }
  return safeParseReceipt(value);
}
