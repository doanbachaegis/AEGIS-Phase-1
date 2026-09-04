/**
 * The D1 run plan: SOW section 5.2's seven scenarios, ten runs each.
 *
 * Kept apart from the runner so the plan can be read, reviewed and diffed as
 * data. Nothing here talks to the network.
 *
 * Amounts are STROOPS as bigint, never numbers (README invariant #3).
 * The live policy every D1 agent is registered with:
 *
 *   per_intent_cap        500000000   (50 USDC)
 *   approval_threshold    250000000   (25 USDC)
 *   cumulative_window_cap 2000000000  (200 USDC)
 *   window_seconds        86400
 *   allowed_services      ["openai-api", "anthropic-api"]
 *
 * `evaluate()` in the contract checks in this fixed order:
 *   revoked -> service -> asset -> per-intent cap -> window cap -> threshold.
 * Several runs below are chosen specifically to pin that ordering down: a run
 * that breaks two rules at once must report the EARLIER one.
 */

/** Which registered identity a run is submitted against. */
export type AgentRole = "compliant" | "limits" | "mismatch" | "revoked";

export interface PlannedRun {
  /** 1..7, the SOW section 5.2 scenario number. */
  scenario: number;
  /** 1..10 within the scenario. */
  seq: number;
  role: AgentRole;
  serviceId: string;
  /** Key into ASSETS. */
  asset: AssetKey;
  amount: bigint;
  purpose: string;
  /** Why this particular row is in the plan. Copied into the evidence. */
  note: string;
}

export type AssetKey = "usdc" | "xlm" | "eurc";

/**
 * The three assets a run can name.
 *
 * `sac` is the contract Address compared against `Policy.allowed_asset`.
 * `canonical` is the "CODE:ISSUER" string that goes into `canonical_intent`.
 *
 * The XLM and EURC rows are real, deterministically derived testnet SAC
 * addresses (`stellar contract id asset --asset ...`), not invented strings —
 * so scenario 4 rejects a genuine other asset rather than a typo.
 */
export const ASSETS: Record<AssetKey, { sac: string; canonical: string; label: string }> = {
  usdc: {
    sac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    canonical: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    label: "USDC (policy asset)",
  },
  xlm: {
    sac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    canonical: "XLM:native",
    label: "XLM (native SAC)",
  },
  eurc: {
    sac: "CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ",
    canonical: "EURC:GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO",
    label: "EURC (testnet SAC)",
  },
};

export const VERDICT_NAME: Record<number, string> = {
  0: "Approved",
  1: "Rejected",
  2: "RequiresApproval",
};

export const REASON_NAME: Record<number, string> = {
  0: "Ok",
  1: "CapExceeded",
  2: "ServiceNotAllowed",
  3: "AssetMismatch",
  4: "AgentRevoked",
  5: "WindowCapExceeded",
  6: "PendingApproval",
  7: "OwnerRejected",
};

/** Expected outcome per scenario, as the u32 pair actually stored on chain. */
export const EXPECTATION: Record<number, { verdict: number; reason: number; label: string }> = {
  1: { verdict: 0, reason: 0, label: "Approved / Ok" },
  2: { verdict: 1, reason: 1, label: "Rejected / CapExceeded" },
  3: { verdict: 1, reason: 2, label: "Rejected / ServiceNotAllowed" },
  4: { verdict: 1, reason: 3, label: "Rejected / AssetMismatch" },
  5: { verdict: 2, reason: 6, label: "RequiresApproval / PendingApproval" },
  6: { verdict: 1, reason: 4, label: "Rejected / AgentRevoked" },
  7: { verdict: -1, reason: -1, label: "original decision returned unchanged" },
};

export const SCENARIO_TITLE: Record<number, string> = {
  1: "Compliant intent",
  2: "Amount over per_intent_cap",
  3: "Service not whitelisted",
  4: "Asset not the policy asset",
  5: "Above approval_threshold, at or under per_intent_cap",
  6: "Revoked agent",
  7: "Replay of an already-authorized intent_hash",
};

const OPENAI = "openai-api";
const ANTHROPIC = "anthropic-api";

/**
 * Scenario 1 - ten compliant intents.
 *
 * Every amount is <= approval_threshold (250000000), otherwise the run would
 * escalate instead of approving. These are the ONLY runs in the whole plan that
 * charge the tumbling window, so their total is the number that has to stay
 * under cumulative_window_cap: 1183399999 of 2000000000, ~59% of the budget.
 */
const SCENARIO_1: PlannedRun[] = [
  { amount: 10000000n, serviceId: OPENAI, purpose: "gpt-4o-mini batch inference, shard 01", note: "smallest compliant amount" },
  { amount: 25000000n, serviceId: ANTHROPIC, purpose: "haiku summarization batch", note: "" },
  { amount: 47500000n, serviceId: OPENAI, purpose: "embeddings backfill, shard 03", note: "" },
  { amount: 70000000n, serviceId: ANTHROPIC, purpose: "sonnet code review pass", note: "" },
  { amount: 99999999n, serviceId: OPENAI, purpose: "whisper transcription, 40h archive", note: "non-round amount, exercises i128 encoding" },
  { amount: 123400000n, serviceId: ANTHROPIC, purpose: "opus long-context document QA", note: "" },
  { amount: 150000000n, serviceId: OPENAI, purpose: "o1 reasoning eval harness", note: "" },
  { amount: 187500000n, serviceId: ANTHROPIC, purpose: "haiku classification sweep", note: "" },
  { amount: 220000000n, serviceId: OPENAI, purpose: "gpt-4o vision OCR run", note: "" },
  { amount: 250000000n, serviceId: ANTHROPIC, purpose: "sonnet nightly regression suite", note: "BOUNDARY: amount == approval_threshold, must approve (check is amount > threshold)" },
].map((r, i) => ({ ...r, scenario: 1, seq: i + 1, role: "compliant" as const, asset: "usdc" as const }));

/**
 * Scenario 2 - ten amounts over per_intent_cap (500000000).
 *
 * Runs 7-10 also exceed cumulative_window_cap on their own. They must still
 * report CapExceeded, because the per-intent check runs before the window
 * check. That is the point of including them.
 */
const SCENARIO_2: PlannedRun[] = [
  { amount: 500000001n, serviceId: OPENAI, purpose: "oversized fine-tune job", note: "BOUNDARY: per_intent_cap + 1 stroop" },
  { amount: 600000000n, serviceId: ANTHROPIC, purpose: "bulk opus evaluation", note: "" },
  { amount: 750000000n, serviceId: OPENAI, purpose: "full-corpus embedding rebuild", note: "" },
  { amount: 999999999n, serviceId: ANTHROPIC, purpose: "quarterly model bake-off", note: "" },
  { amount: 1000000000n, serviceId: OPENAI, purpose: "annual prepaid credit top-up", note: "" },
  { amount: 1234500000n, serviceId: ANTHROPIC, purpose: "red-team campaign, 3 week run", note: "" },
  { amount: 2500000000n, serviceId: OPENAI, purpose: "dataset licensing settlement", note: "also over cumulative_window_cap; per-intent cap must win" },
  { amount: 5000000000n, serviceId: ANTHROPIC, purpose: "multi-tenant capacity reservation", note: "also over cumulative_window_cap; per-intent cap must win" },
  { amount: 10000000000n, serviceId: OPENAI, purpose: "erroneous unit conversion, 1000 USDC", note: "also over cumulative_window_cap; per-intent cap must win" },
  { amount: 99999999999n, serviceId: ANTHROPIC, purpose: "runaway agent loop, 9999.99 USDC", note: "the budget-drift failure mode this contract exists to stop" },
].map((r, i) => ({ ...r, scenario: 2, seq: i + 1, role: "limits" as const, asset: "usdc" as const }));

/**
 * Scenario 3 - ten service ids that are not in allowed_services.
 *
 * Runs 8 and 9 ALSO break the threshold and the per-intent cap respectively;
 * the service check runs first, so ServiceNotAllowed must win both times.
 * Runs 8 and 10 are the byte-exactness cases services.json promises: matching
 * is over raw UTF-8 with no case folding and no trimming.
 */
const SCENARIO_3: PlannedRun[] = [
  { amount: 5000000n, serviceId: "stability-api", purpose: "image generation, product shots", note: "" },
  { amount: 12000000n, serviceId: "google-vertex", purpose: "gemini comparison run", note: "" },
  { amount: 30000000n, serviceId: "cohere-api", purpose: "rerank endpoint trial", note: "" },
  { amount: 45000000n, serviceId: "mistral-api", purpose: "open-weights latency benchmark", note: "" },
  { amount: 60000000n, serviceId: "replicate-api", purpose: "hosted diffusion inference", note: "" },
  { amount: 88000000n, serviceId: "huggingface-api", purpose: "inference endpoint autoscale", note: "" },
  { amount: 150000000n, serviceId: "elevenlabs-api", purpose: "voice synthesis, 200k chars", note: "" },
  { amount: 260000000n, serviceId: "OpenAI-API", purpose: "case-variant of a whitelisted id", note: "NO CASE FOLDING: differs from openai-api only in case; amount also over threshold, service check must win" },
  { amount: 600000000n, serviceId: "openai-api-v2", purpose: "versioned suffix on a whitelisted id", note: "prefix of no whitelisted entry; amount also over per_intent_cap, service check must win" },
  { amount: 15000000n, serviceId: "openai-api ", purpose: "trailing-space variant of a whitelisted id", note: "NO TRIMMING: 'openai-api' plus one U+0020" },
].map((r, i) => ({ ...r, scenario: 3, seq: i + 1, role: "mismatch" as const, asset: "usdc" as const }));

/**
 * Scenario 4 - ten intents naming an asset that is not Policy.allowed_asset.
 *
 * Service is always whitelisted, so nothing earlier in evaluate() can fire.
 * Runs 9 and 10 also break the threshold and the cap; asset must still win.
 */
const SCENARIO_4: PlannedRun[] = [
  { amount: 8000000n, serviceId: OPENAI, asset: "xlm" as const, purpose: "paid in XLM by mistake", note: "" },
  { amount: 20000000n, serviceId: ANTHROPIC, asset: "xlm" as const, purpose: "native-asset settlement attempt", note: "" },
  { amount: 55000000n, serviceId: OPENAI, asset: "xlm" as const, purpose: "wallet defaulted to native balance", note: "" },
  { amount: 120000000n, serviceId: ANTHROPIC, asset: "xlm" as const, purpose: "treasury swept to XLM overnight", note: "" },
  { amount: 240000000n, serviceId: OPENAI, asset: "xlm" as const, purpose: "XLM top-up just under threshold", note: "" },
  { amount: 9500000n, serviceId: ANTHROPIC, asset: "eurc" as const, purpose: "EU entity paying in EURC", note: "" },
  { amount: 33000000n, serviceId: OPENAI, asset: "eurc" as const, purpose: "euro-denominated invoice", note: "" },
  { amount: 175000000n, serviceId: ANTHROPIC, asset: "eurc" as const, purpose: "EURC treasury drawdown", note: "" },
  { amount: 300000000n, serviceId: OPENAI, asset: "eurc" as const, purpose: "EURC amount above approval_threshold", note: "also over threshold; asset check must win over escalation" },
  { amount: 750000000n, serviceId: ANTHROPIC, asset: "eurc" as const, purpose: "EURC amount above per_intent_cap", note: "also over per_intent_cap; asset check must win" },
].map((r, i) => ({ ...r, scenario: 4, seq: i + 1, role: "mismatch" as const }));

/**
 * Scenario 5 - ten intents above approval_threshold and at or under per_intent_cap.
 *
 * Run on the `limits` agent, which never receives an Approved verdict, so its
 * tumbling window stays at zero spend for the whole session. The window check
 * sits BEFORE the threshold check in evaluate(), so a dirty window here would
 * silently turn PendingApproval into WindowCapExceeded. Keeping this agent's
 * window empty removes that failure mode by construction rather than by
 * arithmetic.
 */
const SCENARIO_5: PlannedRun[] = [
  { amount: 250000001n, serviceId: OPENAI, purpose: "eval run just over the review line", note: "BOUNDARY: approval_threshold + 1 stroop" },
  { amount: 260000000n, serviceId: ANTHROPIC, purpose: "extended context experiment", note: "" },
  { amount: 300000000n, serviceId: OPENAI, purpose: "monthly inference reservation", note: "" },
  { amount: 333333333n, serviceId: ANTHROPIC, purpose: "shared capacity, one third", note: "non-round amount" },
  { amount: 375000000n, serviceId: OPENAI, purpose: "fine-tune, 3 epochs", note: "" },
  { amount: 400000000n, serviceId: ANTHROPIC, purpose: "batch API commitment", note: "" },
  { amount: 444444444n, serviceId: OPENAI, purpose: "load test, peak hour", note: "non-round amount" },
  { amount: 475000000n, serviceId: ANTHROPIC, purpose: "quarterly evaluation suite", note: "" },
  { amount: 499999999n, serviceId: OPENAI, purpose: "one stroop under the cap", note: "BOUNDARY: per_intent_cap - 1 stroop" },
  { amount: 500000000n, serviceId: ANTHROPIC, purpose: "exactly the per-intent ceiling", note: "BOUNDARY: amount == per_intent_cap, must escalate not reject" },
].map((r, i) => ({ ...r, scenario: 5, seq: i + 1, role: "limits" as const, asset: "usdc" as const }));

/**
 * Scenario 6 - ten intents from an agent revoked before any of them was sent.
 *
 * The revoked check is FIRST in evaluate(), so runs 4-8 deliberately break a
 * second rule as well (cap, threshold, service, asset, and run 8 all of them at
 * once). AgentRevoked must win every time, which is what "revocation takes
 * effect immediately" has to mean to be worth anything.
 */
const SCENARIO_6: PlannedRun[] = [
  { amount: 10000000n, serviceId: OPENAI, asset: "usdc" as const, purpose: "small spend after revocation", note: "otherwise fully compliant" },
  { amount: 250000000n, serviceId: ANTHROPIC, asset: "usdc" as const, purpose: "at threshold after revocation", note: "otherwise fully compliant" },
  { amount: 500000000n, serviceId: OPENAI, asset: "usdc" as const, purpose: "at cap after revocation", note: "otherwise fully compliant" },
  { amount: 600000000n, serviceId: ANTHROPIC, asset: "usdc" as const, purpose: "over cap after revocation", note: "also over per_intent_cap; revocation must win" },
  { amount: 300000000n, serviceId: OPENAI, asset: "usdc" as const, purpose: "over threshold after revocation", note: "also over threshold; revocation must win over escalation" },
  { amount: 15000000n, serviceId: "stability-api", asset: "usdc" as const, purpose: "unlisted service after revocation", note: "also an unlisted service; revocation must win" },
  { amount: 45000000n, serviceId: OPENAI, asset: "xlm" as const, purpose: "wrong asset after revocation", note: "also the wrong asset; revocation must win" },
  { amount: 99999999999n, serviceId: "google-vertex", asset: "eurc" as const, purpose: "every rule broken at once", note: "unlisted service AND wrong asset AND over cap AND over window; revocation must still win" },
  { amount: 75000000n, serviceId: ANTHROPIC, asset: "usdc" as const, purpose: "routine spend, key not yet rotated", note: "otherwise fully compliant" },
  { amount: 125000000n, serviceId: OPENAI, asset: "usdc" as const, purpose: "retry after a revoked rejection", note: "otherwise fully compliant" },
].map((r, i) => ({ ...r, scenario: 6, seq: i + 1, role: "revoked" as const }));

/**
 * Scenario 7 - ten replays, addressed by (scenario, seq) of the original run.
 *
 * Chosen to cover all six other scenarios, so idempotency is shown to hold for
 * every verdict the contract can produce, not just for approvals. Both
 * boundary rows of scenarios 2 and 5 are replayed, and the everything-broken
 * row of scenario 6.
 */
export const REPLAY_TARGETS: Array<{ scenario: number; seq: number; note: string }> = [
  { scenario: 1, seq: 1, note: "replay of an Approved decision" },
  { scenario: 1, seq: 5, note: "replay of an Approved decision, non-round amount" },
  { scenario: 1, seq: 10, note: "replay of the Approved threshold-boundary decision; must not charge the window twice" },
  { scenario: 2, seq: 1, note: "replay of a Rejected/CapExceeded decision" },
  { scenario: 2, seq: 10, note: "replay of the largest Rejected/CapExceeded decision" },
  { scenario: 3, seq: 8, note: "replay of a Rejected/ServiceNotAllowed decision" },
  { scenario: 4, seq: 9, note: "replay of a Rejected/AssetMismatch decision" },
  { scenario: 5, seq: 1, note: "replay of a RequiresApproval decision, still unresolved" },
  { scenario: 5, seq: 10, note: "replay of the RequiresApproval cap-boundary decision" },
  { scenario: 6, seq: 8, note: "replay of a Rejected/AgentRevoked decision" },
];

export const PRIMARY_RUNS: PlannedRun[] = [
  ...SCENARIO_1,
  ...SCENARIO_2,
  ...SCENARIO_3,
  ...SCENARIO_4,
  ...SCENARIO_5,
  ...SCENARIO_6,
];

/** The policy every D1 agent is registered with: a copy of aegis-agent-1's v1. */
export const POLICY_TEMPLATE = {
  allowed_services: [OPENAI, ANTHROPIC],
  allowed_asset: ASSETS.usdc.sac,
  per_intent_cap: 500000000n,
  approval_threshold: 250000000n,
  cumulative_window_cap: 2000000000n,
  window_seconds: 86400n,
};

export const ROLE_PURPOSE: Record<AgentRole, string> = {
  compliant: "scenario 1 - the only agent that ever receives an Approved verdict, so the only one whose tumbling window is ever charged",
  limits: "scenarios 2 and 5 - amount-limit cases; never approved, so its window stays at zero spend and cannot poison the scenario 5 threshold check",
  mismatch: "scenarios 3 and 4 - service and asset cases; never approved",
  revoked: "scenario 6 - registered active, then revoked before any run is sent",
};
