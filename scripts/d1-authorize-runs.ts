/**
 * D1 evidence producer - SOW section 6.1 D1 / section 6.3 criterion 1.
 *
 * Runs each of the seven section 5.2 scenarios ten times against the live
 * testnet authorization contract and writes the raw records, the decision
 * export and the result table into evidence/d1-authorize/.
 *
 * Usage (from the repo root):
 *     bash scripts/d1-run.sh              # the full 70
 *     bash scripts/d1-run.sh --smoke      # one run per scenario, separate out dir
 *
 * ---------------------------------------------------------------------------
 * Why this script does not go through apps/gateway
 * ---------------------------------------------------------------------------
 * D1 is evidence about the CONTRACT's decisions. Driving it through the HTTP
 * gateway would put the gateway's own request validation in front of the
 * contract, and several planned runs (an unlisted service, a non-policy asset)
 * are exactly the ones a gateway is supposed to refuse before they ever reach
 * the chain. So this calls `authorize` directly, through the same generated
 * bindings the gateway uses.
 *
 * ---------------------------------------------------------------------------
 * Why the imports are relative paths into dist/
 * ---------------------------------------------------------------------------
 * scripts/ is not a pnpm workspace package, so `@aegis/bindings` does not
 * resolve from here. Importing the built entry point directly lets Node resolve
 * @stellar/stellar-sdk from packages/bindings/node_modules, with no install
 * step and no change to the lockfile. Run `pnpm build` first.
 *
 * ---------------------------------------------------------------------------
 * Why a disposable submitter account pays the fees
 * ---------------------------------------------------------------------------
 * `authorize` needs two authorizations: `caller` (owner or operator) and the
 * agent. Neither has to be the transaction SOURCE. A fresh throwaway account
 * signs the envelope and pays the fee, while the operator and the agent each
 * sign an auth entry. Auth entries carry a random nonce rather than a sequence
 * number, so this session cannot collide with anything else submitting as the
 * operator at the same time - the D2/D3 evidence run, for instance. The
 * on-chain authorization is unchanged and still comes from the operator key.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";

import {
  Client,
  Errors,
  Keypair,
  contract,
  rpc,
} from "../packages/bindings/dist/index.js";
import { canonicalIntent, intentHash, decisionId, toHex, formatAmount } from "../packages/canonical/dist/index.js";

import {
  ASSETS,
  EXPECTATION,
  PRIMARY_RUNS,
  POLICY_TEMPLATE,
  REASON_NAME,
  REPLAY_TARGETS,
  ROLE_PURPOSE,
  SCENARIO_TITLE,
  VERDICT_NAME,
  type AgentRole,
  type PlannedRun,
} from "./d1-plan.js";

// ---------------------------------------------------------------------------
// environment
// ---------------------------------------------------------------------------

const SMOKE = process.argv.includes("--smoke");
const REPO = path.resolve(import.meta.dirname, "..");
const OUT_DIR = path.join(REPO, "evidence", SMOKE ? "d1-authorize-smoke" : "d1-authorize");

const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`missing ${k} in the environment (source .env first)`);
  return v;
};

const CONTRACT_ID = need("CONTRACT_ID");
const RPC_URL = need("STELLAR_RPC_URL");
const PASSPHRASE = need("STELLAR_NETWORK_PASSPHRASE");
const OPERATOR = Keypair.fromSecret(need("OPERATOR_SECRET"));
const OWNER = Keypair.fromSecret(need("OWNER_SECRET"));

const RUN_ID = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString()}]`, ...a);

function unwrap<T>(result: contract.Result<T>): T {
  if (result.isErr()) throw new Error(`contract error: ${result.unwrapErr().message}`);
  return result.unwrap();
}

/** A failed simulation reported from the simulation itself, not a re-thrown string. */
function assertSimulationOk(tx: { simulation?: rpc.Api.SimulateTransactionResponse }): void {
  const s = tx.simulation;
  if (s && rpc.Api.isSimulationError(s)) throw new Error(`simulation failed: ${s.error}`);
}

async function friendbot(address: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${address}`);
  if (!res.ok) {
    const body = await res.text();
    // Already funded is not a failure - it is the state we wanted.
    if (body.includes("op_already_exists") || res.status === 400) {
      log(`friendbot: ${address} already funded`);
      return;
    }
    throw new Error(`friendbot failed for ${address}: ${res.status} ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// signing
// ---------------------------------------------------------------------------

/**
 * Address -> auth-entry signer. Populated with the operator, the owner and
 * every D1 agent. The submission loop asks `needsNonInvokerSigningBy()` what
 * the simulation actually wants rather than hardcoding who signs, so it stays
 * correct whichever credentials the RPC returns.
 */
const authSigners = new Map<string, contract.SignAuthEntry>();

function registerSigner(kp: Keypair): void {
  authSigners.set(kp.publicKey(), new contract.KeypairSigner(kp, PASSPHRASE).signAuthEntry);
}

registerSigner(OPERATOR);
registerSigner(OWNER);

/** The disposable fee payer. Regenerated every session; holds no authority. */
const SUBMITTER = Keypair.random();
const submitterSigner = new contract.KeypairSigner(SUBMITTER, PASSPHRASE);

function client(): Client {
  return new Client({
    contractId: CONTRACT_ID,
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: SUBMITTER.publicKey(),
    signTransaction: submitterSigner,
    signAuthEntry: submitterSigner,
    errorTypes: Errors,
  });
}

interface Submitted<T> {
  value: T;
  txHash: string | undefined;
  txLedgerSeq: number | undefined;
  isReadCall: boolean;
}

/** Build -> simulate -> sign every outstanding auth entry -> submit -> confirm. */
async function submit<T>(
  build: () => Promise<contract.AssembledTransaction<contract.Result<T>>>,
  label: string,
): Promise<Submitted<T>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      // Never `simulate: false`: the simulation is what produces the auth
      // entries and the resource fee.
      const tx = await build();
      tx.options.errorTypes = Errors;
      assertSimulationOk(tx);

      const isReadCall = tx.isReadCall;

      for (const address of tx.needsNonInvokerSigningBy()) {
        const signAuthEntry = authSigners.get(address);
        if (!signAuthEntry) throw new Error(`no auth-entry signer for ${address} (${label})`);
        // Sequential: signAuthEntries mutates the built operation in place.
        await tx.signAuthEntries({ address, signAuthEntry });
      }

      let txHash: string | undefined;
      const watcher = new (class extends contract.Watcher {
        override onSubmitted(response?: { hash?: string }): void {
          if (response?.hash) txHash = response.hash;
        }
        override onProgress(): void {}
      })();

      const sent = await tx.signAndSend({ watcher });
      const response = sent.getTransactionResponse;
      const txLedgerSeq =
        response && response.status !== rpc.Api.GetTransactionStatus.NOT_FOUND
          ? response.ledger
          : undefined;
      return { value: unwrap(sent.result), txHash, txLedgerSeq, isReadCall };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // A contract Error is deterministic - retrying only wastes fees.
      if (/Error\(Contract, #\d+\)|contract error:/.test(msg)) throw e;
      log(`  ! ${label} attempt ${attempt}/4 failed: ${msg.slice(0, 220)}`);
      if (attempt < 4) await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

/** Read-only view call. Simulated, never submitted. */
async function view<T>(build: () => Promise<contract.AssembledTransaction<contract.Result<T>>>): Promise<T> {
  const tx = await build();
  tx.options.errorTypes = Errors;
  assertSimulationOk(tx);
  return unwrap(tx.result);
}

// ---------------------------------------------------------------------------
// agent identities
// ---------------------------------------------------------------------------

interface D1Agent {
  role: AgentRole;
  alias: string;
  address: string;
  keypair: Keypair;
  revoked: boolean;
  registerTxHash?: string;
  revokeTxHash?: string;
}

const agents = new Map<AgentRole, D1Agent>();

/**
 * Every D1 identity is created fresh for the session, registered at policy
 * version 1 and never bumped.
 *
 * Fresh, because a tumbling window is 24h wide: re-using an identity across
 * sessions would carry yesterday's spend into today's scenario 1. Never
 * bumped, because the reviewer console renders the CURRENT policy next to a
 * decision, so an agent whose policy moved after a decision was recorded would
 * be displayed against a threshold that was not the one applied.
 *
 * aegis-agent-1 is deliberately untouched. Its window is shared with the
 * concurrent D2/D3 evidence run, and ten approvals here would consume budget
 * that run is relying on.
 */
async function createAgents(roles: AgentRole[]): Promise<void> {
  for (const role of roles) {
    const kp = Keypair.random();
    const agent: D1Agent = {
      role,
      alias: `aegis-d1-${role}`,
      address: kp.publicKey(),
      keypair: kp,
      revoked: false,
    };
    registerSigner(kp);
    agents.set(role, agent);
    log(`funding ${agent.alias} ${agent.address}`);
    await friendbot(agent.address);
  }

  // Friendbot creations need to be visible to the RPC before an auth entry can
  // be checked against the account.
  await sleep(6000);

  for (const agent of agents.values()) {
    const policy = {
      agent: agent.address,
      owner: OWNER.publicKey(),
      allowed_asset: POLICY_TEMPLATE.allowed_asset,
      allowed_services: [...POLICY_TEMPLATE.allowed_services],
      per_intent_cap: POLICY_TEMPLATE.per_intent_cap,
      approval_threshold: POLICY_TEMPLATE.approval_threshold,
      cumulative_window_cap: POLICY_TEMPLATE.cumulative_window_cap,
      window_seconds: POLICY_TEMPLATE.window_seconds,
      status: 0,
      version: 1,
    };
    const res = await submit(() => client().register_agent({ policy } as never), `register_agent ${agent.alias}`);
    agent.registerTxHash = res.txHash;
    log(`registered ${agent.alias} at policy version ${res.value}`);
  }

  const revoked = agents.get("revoked");
  if (revoked) {
    const res = await submit(() => client().revoke_agent({ agent: revoked.address }), `revoke_agent ${revoked.alias}`);
    revoked.revoked = true;
    revoked.revokeTxHash = res.txHash;
    log(`revoked ${revoked.alias}`);
  }
}

// ---------------------------------------------------------------------------
// one run
// ---------------------------------------------------------------------------

interface RunRecord {
  run_index: number;
  scenario: number;
  scenario_title: string;
  scenario_seq: number;
  kind: "primary" | "replay";
  replay_of_run_index?: number;
  agent_alias: string;
  agent_address: string;
  agent_status: "Active" | "Revoked";
  intent: {
    agent_id: string;
    service_id: string;
    asset: string;
    asset_sac: string;
    asset_label: string;
    amount_stroops: string;
    amount_display: string;
    purpose: string;
    client_ref: string;
  };
  canonical_preimage_hex: string;
  canonical_preimage_len: number;
  intent_hash: string;
  intent_hash_recomputed_ok: boolean;
  expected: { verdict: number; verdict_name: string; reason_code: number; reason_name: string; label: string };
  observed: {
    decision_id: string;
    intent_hash: string;
    policy_version: number;
    verdict: number;
    verdict_name: string;
    reason_code: number;
    reason_name: string;
    original_reason_code: number;
    original_reason_name: string;
    ledger_seq: number;
    resolved: boolean;
    settled: boolean;
    agent: string;
    service_id: string;
    asset: string;
    amount_stroops: string;
  };
  decision_id_recomputed_ok: boolean;
  readback_ok: boolean;
  tx_hash: string | undefined;
  tx_ledger_seq: number | undefined;
  simulation_was_read_call: boolean;
  replay?: {
    original_decision_id: string;
    original_ledger_seq: number;
    decision_id_identical: boolean;
    ledger_seq_identical: boolean;
    verdict_identical: boolean;
    reason_code_identical: boolean;
    new_decision_created: boolean;
  };
  pass: boolean;
  failure_reason?: string;
  note: string;
}

const records: RunRecord[] = [];
const byKey = new Map<string, RunRecord>();

function buildIntent(run: PlannedRun, agent: D1Agent) {
  const asset = ASSETS[run.asset];
  // clientRef carries the session id, so re-running the script produces fresh
  // intent hashes instead of silently replaying the previous session's.
  const clientRef = `${RUN_ID}-s${run.scenario}r${String(run.seq).padStart(2, "0")}`;
  return {
    intent: {
      // The agent's Stellar address, not a registry alias: these identities are
      // created by this script and are not in services.json, so binding the
      // preimage to the on-chain address is what makes it self-verifying.
      agentId: agent.address,
      serviceId: run.serviceId,
      asset: asset.canonical,
      amount: run.amount,
      purpose: run.purpose,
      clientRef,
    },
    asset,
  };
}

async function executeRun(
  run: PlannedRun,
  runIndex: number,
  kind: "primary" | "replay",
  original?: RunRecord,
): Promise<RunRecord> {
  const agent = agents.get(run.role)!;
  const { intent, asset } = original
    ? { intent: rebuildIntent(original), asset: ASSETS[run.asset] }
    : buildIntent(run, agent);

  const preimage = canonicalIntent(intent);
  const hash = intentHash(intent);
  const hashHex = toHex(hash);

  const expected =
    kind === "replay"
      ? {
          verdict: original!.observed.verdict,
          reason: original!.observed.reason_code,
          label: `${original!.observed.verdict_name} / ${original!.observed.reason_name} (unchanged)`,
        }
      : EXPECTATION[run.scenario];

  const label = `s${run.scenario}r${run.seq}`;
  const res = await submit(
    () =>
      client().authorize({
        caller: OPERATOR.publicKey(),
        intent_hash: Buffer.from(hash),
        agent: agent.address,
        service_id: intent.serviceId,
        asset: asset.sac,
        amount: intent.amount,
      }),
    `authorize ${label}`,
  );

  const d = res.value as Record<string, unknown>;
  const observed = {
    decision_id: toHex(new Uint8Array(d.decision_id as Buffer)),
    intent_hash: toHex(new Uint8Array(d.intent_hash as Buffer)),
    policy_version: Number(d.policy_version),
    verdict: Number(d.verdict),
    verdict_name: VERDICT_NAME[Number(d.verdict)] ?? `unknown(${d.verdict})`,
    reason_code: Number(d.reason_code),
    reason_name: REASON_NAME[Number(d.reason_code)] ?? `unknown(${d.reason_code})`,
    original_reason_code: Number(d.original_reason_code),
    original_reason_name: REASON_NAME[Number(d.original_reason_code)] ?? `unknown(${d.original_reason_code})`,
    ledger_seq: Number(d.ledger_seq),
    resolved: Boolean(d.resolved),
    settled: Boolean(d.settled),
    agent: String(d.agent),
    service_id: String(d.service_id),
    asset: String(d.asset),
    amount_stroops: String(d.amount),
  };

  // Independent read-back: the decision must be legible from the contract id
  // and the decision id alone, with nothing cached from the submission.
  let readbackOk = false;
  try {
    const back = (await view(() =>
      client().get_decision({ decision_id: Buffer.from(observed.decision_id, "hex") }),
    )) as Record<string, unknown>;
    readbackOk =
      toHex(new Uint8Array(back.decision_id as Buffer)) === observed.decision_id &&
      Number(back.verdict) === observed.verdict &&
      Number(back.reason_code) === observed.reason_code &&
      Number(back.ledger_seq) === observed.ledger_seq;
  } catch (e) {
    log(`  ! read-back failed for ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const derivedId = toHex(decisionId(hash, observed.policy_version));

  const failures: string[] = [];
  if (observed.verdict !== expected.verdict) {
    failures.push(`verdict ${observed.verdict_name} != expected ${VERDICT_NAME[expected.verdict]}`);
  }
  if (observed.reason_code !== expected.reason) {
    failures.push(`reason_code ${observed.reason_code} (${observed.reason_name}) != expected ${expected.reason} (${REASON_NAME[expected.reason]})`);
  }
  if (observed.intent_hash !== hashHex) failures.push("on-chain intent_hash differs from the locally computed one");
  if (derivedId !== observed.decision_id) failures.push("decision_id is not sha256(AEGIS-DECISION-v1 || intent_hash || policy_version)");
  if (!readbackOk) failures.push("decision was not readable back on chain");

  let replay: RunRecord["replay"];
  if (kind === "replay" && original) {
    replay = {
      original_decision_id: original.observed.decision_id,
      original_ledger_seq: original.observed.ledger_seq,
      decision_id_identical: observed.decision_id === original.observed.decision_id,
      ledger_seq_identical: observed.ledger_seq === original.observed.ledger_seq,
      verdict_identical: observed.verdict === original.observed.verdict,
      reason_code_identical: observed.reason_code === original.observed.reason_code,
      // The stored ledger_seq is the one the ORIGINAL decision was written at.
      // If the replay had created a decision it would carry the replay
      // transaction's ledger instead.
      new_decision_created: observed.ledger_seq !== original.observed.ledger_seq,
    };
    if (!replay.decision_id_identical) failures.push("replay returned a different decision_id");
    if (!replay.ledger_seq_identical) failures.push("replay returned a different ledger_seq - a new decision was created");
  }

  const record: RunRecord = {
    run_index: runIndex,
    scenario: kind === "replay" ? 7 : run.scenario,
    scenario_title: SCENARIO_TITLE[kind === "replay" ? 7 : run.scenario],
    scenario_seq: run.seq,
    kind,
    replay_of_run_index: original?.run_index,
    agent_alias: agent.alias,
    agent_address: agent.address,
    agent_status: agent.revoked ? "Revoked" : "Active",
    intent: {
      agent_id: intent.agentId,
      service_id: intent.serviceId,
      asset: intent.asset,
      asset_sac: asset.sac,
      asset_label: asset.label,
      amount_stroops: intent.amount.toString(),
      amount_display: formatAmount(intent.amount),
      purpose: intent.purpose,
      client_ref: intent.clientRef,
    },
    canonical_preimage_hex: toHex(preimage),
    canonical_preimage_len: preimage.length,
    intent_hash: hashHex,
    intent_hash_recomputed_ok: observed.intent_hash === hashHex,
    expected: {
      verdict: expected.verdict,
      verdict_name: VERDICT_NAME[expected.verdict] ?? "same as original",
      reason_code: expected.reason,
      reason_name: REASON_NAME[expected.reason] ?? "same as original",
      label: expected.label,
    },
    observed,
    decision_id_recomputed_ok: derivedId === observed.decision_id,
    readback_ok: readbackOk,
    tx_hash: res.txHash,
    tx_ledger_seq: res.txLedgerSeq,
    simulation_was_read_call: res.isReadCall,
    replay,
    pass: failures.length === 0,
    failure_reason: failures.length ? failures.join("; ") : undefined,
    note: kind === "replay" ? (REPLAY_NOTES.get(`${run.scenario}:${run.seq}`) ?? "") : run.note,
  };

  return record;
}

const REPLAY_NOTES = new Map(REPLAY_TARGETS.map((t) => [`${t.scenario}:${t.seq}`, t.note]));

/** Rebuild the exact Intent a previous record was produced from, for a replay. */
function rebuildIntent(original: RunRecord) {
  return {
    agentId: original.intent.agent_id,
    serviceId: original.intent.service_id,
    asset: original.intent.asset,
    amount: BigInt(original.intent.amount_stroops),
    purpose: original.intent.purpose,
    clientRef: original.intent.client_ref,
  };
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

const jsonReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

function writeOutputs(sessionMeta: Record<string, unknown>): void {
  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(
    path.join(OUT_DIR, "runs.ndjson"),
    records.map((r) => JSON.stringify(r, jsonReplacer)).join("\n") + "\n",
  );

  const exportRows = records.map((r) => ({
    run_index: r.run_index,
    scenario: r.scenario,
    decision_id: r.observed.decision_id,
    intent_hash: r.observed.intent_hash,
    policy_version: r.observed.policy_version,
    verdict: r.observed.verdict,
    verdict_name: r.observed.verdict_name,
    reason_code: r.observed.reason_code,
    reason_name: r.observed.reason_name,
    ledger_seq: r.observed.ledger_seq,
  }));

  writeFileSync(
    path.join(OUT_DIR, "decision-export.json"),
    JSON.stringify(
      {
        schema: "aegis.d1.decision-export.v1",
        ...sessionMeta,
        reason_code_table: REASON_NAME,
        verdict_table: VERDICT_NAME,
        decisions: exportRows,
      },
      jsonReplacer,
      2,
    ) + "\n",
  );

  const csvHead = "run_index,scenario,decision_id,intent_hash,policy_version,verdict,verdict_name,reason_code,reason_name,ledger_seq";
  writeFileSync(
    path.join(OUT_DIR, "decision-export.csv"),
    [csvHead, ...exportRows.map((r) => Object.values(r).join(","))].join("\n") + "\n",
  );

  writeFileSync(
    path.join(OUT_DIR, "agents.json"),
    JSON.stringify(
      {
        schema: "aegis.d1.agents.v1",
        ...sessionMeta,
        policy_template: POLICY_TEMPLATE,
        agents: [...agents.values()].map((a) => ({
          alias: a.alias,
          address: a.address,
          role: a.role,
          why: ROLE_PURPOSE[a.role],
          status: a.revoked ? "Revoked" : "Active",
          policy_version: 1,
          register_tx: a.registerTxHash,
          revoke_tx: a.revokeTxHash,
        })),
        assets: ASSETS,
      },
      jsonReplacer,
      2,
    ) + "\n",
  );

  writeFileSync(path.join(OUT_DIR, "results.md"), renderTable(sessionMeta));
  log(`wrote ${records.length} records to ${OUT_DIR}`);
}

function renderTable(meta: Record<string, unknown>): string {
  const passed = records.filter((r) => r.pass).length;
  const L: string[] = [];
  L.push("# D1 - authorize runs (SOW 6.1 D1, 6.3 criterion 1)");
  L.push("");
  L.push(`- Session: \`${RUN_ID}\``);
  L.push(`- Contract: \`${CONTRACT_ID}\` (${meta.network})`);
  L.push(`- Runs: **${passed} / ${records.length} passed** (verdict AND reason code both as expected, and the decision readable back on chain)`);
  L.push("");
  L.push("## Reason codes");
  L.push("");
  L.push("`reason_code` is a `u32` on the wire. SOW 5.2 names them in SCREAMING_SNAKE; the mapping is:");
  L.push("");
  L.push("| u32 | name |");
  L.push("| --- | --- |");
  for (const [k, v] of Object.entries(REASON_NAME)) L.push(`| ${k} | \`${v}\` |`);
  L.push("");
  L.push("`verdict` is likewise a `u32`: 0 `Approved`, 1 `Rejected`, 2 `RequiresApproval`.");
  L.push("");
  L.push("## Scenario summary");
  L.push("");
  L.push("| # | Scenario | Expected verdict / reason | Runs | Passed |");
  L.push("| --- | --- | --- | --- | --- |");
  for (let s = 1; s <= 7; s++) {
    const rows = records.filter((r) => r.scenario === s);
    const ok = rows.filter((r) => r.pass).length;
    L.push(`| ${s} | ${SCENARIO_TITLE[s]} | ${EXPECTATION[s].label} | ${rows.length} | ${ok} |`);
  }
  L.push("");
  L.push("## All runs");
  L.push("");
  L.push("| # | Scn | Agent | Service | Asset | Amount | Expected | Observed verdict | reason_code | policy_v | ledger_seq | decision_id | Pass |");
  L.push("| --- | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | --- | :---: |");
  for (const r of records) {
    const short = (h: string) => `\`${h.slice(0, 12)}...\``;
    L.push(
      `| ${r.run_index} | ${r.scenario} | ${r.agent_alias.replace("aegis-d1-", "")}${r.agent_status === "Revoked" ? " (revoked)" : ""} | \`${r.intent.service_id}\` | ${r.intent.asset.split(":")[0]} | ${r.intent.amount_display} | ${r.expected.label} | ${r.observed.verdict_name} | ${r.observed.reason_code} \`${r.observed.reason_name}\` | ${r.observed.policy_version} | ${r.observed.ledger_seq} | ${short(r.observed.decision_id)} | ${r.pass ? "PASS" : "FAIL"} |`,
    );
  }
  L.push("");
  L.push("## Scenario 7 - replay detail");
  L.push("");
  L.push("A replay must return the ORIGINAL decision: same `decision_id`, same `ledger_seq`, no new decision written. The replay transaction lands in a later ledger, and the gap between that ledger and the stored `ledger_seq` is what shows the decision was not rewritten.");
  L.push("");
  L.push("| # | Replay of run | decision_id same | ledger_seq same | stored ledger_seq | replay tx ledger | new decision? |");
  L.push("| --- | --- | :---: | :---: | ---: | ---: | :---: |");
  for (const r of records.filter((x) => x.kind === "replay")) {
    L.push(
      `| ${r.run_index} | ${r.replay_of_run_index} (scenario ${records.find((x) => x.run_index === r.replay_of_run_index)?.scenario}) | ${r.replay!.decision_id_identical ? "yes" : "NO"} | ${r.replay!.ledger_seq_identical ? "yes" : "NO"} | ${r.observed.ledger_seq} | ${r.tx_ledger_seq ?? "n/a"} | ${r.replay!.new_decision_created ? "YES" : "no"} |`,
    );
  }
  L.push("");
  L.push("## Verifying an intent_hash without any AEGIS code");
  L.push("");
  L.push("Each record in `runs.ndjson` carries `canonical_preimage_hex`, the exact bytes of `canonical_intent`. To check one:");
  L.push("");
  L.push("```sh");
  L.push("jq -r 'select(.run_index == 1) | .canonical_preimage_hex' evidence/d1-authorize/runs.ndjson \\");
  L.push("  | xxd -r -p | shasum -a 256");
  L.push("# compare against .intent_hash for the same run");
  L.push("```");
  L.push("");
  if (records.some((r) => !r.pass)) {
    L.push("## Failures");
    L.push("");
    for (const r of records.filter((x) => !x.pass)) {
      L.push(`- Run ${r.run_index} (scenario ${r.scenario}, seq ${r.scenario_seq}): ${r.failure_reason}`);
    }
    L.push("");
  }
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`D1 evidence session ${RUN_ID}${SMOKE ? " (SMOKE)" : ""}`);
  log(`contract ${CONTRACT_ID}`);
  log(`fee payer (disposable) ${SUBMITTER.publicKey()}`);
  await friendbot(SUBMITTER.publicKey());
  await sleep(6000);

  const primary = SMOKE
    ? [1, 2, 3, 4, 5, 6].map((s) => PRIMARY_RUNS.find((r) => r.scenario === s)!)
    : PRIMARY_RUNS;
  const replays = SMOKE ? REPLAY_TARGETS.slice(0, 1) : REPLAY_TARGETS;

  await createAgents([...new Set(primary.map((r) => r.role))]);

  let runIndex = 0;
  for (const run of primary) {
    runIndex += 1;
    const rec = await executeRun(run, runIndex, "primary");
    records.push(rec);
    byKey.set(`${run.scenario}:${run.seq}`, rec);
    log(
      `run ${String(runIndex).padStart(2, " ")}/${primary.length + replays.length} s${run.scenario}r${run.seq} ` +
        `${rec.observed.verdict_name}/${rec.observed.reason_name}(${rec.observed.reason_code}) ledger ${rec.observed.ledger_seq} ${rec.pass ? "PASS" : "FAIL " + rec.failure_reason}`,
    );
    appendFileSync(path.join(OUT_DIR, ".progress.log"), JSON.stringify(rec, jsonReplacer) + "\n");
  }

  for (const target of replays) {
    runIndex += 1;
    const original = byKey.get(`${target.scenario}:${target.seq}`);
    if (!original) throw new Error(`replay target s${target.scenario}r${target.seq} was never run`);
    const plan = PRIMARY_RUNS.find((r) => r.scenario === target.scenario && r.seq === target.seq)!;
    const rec = await executeRun(plan, runIndex, "replay", original);
    records.push(rec);
    log(
      `run ${String(runIndex).padStart(2, " ")}/${primary.length + replays.length} REPLAY of #${original.run_index} ` +
        `${rec.observed.verdict_name}/${rec.observed.reason_name} ledger ${rec.observed.ledger_seq} ${rec.pass ? "PASS" : "FAIL " + rec.failure_reason}`,
    );
    appendFileSync(path.join(OUT_DIR, ".progress.log"), JSON.stringify(rec, jsonReplacer) + "\n");
  }

  // Final window state, so the write-up can show the budget was never the
  // binding constraint on scenario 1.
  const windows: Record<string, unknown> = {};
  for (const a of agents.values()) {
    try {
      const w = (await view(() => client().get_window({ agent: a.address }))) as Record<string, unknown>;
      windows[a.alias] = { window_start: String(w.window_start), spent: String(w.spent) };
    } catch (e) {
      windows[a.alias] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  log("final windows", JSON.stringify(windows));

  writeOutputs({
    session: RUN_ID,
    network: process.env.STELLAR_NETWORK ?? "testnet",
    contract_id: CONTRACT_ID,
    caller: OPERATOR.publicKey(),
    fee_payer: SUBMITTER.publicKey(),
    final_windows: windows,
  });

  const passed = records.filter((r) => r.pass).length;
  log(`DONE: ${passed}/${records.length} passed`);
  if (passed !== records.length) process.exitCode = 1;
}

mkdirSync(OUT_DIR, { recursive: true });
main().catch((e) => {
  console.error(e);
  if (records.length) {
    try {
      writeOutputs({ session: RUN_ID, network: "testnet", contract_id: CONTRACT_ID, aborted: true });
    } catch {}
  }
  process.exit(1);
});
