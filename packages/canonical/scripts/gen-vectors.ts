/**
 * Generates the vectors/canonical-vectors.json fixture.
 *
 * Run BY HAND only when DELIBERATELY changing the spec — never in CI.
 * CI for both Rust and TS asserts AGAINST this file; a generator cannot verify itself.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  canonicalIntent, intentHash, memoHash, decisionId, toHex, parseAmount, type Intent,
} from "../src/index.js";

const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const cases: { name: string; intent: Intent; policyVersion: number }[] = [
  {
    name: "minimal-ascii",
    intent: { agentId: "agent-1", serviceId: "svc-api", asset: USDC,
              amount: parseAmount("1"), purpose: "api call", clientRef: "ref-001" },
    policyVersion: 1,
  },
  {
    name: "fractional-amount",
    intent: { agentId: "agent-1", serviceId: "svc-data", asset: USDC,
              amount: parseAmount("12.5"), purpose: "dataset query", clientRef: "ref-002" },
    policyVersion: 1,
  },
  {
    name: "max-precision-stroop",
    intent: { agentId: "agent-2", serviceId: "svc-compute", asset: USDC,
              amount: parseAmount("0.0000001"), purpose: "inference", clientRef: "ref-003" },
    policyVersion: 7,
  },
  {
    name: "unicode-nfc",
    intent: { agentId: "agent-vn", serviceId: "svc-api", asset: USDC,
              amount: parseAmount("250"), purpose: "gọi API phân tích", clientRef: "ref-004" },
    policyVersion: 2,
  },
  {
    name: "empty-optional-strings",
    intent: { agentId: "a", serviceId: "s", asset: USDC,
              amount: parseAmount("100"), purpose: "", clientRef: "" },
    policyVersion: 4294967295,
  },
  {
    name: "prefix-ambiguity-guard-a",
    intent: { agentId: "ab", serviceId: "c", asset: USDC,
              amount: parseAmount("5"), purpose: "p", clientRef: "r" },
    policyVersion: 1,
  },
  {
    name: "prefix-ambiguity-guard-b",
    intent: { agentId: "a", serviceId: "bc", asset: USDC,
              amount: parseAmount("5"), purpose: "p", clientRef: "r" },
    policyVersion: 1,
  },
];

const vectors = cases.map(({ name, intent, policyVersion }) => {
  const ih = intentHash(intent);
  const did = decisionId(ih, policyVersion);
  return {
    name,
    intent: { ...intent, amount: intent.amount.toString() },
    policy_version: policyVersion,
    canonical_hex: toHex(canonicalIntent(intent)),
    intent_hash: toHex(ih),
    decision_id: toHex(did),
    memo_hash: toHex(memoHash(ih, policyVersion, did)),
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../vectors/canonical-vectors.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ spec: "AEGIS-INTENT-v1", vectors }, null, 2) + "\n");
console.log(`Wrote ${vectors.length} vectors -> ${out}`);
