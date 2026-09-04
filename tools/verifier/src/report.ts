/**
 * Rendering. The report is the deliverable a reviewer actually reads, so it is
 * written to be skimmed: one line per property, the SOURCE of the evidence in its
 * own column, and a verdict that cannot be mistaken for anything else.
 *
 * A FAILED verdict must be unmissable. It prints what was expected next to what
 * was found, and the closing paragraph says in words what the exit code means, so
 * a failure never reads like a warning.
 */
import type { Check, CheckStatus } from "./types.js";
import { EXIT } from "./types.js";
import type { VerifyReport } from "./verify.js";

const SOURCE_WIDTH = 11; // the longest source label, "soroban-rpc"
const GUTTER = " ".repeat(8 + SOURCE_WIDTH);

const useColor = (): boolean =>
  process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;

const paint = (code: string, s: string): string =>
  useColor() ? `\u001b[${code}m${s}\u001b[0m` : s;

const STATUS: Record<CheckStatus, { label: string; color: string }> = {
  pass: { label: "PASS", color: "32" },
  fail: { label: "FAIL", color: "31;1" },
  // Deliberately not a word that could be skimmed as "ok-ish".
  unavailable: { label: "????", color: "33" },
};

function renderCheck(c: Check): string {
  const s = STATUS[c.status];
  const lines = [
    `  ${paint(s.color, s.label)}  ${c.source.padEnd(SOURCE_WIDTH)}  ${c.title}`,
    `${GUTTER}  ${c.detail}`,
  ];
  if (c.expected !== undefined) lines.push(`${GUTTER}  expected: ${c.expected}`);
  if (c.actual !== undefined) lines.push(`${GUTTER}  actual:   ${c.actual}`);
  return lines.join("\n");
}

const EXPLANATION: Record<number, string> = {
  [EXIT.VERIFIED]:
    "Every property was checked against public data and holds. This payment is the\n  one the contract authorized.",
  [EXIT.FAILED]:
    "At least one property does NOT hold. This is a real mismatch between the payment\n" +
    "  on the ledger and the decision on the contract — not a transient problem, and not\n" +
    "  something a re-run will change.",
  [EXIT.UNAVAILABLE]:
    "Nothing contradicted the receipt, but at least one property could NOT be checked.\n" +
    "  This is NOT a pass: an unchecked property is unknown, not fine. Re-run once the\n" +
    "  source named above is reachable.",
};

export function renderReport(r: VerifyReport): string {
  const out: string[] = [""];
  out.push("AEGIS settlement verifier — public data only (Horizon + Soroban RPC)");
  out.push("");

  const field = (k: string, v: string): void => {
    out.push(`  ${k.padEnd(14)}${v}`);
  };
  field("transaction", r.tx);
  field("receipt", r.receiptPath);
  field("contract", r.resolved.contract);
  field("Soroban RPC", r.resolved.rpc);
  field("Horizon", r.resolved.horizon);
  field("registry", r.resolved.registry ?? "(none found)");
  field("network", r.resolved.networkPassphrase);
  if (r.strict) field("mode", "strict");
  out.push("");

  for (const c of r.checks) out.push(renderCheck(c));

  const counts = {
    pass: r.checks.filter((c) => c.status === "pass").length,
    fail: r.checks.filter((c) => c.status === "fail").length,
    unavailable: r.checks.filter((c) => c.status === "unavailable").length,
  };
  const color =
    r.exitCode === EXIT.VERIFIED ? "32;1" : r.exitCode === EXIT.FAILED ? "31;1" : "33;1";

  out.push("");
  out.push(`  ${"─".repeat(72)}`);
  out.push(
    `  VERDICT: ${paint(color, r.verdict)}  —  ` +
      `${counts.pass} passed, ${counts.fail} failed, ` +
      `${counts.unavailable} unavailable  (exit ${r.exitCode})`,
  );
  out.push("");
  out.push(`  ${EXPLANATION[r.exitCode] ?? ""}`);
  out.push("");
  return out.join("\n");
}

export function renderJson(r: VerifyReport): string {
  return JSON.stringify(
    {
      tool: "aegis-verify",
      verdict: r.verdict,
      exit_code: r.exitCode,
      transaction: r.tx,
      receipt: r.receiptPath,
      strict: r.strict,
      resolved: {
        contract_id: r.resolved.contract,
        rpc: r.resolved.rpc,
        horizon: r.resolved.horizon,
        registry: r.resolved.registry,
        network_passphrase: r.resolved.networkPassphrase,
      },
      summary: {
        passed: r.checks.filter((c) => c.status === "pass").length,
        failed: r.checks.filter((c) => c.status === "fail").length,
        unavailable: r.checks.filter((c) => c.status === "unavailable").length,
      },
      checks: r.checks,
    },
    null,
    2,
  );
}
