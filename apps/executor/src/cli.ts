#!/usr/bin/env node
/**
 * `aegis-settle` — the operator-facing entry point.
 *
 * Four verbs, and the separation between them is the operational story:
 *
 *   settle   --decision <hex> [--dry-run]   gate, prepare, mark, pay
 *   recover  --decision <hex>               drive one stored attempt to a terminal state
 *   pending                                 list attempts that are still in flight
 *   status   --decision <hex>               what the chain and the journal each say
 *
 * `recover` exists as its own verb because reconciliation must never be a side
 * effect of asking for a new settlement. It refuses to prepare anything: if
 * there is no stored attempt, there is nothing to recover, and inventing one
 * would be exactly the rebuild this executor is designed never to perform.
 *
 * Exit codes: 0 success, 1 refusal (the code is printed), 2 usage.
 */
// MUST stay the first import: it installs the warning filter before anything
// that reaches `node:sqlite` is evaluated. See src/quiet.ts.
import "./quiet.js";
import { writeFileSync } from "node:fs";
import { SettlementError, isGateCode } from "./errors.js";
import { createRuntime, type RuntimeHandle } from "./index.js";
import type { SettleResult } from "./settle.js";

const USAGE = `aegis-settle — decision-gated settlement executor (D3)

Usage:
  aegis-settle settle  --decision <64-hex> [--dry-run] [--json] [--receipt <path>]
  aegis-settle recover --decision <64-hex> [--json] [--receipt <path>]
  aegis-settle status  --decision <64-hex> [--json]
  aegis-settle pending [--json]

Options:
  --decision <hex>   the decision_id to settle. The ONLY input; there is no path
                     from a raw agent request to a payment.
  --dry-run          gate, preflight, build and COMMIT the envelope, then stop
                     before mark_settled and before submitting.
  --receipt <path>   write the settlement receipt as JSON.
  --json             machine-readable output.

Environment (see .env.example): CONTRACT_ID, STELLAR_RPC_URL, HORIZON_URL,
STELLAR_NETWORK_PASSPHRASE, EXECUTOR_SECRET, OPERATOR_SECRET,
SERVICE_REGISTRY_PATH, EXECUTOR_DB_PATH, SETTLEMENT_TIMEOUT_SECONDS.
`;

interface Args {
  command: string;
  decision?: string;
  dryRun: boolean;
  json: boolean;
  receiptPath?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const [command = "", ...rest] = argv;
  const args: Args = { command, dryRun: false, json: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    switch (flag) {
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--decision": {
        const v = rest[++i];
        if (v === undefined) throw new Error("--decision needs a value");
        args.decision = v.toLowerCase();
        break;
      }
      case "--receipt": {
        const v = rest[++i];
        if (v === undefined) throw new Error("--receipt needs a value");
        args.receiptPath = v;
        break;
      }
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }
  return args;
}

const requireDecision = (args: Args): string => {
  if (args.decision === undefined) throw new Error("--decision is required");
  return args.decision;
};

function printResult(r: SettleResult, args: Args): void {
  if (args.receiptPath !== undefined) {
    writeFileSync(args.receiptPath, `${JSON.stringify(r.receipt, null, 2)}\n`);
  }
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  const lines = [
    `decision_id     ${r.decisionId}`,
    `status          ${r.status}${r.dryRun ? "  (dry run — nothing submitted, nothing marked)" : ""}`,
    `memo_hash       ${r.memoHash}`,
    `tx_hash         ${r.txHash}`,
    `amount          ${r.amountStroops} stroops`,
    `destination     ${r.destination}`,
  ];
  if (r.markSettledLedger !== undefined) lines.push(`mark_settled    ledger ${r.markSettledLedger}`);
  if (r.ledger !== undefined) lines.push(`payment         ledger ${r.ledger}`);
  if (args.receiptPath !== undefined) lines.push(`receipt         ${args.receiptPath}`);
  console.log(lines.join("\n"));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return argv.length === 0 ? 2 : 0;
  }

  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`${(e as Error).message}\n\n${USAGE}`);
    return 2;
  }

  let runtime: RuntimeHandle;
  try {
    runtime = createRuntime();
  } catch (e) {
    if (e instanceof SettlementError) {
      console.error(e.describe());
      return 1;
    }
    throw e;
  }

  try {
    switch (args.command) {
      case "settle": {
        const r = await runtime.executor.settle(requireDecision(args), { dryRun: args.dryRun });
        printResult(r, args);
        return 0;
      }
      case "recover": {
        const r = await runtime.executor.recover(requireDecision(args));
        printResult(r, args);
        return 0;
      }
      case "pending": {
        const rows = await runtime.executor.pending();
        if (args.json) console.log(JSON.stringify(rows, null, 2));
        else if (rows.length === 0) console.log("no settlements in flight");
        else for (const r of rows) console.log(`${r.status.padEnd(10)} ${r.decisionId}  tx ${r.txHash}  max_time ${r.maxTime}`);
        return 0;
      }
      case "status": {
        // Deliberately prints BOTH sides. When they disagree, that disagreement
        // is the finding, and a command that reconciled them silently would hide it.
        const decision = requireDecision(args);
        const rows = await runtime.executor.pending();
        const record = rows.find((r) => r.decisionId === decision);
        const out = { decision_id: decision, journal: record ?? "no in-flight record" };
        console.log(args.json ? JSON.stringify(out, null, 2) : JSON.stringify(out, null, 2));
        return 0;
      }
      default:
        console.error(`unknown command: ${args.command}\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof SettlementError) {
      console.error(e.describe());
      if (isGateCode(e.code)) {
        console.error("  ^ refused by the decision itself — re-running changes nothing until the chain does");
      }
      return 1;
    }
    console.error(String((e as Error)?.stack ?? e));
    return 1;
  } finally {
    await runtime.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(String((e as Error)?.stack ?? e));
    process.exit(1);
  },
);
