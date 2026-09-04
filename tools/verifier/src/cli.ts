#!/usr/bin/env node
/**
 * Standalone settlement verifier (SOW deliverable D3, §4.1 and §6.3).
 *
 * Takes ONE transaction hash and ONE receipt, and confirms that the payment on
 * the ledger is the payment the contract authorized — from PUBLIC DATA ONLY.
 *
 * 🔑 TWO INVARIANTS, and they are the entire evidential value of this tool:
 *
 *   1. It never calls the AEGIS API. Horizon and Soroban RPC only.
 *   2. It never imports `@aegis/bindings`. The contract ABI is fetched from the
 *      chain with `contract.Client.from({ contractId, rpcUrl, networkPassphrase })`,
 *      so a reviewer can run this against a contract ID with no AEGIS workspace
 *      built and no generated artefact to trust.
 *
 * Weakening either one to make a check easier would leave a tool that proves
 * nothing. Every line printed names the source of its evidence, so the claim is
 * verifiable by reading the output rather than by taking this comment's word.
 *
 * The headline property (§6.3):
 *
 *     MEMO_HASH == sha256(intent_hash || policy_version || decision_id)
 *
 * is checked three independent ways — recomputed locally by `@aegis/canonical`,
 * recomputed on chain by the contract's own `memo_hash()` view, and hashed from
 * the receipt's 68-byte preimage.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE, parseArgs } from "./args.js";
import { renderJson, renderReport } from "./report.js";
import { EXIT } from "./types.js";
import { UsageError, verify } from "./verify.js";

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.kind === "help") {
    process.stdout.write(USAGE);
    return EXIT.VERIFIED;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`aegis-verify ${version()}\n`);
    return EXIT.VERIFIED;
  }
  if (parsed.kind === "usage") {
    process.stderr.write(`aegis-verify: ${parsed.message}\n\n${USAGE}`);
    return EXIT.USAGE;
  }

  const report = await verify(parsed.options);
  process.stdout.write(parsed.options.json ? `${renderJson(report)}\n` : renderReport(report));
  return report.exitCode;
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof UsageError) {
    process.stderr.write(`aegis-verify: ${e.message}\n`);
    process.exitCode = EXIT.USAGE;
  } else {
    // Anything reaching here is a fault in the TOOL, not a verdict on the
    // settlement. Exiting 3 keeps it out of the "checked and fine" bucket.
    process.stderr.write(
      `aegis-verify: unexpected failure — ${(e as Error)?.stack ?? String(e)}\n`,
    );
    process.exitCode = EXIT.UNAVAILABLE;
  }
}
