import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { canonicalIntent, formatAmount, intentHash, parseAmount, toHex } from "@aegis/canonical";
import { Verdict } from "@aegis/bindings";
import { InProcessAgentSigner } from "./agentSigner.js";
import {
  AegisChain,
  ChainUnavailableError,
  ContractCallError,
  type ChainDecision,
} from "./chain.js";
import { loadConfig, loadEnvFile, type GatewayConfig } from "./config.js";
import { corsOptions } from "./cors.js";
import { asContractFailure, httpForContractFailure, reasonName, verdictName } from "./contractErrors.js";
import { openStore, type IntentStore } from "./db/store.js";
import { jsonSafe } from "./json.js";
import { Registry } from "./registry.js";
import {
  ApprovalsQuery,
  DecisionIdParam,
  IntentHashParam,
  IntentRequest,
  ResolveRequest,
} from "./schema.js";

/**
 * Intent Gateway (D2).
 *
 * The only path that turns an agent request into something the contract can
 * evaluate. The executor has NO second input path — it only accepts a
 * `decision_id`.
 *
 * This server's pino log IS the "request and response transcripts for the 20
 * submissions" evidence in §6.1 D2. Do not turn logging off.
 *
 * **The transcript, precisely.** Three record types, all keyed by `request_id`:
 *
 * | `event`            | when                        | what a reviewer gets from it |
 * |--------------------|-----------------------------|------------------------------|
 * | `intent.received`  | before any chain call       | the intent, and the FULL canonical preimage as hex |
 * | `decision.recorded`| after the verdict           | verdict and reason as BOTH name and number, ids, timings |
 * | `intent.failed`    | instead of the above        | the raw, unparsed simulation error |
 *
 * `canonical_hex` is the single highest-value field in the whole log. It is the
 * exact byte string that was hashed, so:
 *
 * ```
 * echo -n <canonical_hex> | xxd -r -p | shasum -a 256
 * ```
 *
 * lands on `intent_hash` with no AEGIS code anywhere in the loop — which is the
 * difference between §6.1's "checkable" and "asserted". Without it, recomputing
 * the hash means re-running our serializer, i.e. trusting the thing under review.
 *
 * A fourth line, `chain.submitted`, is operational rather than evidentiary: it
 * records the transaction hash the instant the network accepts the submission,
 * BEFORE the ~5s confirmation wait, so a crash inside that window still leaves a
 * handle on what was sent.
 */

/**
 * Two timings, never one.
 *
 * `verdict` is POST -> the contract's answer, which is known from the SIMULATION.
 * `finality` is POST -> the decision sitting in a closed ledger, which includes a
 * ledger close (~5s on testnet). They differ by roughly an order of magnitude and
 * they answer different questions: how fast can an agent be told, versus how fast
 * is the decision durable. Reporting one number invites the reader to draw the
 * wrong conclusion about whichever question they had in mind.
 */
interface Timings {
  verdict_ms: number | undefined;
  finality_ms: number | undefined;
}

export interface Services {
  config: GatewayConfig;
  registry: Registry;
  chain: AegisChain;
  store: IntentStore;
}

const nowMs = () => performance.now();
const elapsed = (t0: number): number => Math.round(nowMs() - t0);

/** Everything a decision looks like over HTTP. Amounts leave as strings, always. */
function decisionBody(d: ChainDecision, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision_id: d.decisionId,
    intent_hash: d.intentHash,
    verdict: verdictName(d.verdict),
    verdict_code: d.verdict,
    reason_code: reasonName(d.reasonCode),
    reason_code_number: d.reasonCode,
    /**
     * `original_reason_code` is NOT the same field as `reason_code` after a
     * resolve, and the console has to label them apart (DECISIONS.md #8).
     */
    original_reason_code: reasonName(d.originalReasonCode),
    original_reason_code_number: d.originalReasonCode,
    policy_version: d.policyVersion,
    resolved_policy_version: d.resolvedPolicyVersion ?? null,
    agent: d.agent,
    service_id: d.serviceId,
    asset_sac: d.asset,
    amount: formatAmount(d.amount),
    amount_stroops: d.amount.toString(),
    ledger_seq: d.ledgerSeq,
    resolved: d.resolved,
    settled: d.settled,
    ...extra,
  };
}

/** Map a thrown chain error onto a response, and say whether it needs an alert. */
function chainErrorResponse(e: unknown): {
  status: number;
  body: Record<string, unknown>;
  alert: boolean;
  raw: string;
  contractError: string | undefined;
} {
  if (e instanceof ContractCallError) {
    const mapping = httpForContractFailure(e.failure);
    return {
      status: mapping.status,
      body: { error: mapping.error, detail: mapping.detail, contract_error: e.failure.name },
      alert: mapping.alert,
      raw: e.failure.raw,
      contractError: e.failure.name,
    };
  }
  if (e instanceof ChainUnavailableError) {
    // The chain did not answer. That is ours, not the caller's.
    return {
      status: 502,
      body: { error: "chain_unavailable", detail: e.message },
      alert: true,
      raw: e.raw,
      contractError: undefined,
    };
  }
  const failure = asContractFailure(e);
  if (failure) {
    const mapping = httpForContractFailure(failure);
    return {
      status: mapping.status,
      body: { error: mapping.error, detail: mapping.detail, contract_error: failure.name },
      alert: mapping.alert,
      raw: failure.raw,
      contractError: failure.name,
    };
  }
  return {
    status: 500,
    body: { error: "internal_error", detail: e instanceof Error ? e.message : String(e) },
    alert: true,
    raw: e instanceof Error ? (e.stack ?? e.message) : String(e),
    contractError: undefined,
  };
}

export function registerRoutes(app: FastifyInstance, svc: Services): void {
  const { registry, chain, store, config } = svc;

  app.get("/health", async () => ({
    ok: true,
    contract_id: config.contractId,
    network_passphrase: config.networkPassphrase,
    caller: chain.callerAddress,
    caller_role: config.callerRole,
    owner_configured: chain.ownerAddress !== undefined,
    registry_version: registry.registryVersion,
    /**
     * Surfaced rather than hidden: a gateway serving decisions with `degraded`
     * here is working correctly and is still losing evidence rows. An operator
     * has to be able to see that without reading the boot log.
     */
    database: store.mode,
  }));

  // ---------------------------------------------------------------- intents

  app.post("/v1/intents", async (req, reply) => {
    const t0 = nowMs();
    const requestId = req.id;

    const parsed = IntentRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_intent", detail: parsed.error.issues });
    }
    const body = parsed.data;

    // ---- resolve the two string->Address mappings the ABI needs ----
    const agent = registry.agent(body.agent_id);
    if (!agent || !agent.active) {
      // No address means no `authorize()` call and therefore no on-chain
      // evidence to produce. Rejecting here is the honest answer; inventing an
      // address would not be.
      return reply.code(400).send({
        error: "unknown_agent",
        detail: `agent_id "${body.agent_id}" is not in the gateway registry`,
        known_agents: registry.agentList.filter((a) => a.active).map((a) => a.agentId),
      });
    }
    const asset = registry.asset(body.asset);
    if (!asset) {
      return reply.code(400).send({
        error: "unknown_asset",
        detail: `asset "${body.asset}" is not in the gateway registry`,
        known_assets: registry.assetList.map((a) => a.asset),
      });
    }
    // NOTE: `service_id` is deliberately NOT checked against services.json.
    // `Policy.allowed_services` is the authority and the contract records
    // `ServiceNotAllowed` ON CHAIN (SOW §5.2 scenario 3). A local pre-filter
    // would replace that evidence with gateway behaviour.
    const service = registry.service(body.service_id);

    // ---- canonicalize ----
    let intentHex: string;
    let canonicalHex: string;
    let amount: bigint;
    try {
      amount = parseAmount(body.amount);
      const intent = {
        agentId: body.agent_id,
        serviceId: body.service_id,
        asset: body.asset,
        amount,
        purpose: body.purpose,
        clientRef: body.client_ref,
      };
      // The try/catch is the point. `IntentRequest` guards every constraint
      // `SPEC.md` §1 states today, so nothing here should throw — but a future
      // canonical constraint that the schema has not learned about yet would
      // otherwise escape as a Fastify 500, reporting a caller error as a server
      // error. A caller error stays a caller error.
      canonicalHex = toHex(canonicalIntent(intent));
      intentHex = toHex(intentHash(intent));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      req.log.warn({ event: "intent.failed", request_id: requestId, stage: "canonicalize", detail }, "canonicalization rejected the intent");
      return reply.code(400).send({ error: "canonicalization_failed", detail });
    }

    // ---- transcript record 1 of 3 ----
    const firstSubmission = await store.recordIntent({
      intentHash: intentHex,
      agentId: body.agent_id,
      serviceId: body.service_id,
      asset: body.asset,
      amount,
      purpose: body.purpose,
      clientRef: body.client_ref,
      canonicalPreimage: canonicalHex,
      agentAddress: agent.address,
      assetSac: asset.sac,
      registryVersion: registry.registryVersion,
      requestId,
    });

    req.log.info(
      jsonSafe({
        event: "intent.received",
        request_id: requestId,
        intent_hash: intentHex,
        /** The exact bytes that were hashed. See the header comment. */
        canonical_hex: canonicalHex,
        canonical_len: canonicalHex.length / 2,
        intent: {
          agent_id: body.agent_id,
          service_id: body.service_id,
          asset: body.asset,
          amount: body.amount,
          amount_stroops: amount.toString(),
          purpose: body.purpose,
          client_ref: body.client_ref,
        },
        resolved: {
          agent_address: agent.address,
          asset_sac: asset.sac,
          service_destination: service?.destination ?? null,
          registry_version: registry.registryVersion,
        },
        /**
         * Not replay protection — the contract is idempotent on `intent_hash`
         * (DECISIONS.md #1) and will return the original decision. This only
         * reports that the same intent was submitted twice.
         */
        duplicate_submission: !firstSubmission,
      }),
      "intent received",
    );

    // ---- authorize on chain ----
    const timings: Timings = { verdict_ms: undefined, finality_ms: undefined };
    let txHash: string | undefined;

    try {
      const result = await chain.authorize(
        {
          intentHash: Uint8Array.from(Buffer.from(intentHex, "hex")),
          agentAddress: agent.address,
          serviceId: body.service_id,
          assetSac: asset.sac,
          amount,
        },
        {
          onVerdict: () => {
            timings.verdict_ms = elapsed(t0);
          },
          onSubmitted: (hash) => {
            txHash = hash;
            // Operational, not one of the three transcript records. Written
            // BEFORE the confirmation wait so a crash inside the ledger-close
            // window still leaves a handle on what was submitted.
            req.log.info(
              { event: "chain.submitted", request_id: requestId, intent_hash: intentHex, tx_hash: hash },
              "submission accepted by the network, awaiting ledger close",
            );
          },
          onFinality: () => {
            timings.finality_ms = elapsed(t0);
          },
        },
      );

      const d = result.decision;
      let escalation: Record<string, unknown> | undefined;

      if (d.verdict === Verdict.RequiresApproval) {
        escalation = await snapshotEscalation(svc, d, req);
      }

      await store.recordDecision({
        intentHash: intentHex,
        decisionId: d.decisionId,
        verdict: d.verdict,
        reasonCode: d.reasonCode,
        originalReasonCode: d.originalReasonCode,
        policyVersion: d.policyVersion,
        resolved: d.resolved,
        settled: d.settled,
        ledgerSeq: result.ledgerSeq ?? d.ledgerSeq,
        txHash,
        verdictMs: timings.verdict_ms,
        finalityMs: timings.finality_ms,
      });

      // ---- transcript record 2 of 3 ----
      req.log.info(
        jsonSafe({
          event: "decision.recorded",
          request_id: requestId,
          intent_hash: intentHex,
          decision_id: d.decisionId,
          // Both forms, deliberately: the name is what a reviewer reads, the
          // number is what the ABI actually carries and what the console
          // decodes. Printing only one makes the other unverifiable.
          verdict: verdictName(d.verdict),
          verdict_code: d.verdict,
          reason_code: reasonName(d.reasonCode),
          reason_code_number: d.reasonCode,
          original_reason_code: reasonName(d.originalReasonCode),
          original_reason_code_number: d.originalReasonCode,
          policy_version: d.policyVersion,
          agent: d.agent,
          service_id: d.serviceId,
          asset_sac: d.asset,
          amount: formatAmount(d.amount),
          amount_stroops: d.amount.toString(),
          ledger_seq: result.ledgerSeq ?? d.ledgerSeq,
          tx_hash: txHash ?? null,
          submitted: result.submitted,
          escalation: escalation ?? null,
          timings_ms: timings,
        }),
        "decision recorded",
      );

      const common = decisionBody(d, {
        asset: body.asset,
        agent_id: body.agent_id,
        tx_hash: txHash ?? null,
        submitted: result.submitted,
        /**
         * From services.json. PUBLISHED, NOT ENFORCED — the on-chain `Decision`
         * carries no destination, so this is where the registry says the money
         * should go, not where the contract requires it to go.
         */
        destination: service?.destination ?? null,
        destination_enforced: false,
        timings_ms: timings,
      });

      if (d.verdict === Verdict.RequiresApproval) {
        // 202 Accepted: the request was understood and recorded on chain, and
        // the outcome is not settled yet. A human has to act.
        return reply
          .code(202)
          .header("Location", `/v1/decisions/${d.decisionId}`)
          .send({ ...common, escalation });
      }

      /**
       * **`Rejected` is HTTP 200, and this is a judgement call the SOW does not
       * settle.**
       *
       * A rejection is a SUCCESSFUL governance decision: the policy was
       * evaluated, a verdict was reached, and the contract wrote it to the chain
       * where it can be read forever. Nothing failed. A 4xx would say the
       * request was malformed or unauthorized — it was neither — and it would
       * push well-behaved clients into retry-on-4xx paths for an answer that is
       * final and idempotent. It would also make the transcript read as if a
       * quarter of the §5.2 scenarios errored, when in fact the contract did
       * exactly its job in every one of them.
       *
       * The verdict is therefore carried in the BODY (`verdict` +
       * `reason_code`), not in the status line. Clients must branch on
       * `verdict`, never on `res.ok`.
       */
      return reply.code(200).send(common);
    } catch (e) {
      const mapped = chainErrorResponse(e);

      // ---- transcript record 3 of 3 ----
      req.log[mapped.alert ? "error" : "warn"](
        jsonSafe({
          event: "intent.failed",
          request_id: requestId,
          intent_hash: intentHex,
          http_status: mapped.status,
          error: mapped.body.error,
          contract_error: mapped.contractError ?? null,
          /** Raw and unparsed. A reviewer must be able to see what the RPC said. */
          raw_error: mapped.raw,
          tx_hash: txHash ?? null,
          timings_ms: timings,
        }),
        "intent failed before a decision was recorded",
      );

      await store.recordFailure({
        requestId,
        intentHash: intentHex,
        contractError: mapped.contractError,
        httpStatus: mapped.status,
        rawError: mapped.raw,
        context: { agent_id: body.agent_id, service_id: body.service_id, asset: body.asset },
      });

      return reply.code(mapped.status).send({ ...mapped.body, intent_hash: intentHex });
    }
  });

  // -------------------------------------------------------------- decisions

  app.get("/v1/decisions/:id", async (req, reply) => {
    const params = DecisionIdParam.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_decision_id", detail: params.error.issues });
    }
    try {
      const d = await chain.getDecision(params.data.id);
      const intent = await store.intentByHash(d.intentHash);
      return reply.code(200).send(decisionBody(d, preimageBlock(intent, store)));
    } catch (e) {
      return sendChainError(reply, req, e);
    }
  });

  /**
   * The recompute endpoint. §6.1 D2 asks a reviewer to derive `intent_hash` from
   * a submitted intent; this hands back the preimage the chain does not hold
   * alongside the decision the chain does.
   */
  app.get("/v1/intents/:intent_hash", async (req, reply) => {
    const params = IntentHashParam.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_intent_hash", detail: params.error.issues });
    }
    const intent = await store.intentByHash(params.data.intent_hash);
    try {
      const d = await chain.decisionByIntent(params.data.intent_hash);
      return reply.code(200).send(decisionBody(d, preimageBlock(intent, store)));
    } catch (e) {
      return sendChainError(reply, req, e);
    }
  });

  /**
   * `resolve(decision_id, approve)` — owner-only ON CHAIN via `require_owner`,
   * so the operator key cannot stand in for it however this gateway is
   * configured. The endpoint carries no authorization of its own; the contract
   * is the gate, and a missing OWNER_SECRET fails as a 502 rather than a silent
   * escalation of the operator key.
   */
  app.post("/v1/decisions/:id/resolve", async (req, reply) => {
    const t0 = nowMs();
    const params = DecisionIdParam.safeParse(req.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_decision_id", detail: params.error.issues });
    }
    const parsed = ResolveRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_resolve", detail: parsed.error.issues });
    }

    const timings: Timings = { verdict_ms: undefined, finality_ms: undefined };
    let txHash: string | undefined;

    try {
      const result = await chain.resolve(params.data.id, parsed.data.approve, {
        onVerdict: () => {
          timings.verdict_ms = elapsed(t0);
        },
        onSubmitted: (hash) => {
          txHash = hash;
          req.log.info(
            { event: "chain.submitted", request_id: req.id, decision_id: params.data.id, tx_hash: hash },
            "resolve submitted, awaiting ledger close",
          );
        },
        onFinality: () => {
          timings.finality_ms = elapsed(t0);
        },
      });

      const d = result.decision;
      await store.recordDecision({
        intentHash: d.intentHash,
        decisionId: d.decisionId,
        verdict: d.verdict,
        reasonCode: d.reasonCode,
        originalReasonCode: d.originalReasonCode,
        policyVersion: d.policyVersion,
        resolved: d.resolved,
        settled: d.settled,
        ledgerSeq: result.ledgerSeq ?? d.ledgerSeq,
        txHash,
        verdictMs: timings.verdict_ms,
        finalityMs: timings.finality_ms,
      });

      req.log.info(
        jsonSafe({
          event: "decision.recorded",
          request_id: req.id,
          source: "resolve",
          approve: parsed.data.approve,
          note: parsed.data.note ?? null,
          decision_id: d.decisionId,
          intent_hash: d.intentHash,
          verdict: verdictName(d.verdict),
          verdict_code: d.verdict,
          reason_code: reasonName(d.reasonCode),
          reason_code_number: d.reasonCode,
          // Still `PendingApproval` after an approval — DECISIONS.md #8. The
          // escalation stays visible in the evidence trail.
          original_reason_code: reasonName(d.originalReasonCode),
          original_reason_code_number: d.originalReasonCode,
          policy_version: d.policyVersion,
          resolved_policy_version: d.resolvedPolicyVersion ?? null,
          tx_hash: txHash ?? null,
          timings_ms: timings,
        }),
        "decision resolved",
      );

      return reply.code(200).send(
        decisionBody(d, {
          tx_hash: txHash ?? null,
          timings_ms: timings,
          /**
           * Two versions, two meanings (DECISIONS.md #9). `policy_version` is the
           * version that PRODUCED the decision and is frozen into `decision_id`;
           * `resolved_policy_version` is the version the re-judgement actually
           * ran under. They are labelled apart on purpose.
           */
          policy_version_note:
            "policy_version produced this decision; resolved_policy_version is what resolve() re-judged against",
        }),
      );
    } catch (e) {
      const mapped = chainErrorResponse(e);
      req.log[mapped.alert ? "error" : "warn"](
        jsonSafe({
          event: "intent.failed",
          request_id: req.id,
          source: "resolve",
          decision_id: params.data.id,
          http_status: mapped.status,
          error: mapped.body.error,
          contract_error: mapped.contractError ?? null,
          raw_error: mapped.raw,
          tx_hash: txHash ?? null,
        }),
        "resolve failed",
      );
      return reply.code(mapped.status).send(mapped.body);
    }
  });

  // -------------------------------------------------------------- approvals

  /**
   * The pending-approval queue.
   *
   * Pending-ness is derived FROM THE CHAIN, never from a database column. The
   * store supplies candidates — which decisions were ever escalated — and every
   * one of them is then re-read with `get_decision` and kept only while the
   * contract itself still reports `RequiresApproval` and `resolved == false`.
   *
   * A `pending` boolean here would go stale the instant the owner resolved a
   * decision through any other path: the console, the CLI, a second gateway
   * instance. The console is required to read the chain directly (§6.3), so a
   * queue that disagreed with it would be a visible contradiction in the
   * evidence pack.
   */
  app.get("/v1/approvals", async (req, reply) => {
    const query = ApprovalsQuery.safeParse(req.query);
    if (!query.success) {
      return reply.code(400).send({ error: "invalid_query", detail: query.error.issues });
    }

    const candidates = await store.approvalCandidates(query.data.limit);
    const pending: Record<string, unknown>[] = [];
    const unreadable: Record<string, unknown>[] = [];

    for (const c of candidates) {
      try {
        const d = await chain.getDecision(c.decisionId);
        if (d.verdict !== Verdict.RequiresApproval || d.resolved) continue;
        pending.push(
          decisionBody(d, {
            agent_id: c.agentId ?? null,
            purpose: c.purpose ?? null,
            client_ref: c.clientRef ?? null,
            escalated_at: c.escalatedAt.toISOString(),
            escalation: {
              // Verbatim, as required by §4.1 D2.
              rule: c.rule,
              threshold: formatAmount(c.thresholdSnapshot),
              threshold_stroops: c.thresholdSnapshot.toString(),
              policy_version: c.policyVersionSnapshot,
              snapshot:
                "threshold captured at escalation time; set_policy cannot silently change what this entry means",
            },
            resolve_url: `/v1/decisions/${d.decisionId}/resolve`,
          }),
        );
      } catch (e) {
        // One unreadable decision must not blank the whole queue.
        unreadable.push({
          decision_id: c.decisionId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return reply.code(200).send({
      pending_count: pending.length,
      pending,
      unreadable,
      source: "chain",
      candidate_index: store.mode,
      /** Honest about the blind spot when there is no database. */
      candidate_index_note:
        store.mode === "degraded"
          ? "no database: candidates are only the escalations this process handled; restarts lose the index (the decisions themselves remain on chain)"
          : "candidates come from the approval_queue index; every row was re-read from the chain before being listed",
    });
  });
}

/** Attach the fields the chain does not carry, and say where they came from. */
function preimageBlock(
  intent: Awaited<ReturnType<IntentStore["intentByHash"]>>,
  store: IntentStore,
): Record<string, unknown> {
  if (!intent) {
    return {
      preimage: null,
      preimage_note:
        store.mode === "degraded"
          ? "purpose/client_ref are hashed into intent_hash but not stored on-chain, and this gateway is running without a database — recover them from the intent.received transcript record"
          : "no stored intent for this hash; the decision above is still authoritative",
    };
  }
  return {
    preimage: {
      agent_id: intent.agentId,
      service_id: intent.serviceId,
      asset: intent.asset,
      amount: formatAmount(intent.amount),
      amount_stroops: intent.amount.toString(),
      purpose: intent.purpose,
      client_ref: intent.clientRef,
      canonical_hex: intent.canonicalPreimage,
    },
    preimage_note:
      "sha256 of canonical_hex is intent_hash; purpose and client_ref are hashed into it but never stored on-chain",
  };
}

/**
 * Render the §4.1 D2 escalation rule and snapshot what it was rendered from.
 *
 * The contract escalates on `amount > policy.approval_threshold` (one line in
 * `evaluate`), so the rule string states exactly that comparison with the two
 * values that produced it.
 */
async function snapshotEscalation(
  svc: Services,
  d: ChainDecision,
  req: FastifyRequest,
): Promise<Record<string, unknown>> {
  try {
    const policy = await svc.chain.getPolicy(d.agent);
    if (policy.version !== d.policyVersion) {
      // Possible: `set_policy` may run while decisions sit unresolved, and the
      // contract deliberately allows it (DECISIONS.md #9). Say so rather than
      // presenting a threshold from one version as the rule of another.
      req.log.warn(
        {
          event: "escalation.version_skew",
          decision_id: d.decisionId,
          decision_policy_version: d.policyVersion,
          current_policy_version: policy.version,
        },
        "policy moved between authorize and the threshold read",
      );
    }
    const rule = `amount ${formatAmount(d.amount)} > threshold ${formatAmount(policy.approvalThreshold)}`;

    await svc.store.enqueueApproval({
      decisionId: d.decisionId,
      intentHash: d.intentHash,
      rule,
      thresholdSnapshot: policy.approvalThreshold,
      amount: d.amount,
      policyVersionSnapshot: policy.version,
    });

    return {
      rule,
      threshold: formatAmount(policy.approvalThreshold),
      threshold_stroops: policy.approvalThreshold.toString(),
      policy_version: policy.version,
      decision_policy_version: d.policyVersion,
      resolve_url: `/v1/decisions/${d.decisionId}/resolve`,
    };
  } catch (e) {
    // The decision is on chain and the 202 is correct regardless. Only the
    // human-readable rule is missing, and saying so beats inventing a threshold.
    req.log.warn(
      { event: "escalation.snapshot_failed", decision_id: d.decisionId, err: String(e) },
      "could not read the policy to render the escalation rule",
    );
    return {
      rule: null,
      rule_unavailable: e instanceof Error ? e.message : String(e),
      decision_policy_version: d.policyVersion,
      resolve_url: `/v1/decisions/${d.decisionId}/resolve`,
    };
  }
}

function sendChainError(reply: FastifyReply, req: FastifyRequest, e: unknown): FastifyReply {
  const mapped = chainErrorResponse(e);
  req.log[mapped.alert ? "error" : "warn"](
    { event: "chain.read_failed", request_id: req.id, raw_error: mapped.raw },
    "chain read failed",
  );
  return reply.code(mapped.status).send(mapped.body);
}

export async function buildServer(config: GatewayConfig): Promise<FastifyInstance> {
  const app = Fastify({
    // `request_id` ties the three transcript records of one submission together.
    // Every transcript record carries `request_id` as a field of its own, set
    // explicitly, so the deprecated `requestIdLogLabel` option is not needed to
    // rename fastify's automatic `reqId`.
    genReqId: () => randomUUID(),
    logger: {
      level: config.logLevel,
      // every intent that passes through here becomes a transcript for the reviewer
      redact: { paths: [], remove: false },
    },
  });

  // Before any route: the console is served from a different origin than this
  // API, and a preflight has to be answered by the plugin rather than by a
  // route. Skipped entirely when `CORS_ORIGIN` is unset, which leaves the
  // gateway same-origin-only (see cors.ts).
  if (config.corsOrigins.length > 0) {
    await app.register(cors, corsOptions(config.corsOrigins));
  }

  const registry = Registry.load(config.registryPath, config.servicesPath, config.contractId);
  const agentSigner = new InProcessAgentSigner(config.agentSecrets, config.networkPassphrase);

  if (agentSigner.addresses.length === 0) {
    app.log.warn(
      "AGENT_SECRETS is empty — authorize() needs the agent's own signature (DECISIONS.md #10) and every submission will fail",
    );
  }
  for (const a of registry.agentList) {
    if (a.active && !agentSigner.canSign(a.address)) {
      app.log.warn(
        { agent_id: a.agentId, address: a.address },
        "registry agent has no key in AGENT_SECRETS — its intents cannot be authorized",
      );
    }
  }

  const chain = new AegisChain({
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    contractId: config.contractId,
    caller: config.caller,
    owner: config.owner,
    agentSigner,
    txTimeoutSeconds: config.txTimeoutSeconds,
  });

  // Must not throw: the chain path has to work with no database.
  const store = await openStore(config.databaseUrl, app.log);

  app.log.info(
    {
      contract_id: config.contractId,
      caller: chain.callerAddress,
      caller_role: config.callerRole,
      owner_configured: chain.ownerAddress !== undefined,
      agent_signer: agentSigner.kind,
      agents: agentSigner.addresses.length,
      registry_version: registry.registryVersion,
      database: store.mode,
      // A console that cannot reach this API looks identical to a console
      // pointed at the wrong URL, so the allowlist is stated at boot.
      cors: config.corsOrigins.length > 0 ? config.corsOrigins.join(",") : "disabled",
    },
    "gateway ready",
  );

  registerRoutes(app, { config, registry, chain, store });
  app.addHook("onClose", async () => {
    await store.close();
  });
  return app;
}

async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig();
  const app = await buildServer(config);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
