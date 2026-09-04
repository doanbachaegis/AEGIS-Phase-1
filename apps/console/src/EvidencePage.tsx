import { useQuery } from "@tanstack/react-query";
import { formatAmount } from "@aegis/canonical/amount";
import { Verdict } from "@aegis/bindings";
import {
  ChainTransportError,
  fetchEvidence,
  normalizeRef,
  stellarExpert,
} from "./chain.js";
import type { ChainDecision, CurrentPolicy, CurrentWindow, Evidence } from "./chain.js";
import { fetchIntentDisplay } from "./aegisApi.js";
import type { AegisApiLookup } from "./aegisApi.js";
import { env } from "./env.js";
import {
  AGENT_STATUS_LABEL,
  REASON_LABEL,
  REASON_NAME,
  REASON_SCENARIO,
  VERDICT_LABEL,
  VERDICT_NAME,
  VERDICT_TONE,
} from "./labels.js";
import {
  assetLabel,
  escalation,
  explainOriginalRule,
  explainRule,
  policyVersionCaveats,
} from "./derive.js";
import type { RuleExplanation } from "./derive.js";
import { AppLink, Callout, Card, ExtLink, Field, Hex, SourceTag } from "./ui.js";
import { decisionHref, intentHref } from "./router.js";

export function EvidencePage({
  reference,
  prefer,
}: {
  reference: string;
  prefer: "intent" | "decision";
}) {
  const ref = normalizeRef(reference);

  const evidence = useQuery({
    queryKey: ["evidence", ref, prefer],
    enabled: ref !== null,
    queryFn: () => fetchEvidence(ref!, prefer),
    // `settled` is the one field on a Decision that can change after it is written —
    // the executor flips it via mark_settled. Everything else is immutable, so a short
    // staleness window is enough and there is nothing to poll for.
    staleTime: 15_000,
    // Only transport failures are worth retrying. "DecisionNotFound" arrives as a VALUE
    // (see chain.ts), so it never reaches this callback.
    retry: (failureCount, error) => error instanceof ChainTransportError && failureCount < 2,
  });

  const found = evidence.data?.lookup.status === "found" ? evidence.data.lookup.decision : null;

  const supplementary = useQuery({
    queryKey: ["aegis-api", found?.intentHash],
    enabled: found !== null,
    queryFn: () => fetchIntentDisplay(found!.intentHash),
    staleTime: 60_000,
    retry: false,
  });

  if (ref === null) {
    return (
      <Shell reference={reference}>
        <Card title="That is not a valid reference">
          <p className="text-sm text-slate-700">
            An AEGIS reference is 32 bytes of hex — 64 characters, with an optional{" "}
            <code className="font-mono">0x</code> prefix. Both{" "}
            <code className="font-mono">intent_hash</code> and{" "}
            <code className="font-mono">decision_id</code> have that shape.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Received {reference.length} character{reference.length === 1 ? "" : "s"}.
          </p>
          <p className="mt-4 text-sm">
            <AppLink href="/">Back to the lookup form</AppLink>
          </p>
        </Card>
      </Shell>
    );
  }

  if (evidence.isPending) {
    return (
      <Shell reference={ref}>
        <Card title="Reading the contract…">
          <p className="text-sm text-slate-700">
            Simulating <code className="font-mono">decision_by_intent</code> against{" "}
            <code className="font-mono break-all">{env.rpcUrl}</code>. No transaction is
            submitted and no key is used.
          </p>
        </Card>
      </Shell>
    );
  }

  if (evidence.isError) {
    return (
      <Shell reference={ref}>
        <Card
          title="Could not reach the chain"
          subtitle="This is a transport failure, not a statement about the decision. Nothing below should be read as evidence that the decision does or does not exist."
        >
          <pre className="overflow-x-auto rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            {evidence.error instanceof Error ? evidence.error.message : String(evidence.error)}
          </pre>
          <button
            type="button"
            className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm text-white"
            onClick={() => void evidence.refetch()}
          >
            Try again
          </button>
        </Card>
      </Shell>
    );
  }

  const data = evidence.data;

  if (data.lookup.status !== "found") {
    return (
      <Shell reference={ref} latestLedger={data.latestLedger}>
        <Card
          title={
            data.lookup.status === "archived"
              ? "This decision has been archived"
              : "No decision is stored under this reference"
          }
        >
          <p className="text-sm text-slate-700">{data.lookup.reason}</p>
          <p className="mt-3 text-sm text-slate-700">
            Both <code className="font-mono">decision_by_intent</code> and{" "}
            <code className="font-mono">get_decision</code> were tried against contract{" "}
            <ExtLink href={stellarExpert.contract(env.contractId)}>{env.contractId}</ExtLink>.
            A different contract instance may hold it — the authoritative address is{" "}
            <code className="font-mono">CONTRACT_ID</code> in the deployment environment.
          </p>
          <p className="mt-4 text-sm">
            <AppLink href="/">Look up a different reference</AppLink>
          </p>
        </Card>
      </Shell>
    );
  }

  const decision = data.lookup.decision;

  return (
    <Shell
      reference={ref}
      latestLedger={data.latestLedger}
      onRefresh={() => void evidence.refetch()}
      refreshing={evidence.isFetching}
    >
      <VerdictBanner decision={decision} />
      <RuleCard decision={decision} policy={data.policy} window={data.window} />
      <EscalationCard decision={decision} />
      <DecisionIdentityCard decision={decision} via={data.lookup.via} />
      <MoneyCard decision={decision} />
      <SettlementCard evidence={data} decision={decision} supplementary={supplementary.data} />
      <PolicyCard decision={decision} policy={data.policy} window={data.window} />
      <SupplementaryCard lookup={supplementary.data} isPending={supplementary.isPending} />
      <ReproduceCard decision={decision} />
    </Shell>
  );
}

function Shell({
  reference,
  latestLedger,
  onRefresh,
  refreshing,
  children,
}: {
  reference: string;
  latestLedger?: number | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Evidence for reference</p>
          <p className="mt-1">
            <Hex value={reference} />
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {latestLedger !== undefined && latestLedger !== null && (
            <span className="text-slate-500">
              read at ledger <span className="font-mono">{latestLedger}</span>
            </span>
          )}
          {onRefresh !== undefined && (
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
              onClick={onRefresh}
            >
              {refreshing === true ? "re-reading…" : "re-read from chain"}
            </button>
          )}
          <AppLink href="/">New lookup</AppLink>
        </div>
      </div>
      {children}
    </main>
  );
}

/**
 * All three verdicts get the same box, the same type scale and the same amount of space.
 * A refusal that was rendered as a muted footnote would contradict the thing the product
 * is selling: refusing correctly is the outcome, not a failure to approve.
 */
function VerdictBanner({ decision }: { decision: ChainDecision }) {
  const tone = VERDICT_TONE[decision.verdict];
  const palette = {
    approved: "border-emerald-300 bg-emerald-50 text-emerald-950",
    refused: "border-rose-300 bg-rose-50 text-rose-950",
    pending: "border-indigo-300 bg-indigo-50 text-indigo-950",
  }[tone];
  const chip = {
    approved: "bg-emerald-200 text-emerald-950",
    refused: "bg-rose-200 text-rose-950",
    pending: "bg-indigo-200 text-indigo-950",
  }[tone];
  const framing = {
    approved:
      "Approved on-chain before any funds moved. Settlement is gated on this decision existing.",
    refused:
      "Refused on-chain before any funds moved. This is a successful governance outcome, not an error — the reason code below is the product.",
    pending:
      "Held for a human approver. No settlement is possible until resolve() runs, and resolve() is owner-only and terminal.",
  }[tone];

  return (
    <section className={`rounded-lg border-2 p-6 ${palette}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{VERDICT_LABEL[decision.verdict]}</h1>
        <SourceTag chain />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className={`rounded px-2 py-1 font-mono text-sm font-semibold ${chip}`}>
          {REASON_NAME[decision.reasonCode]}
        </span>
        <span className="text-base font-medium">{REASON_LABEL[decision.reasonCode]}</span>
      </div>
      <p className="mt-3 max-w-2xl text-sm">{framing}</p>
      <p className="mt-1 text-xs opacity-80">
        verdict = <span className="font-mono">{VERDICT_NAME[decision.verdict]}</span> ·{" "}
        reason_code = <span className="font-mono">{REASON_NAME[decision.reasonCode]}</span> ·{" "}
        {REASON_SCENARIO[decision.reasonCode]}
      </p>
    </section>
  );
}

function RuleBody({ rule }: { rule: RuleExplanation }) {
  return (
    <>
      <pre className="overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">
        {rule.predicate}
      </pre>
      <p className="mt-3 text-sm text-slate-700">{rule.summary}</p>
      <dl className="mt-3">
        {rule.operands.map((op) => (
          <Field key={op.label} label={op.label} chain={!op.fromCurrentPolicy}>
            <span className="font-mono break-all">{op.value}</span>
            {op.fromCurrentPolicy && (
              <span className="ml-2 text-xs text-slate-500">(current policy — see caveat below)</span>
            )}
          </Field>
        ))}
      </dl>
    </>
  );
}

function RuleCard({
  decision,
  policy,
  window,
}: {
  decision: ChainDecision;
  policy: CurrentPolicy | null;
  window: CurrentWindow | null;
}) {
  const rule = explainRule(decision, policy, window);
  const original = explainOriginalRule(decision, policy, window);

  return (
    <Card
      title="The rule that decided the outcome"
      subtitle={
        <>
          The contract stores the <em>outcome</em> and the <em>reason code</em>, not the
          predicate. The predicate below is reconstructed from{" "}
          <code className="font-mono">reason_code</code> — which is on-chain — plus the
          agent's policy. Operand values tagged “display only” came from{" "}
          <code className="font-mono">get_policy</code>, which returns the policy in force{" "}
          <em>now</em>.
        </>
      }
    >
      <RuleBody rule={rule} />
      {original !== null && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">
            The rule that produced the <em>original</em> outcome
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            <code className="font-mono">original_reason_code</code> ={" "}
            <span className="font-mono">{REASON_NAME[decision.originalReasonCode]}</span>, written
            once at <code className="font-mono">authorize()</code> time and never rewritten. The
            final reason code above replaced it at <code className="font-mono">resolve()</code>{" "}
            time.
          </p>
          <div className="mt-3">
            <RuleBody rule={original} />
          </div>
        </div>
      )}
    </Card>
  );
}

function EscalationCard({ decision }: { decision: ChainDecision }) {
  const state = escalation(decision);

  return (
    <Card title="Human approval">
      <p className="text-base font-semibold text-slate-900">{state.headline}</p>
      <p className="mt-2 text-sm text-slate-700">{state.basis}</p>
      <dl className="mt-4">
        <Field label="resolved" chain>
          <span className="font-mono">{String(decision.resolved)}</span>
        </Field>
        <Field label="original_reason_code" chain>
          <span className="font-mono">{REASON_NAME[decision.originalReasonCode]}</span>{" "}
          <span className="text-slate-600">— {REASON_LABEL[decision.originalReasonCode]}</span>
        </Field>
        <Field label="reason_code" chain>
          <span className="font-mono">{REASON_NAME[decision.reasonCode]}</span>{" "}
          <span className="text-slate-600">— {REASON_LABEL[decision.reasonCode]}</span>
        </Field>
      </dl>
    </Card>
  );
}

function DecisionIdentityCard({
  decision,
  via,
}: {
  decision: ChainDecision;
  via: "intent" | "decision";
}) {
  return (
    <Card
      title="Decision identity"
      subtitle={
        <>
          Resolved via{" "}
          <code className="font-mono">
            {via === "intent" ? "decision_by_intent" : "get_decision"}
          </code>{" "}
          on contract{" "}
          <ExtLink href={stellarExpert.contract(env.contractId)}>{env.contractId}</ExtLink>.
        </>
      }
    >
      <dl>
        <Field label="decision_id" chain>
          <Hex value={decision.decisionId} />
          <div className="mt-1 text-xs text-slate-500">
            <AppLink href={decisionHref(decision.decisionId)}>permalink to this decision</AppLink>
          </div>
        </Field>
        <Field label="intent_hash" chain>
          <Hex value={decision.intentHash} />
          <div className="mt-1 text-xs text-slate-500">
            <AppLink href={intentHref(decision.intentHash)}>permalink to this intent</AppLink>
          </div>
        </Field>
        <Field label="agent" chain>
          <ExtLink href={stellarExpert.account(decision.agent)}>
            <span className="font-mono break-all">{decision.agent}</span>
          </ExtLink>
        </Field>
        <Field label="service_id" chain>
          <span className="font-mono">{decision.serviceId}</span>
        </Field>
        <Field label="ledger_seq" chain>
          <span className="font-mono">{decision.ledgerSeq}</span>
          <span className="ml-2 text-slate-600">— the ledger that recorded the decision</span>
        </Field>
        <Field label="policy_version" chain>
          <span className="font-mono">v{decision.policyVersion}</span>
          <span className="ml-2 text-slate-600">
            — frozen for life; bound into <code className="font-mono">decision_id</code> and{" "}
            <code className="font-mono">memo_hash</code>
          </span>
        </Field>
        <Field label="resolved_policy_version" chain>
          {decision.resolvedPolicyVersion === null ? (
            <span className="text-slate-600">
              <span className="font-mono">None</span> — this decision has never been resolved
            </span>
          ) : (
            <>
              <span className="font-mono">v{decision.resolvedPolicyVersion}</span>
              <span className="ml-2 text-slate-600">
                — the version <code className="font-mono">resolve()</code> re-judged against
              </span>
            </>
          )}
        </Field>
      </dl>
    </Card>
  );
}

function MoneyCard({ decision }: { decision: ChainDecision }) {
  const friendly = assetLabel(decision.asset, env.usdcSacAddress);
  return (
    <Card
      title="Amount and asset"
      subtitle={
        decision.verdict === Verdict.Approved
          ? "The amount this decision authorizes."
          : "The amount that was requested. It was never authorized — see the verdict above."
      }
    >
      <dl>
        <Field label="amount" chain>
          <span className="text-lg font-semibold">{formatAmount(decision.amount)}</span>
          {friendly !== null && <span className="ml-2 text-slate-600">{friendly}</span>}
          <div className="mt-1 text-xs text-slate-500">
            stored on-chain as <span className="font-mono">{decision.amount.toString()}</span>{" "}
            stroops (i128, 7 decimal places)
          </div>
        </Field>
        <Field label="asset" chain>
          <ExtLink href={stellarExpert.asset(decision.asset)}>
            <span className="font-mono break-all">{decision.asset}</span>
          </ExtLink>
          {friendly !== null && <span className="ml-2 text-slate-600">— {friendly}</span>}
        </Field>
      </dl>
    </Card>
  );
}

function SettlementCard({
  evidence,
  decision,
  supplementary,
}: {
  evidence: Evidence;
  decision: ChainDecision;
  supplementary: AegisApiLookup | undefined;
}) {
  const txHash =
    supplementary?.status === "found" ? supplementary.data.settlementTxHash : null;

  return (
    <Card
      title="Settlement"
      subtitle="The contract records THAT a decision was settled. It never records WHICH Stellar transaction did it — that binding is carried by the transaction's MEMO_HASH."
    >
      <dl>
        <Field label="settled" chain>
          <span className="font-mono">{String(decision.settled)}</span>
          <span className="ml-2 text-slate-600">
            {decision.settled
              ? "— mark_settled() has run; this decision cannot be settled a second time"
              : "— no settlement recorded against this decision yet"}
          </span>
        </Field>
        <Field label="memo_hash()" chain>
          {evidence.memoHash === null ? (
            <span className="text-slate-600">
              could not be read — the verdict above is unaffected
            </span>
          ) : (
            <>
              <Hex value={evidence.memoHash} />
              <div className="mt-1 text-xs text-slate-500">
                sha256(intent_hash ‖ policy_version_be ‖ decision_id), computed{" "}
                <strong>by the contract</strong>. The settle transaction must carry exactly this
                value as its MEMO_HASH.
              </div>
            </>
          )}
        </Field>
        <Field label="settlement transaction" chain={false}>
          {txHash === null ? (
            <span className="text-slate-600">
              not supplied by the AEGIS API. The on-chain evidence above is complete without it:{" "}
              <code className="font-mono">settled</code> and{" "}
              <code className="font-mono">memo_hash()</code> both come from the contract.
            </span>
          ) : (
            <>
              <ExtLink href={stellarExpert.tx(txHash)}>
                <span className="font-mono break-all">{txHash}</span>
              </ExtLink>
              <div className="mt-1 text-xs text-slate-500">
                Verify it yourself: the transaction's MEMO_HASH must equal the{" "}
                <code className="font-mono">memo_hash()</code> value above. If it does not, the
                transaction is not a settlement of this decision, whatever the API says.
              </div>
            </>
          )}
        </Field>
      </dl>
      {decision.settled && evidence.memoHash !== null && (
        <p className="mt-4 text-xs text-slate-500">
          ⚠️ Phase 1 trusts the executor key. The memo commitment makes a mismatched settlement{" "}
          <em>detectable</em>, not impossible — see <code className="font-mono">DECISIONS.md</code>{" "}
          #6.
        </p>
      )}
    </Card>
  );
}

function PolicyCard({
  decision,
  policy,
  window,
}: {
  decision: ChainDecision;
  policy: CurrentPolicy | null;
  window: CurrentWindow | null;
}) {
  const caveats = policyVersionCaveats(decision, policy);

  return (
    <Card
      title="Policy in force now"
      subtitle="Read live from get_policy. Shown for context — read the caveats before treating any number here as the rule that fired."
    >
      <div className="space-y-2">
        {caveats.map((c) => (
          <Callout key={c.message} level={c.level}>
            {c.message}
          </Callout>
        ))}
      </div>

      {policy !== null && (
        <dl className="mt-4">
          <Field label="version" chain>
            <span className="font-mono">v{policy.version}</span>
            {policy.version !== decision.policyVersion && (
              <span className="ml-2 text-amber-800">
                ≠ this decision's v{decision.policyVersion}
              </span>
            )}
          </Field>
          <Field label="status" chain>
            <span className="font-mono">{AGENT_STATUS_LABEL[policy.status]}</span>
          </Field>
          <Field label="owner" chain>
            <ExtLink href={stellarExpert.account(policy.owner)}>
              <span className="font-mono break-all">{policy.owner}</span>
            </ExtLink>
          </Field>
          <Field label="approval_threshold" chain>
            <span className="font-mono">{formatAmount(policy.approvalThreshold)}</span>
            <span className="ml-2 text-slate-600">
              — above this, the contract escalates instead of approving
            </span>
          </Field>
          <Field label="per_intent_cap" chain>
            <span className="font-mono">{formatAmount(policy.perIntentCap)}</span>
          </Field>
          <Field label="cumulative_window_cap" chain>
            <span className="font-mono">{formatAmount(policy.cumulativeWindowCap)}</span>
            <span className="ml-2 text-slate-600">
              per {policy.windowSeconds.toString()}s tumbling window
            </span>
          </Field>
          <Field label="allowed_asset" chain>
            <span className="font-mono break-all">{policy.allowedAsset}</span>
          </Field>
          <Field label="allowed_services" chain>
            <span className="font-mono">{policy.allowedServices.join(", ") || "(none)"}</span>
          </Field>
          {window !== null && (
            <Field label="window spent (now)" chain>
              <span className="font-mono">{formatAmount(window.spent)}</span>
              <span className="ml-2 text-slate-600">
                — effective value, tumbling reset already applied
              </span>
            </Field>
          )}
        </dl>
      )}
    </Card>
  );
}

function SupplementaryCard({
  lookup,
  isPending,
}: {
  lookup: AegisApiLookup | undefined;
  isPending: boolean;
}) {
  return (
    <Card
      title="Supplementary — from the AEGIS database"
      subtitle={
        <>
          <code className="font-mono">purpose</code> and{" "}
          <code className="font-mono">client_ref</code> enter{" "}
          <code className="font-mono">intent_hash</code> as bytes and are not stored on-chain, so
          they can only come from the AEGIS API. They prove nothing on their own and are tagged
          accordingly. Everything above this line is readable without them.
        </>
      }
    >
      {isPending && <p className="text-sm text-slate-600">Loading…</p>}
      {lookup?.status === "disabled" && (
        <p className="text-sm text-slate-600">
          No AEGIS API is configured for this deployment (
          <code className="font-mono">VITE_AEGIS_API_URL</code> is unset). The on-chain evidence
          above is unaffected.
        </p>
      )}
      {lookup?.status === "absent" && (
        <p className="text-sm text-slate-600">
          The AEGIS API has no record of this intent. That says nothing about the decision above,
          which was read from the contract.
        </p>
      )}
      {lookup?.status === "error" && (
        <p className="text-sm text-slate-600">
          The AEGIS API could not be reached ({lookup.message}). The on-chain evidence above is
          unaffected — which is the point of §6.3.
        </p>
      )}
      {lookup?.status === "found" && (
        <dl>
          <Field label="purpose" chain={false}>
            {lookup.data.purpose ?? <span className="text-slate-500">(not supplied)</span>}
          </Field>
          <Field label="client_ref" chain={false}>
            {lookup.data.clientRef ?? <span className="text-slate-500">(not supplied)</span>}
          </Field>
        </dl>
      )}
    </Card>
  );
}

function ReproduceCard({ decision }: { decision: ChainDecision }) {
  const cli = [
    `stellar contract invoke --id ${env.contractId} \\`,
    `  --network testnet --source-account <any funded G...> --send=no \\`,
    `  -- decision_by_intent --intent_hash ${decision.intentHash}`,
    ``,
    `stellar contract invoke --id ${env.contractId} \\`,
    `  --network testnet --source-account <any funded G...> --send=no \\`,
    `  -- memo_hash --decision_id ${decision.decisionId}`,
  ].join("\n");

  return (
    <Card
      title="Reproduce this without the console"
      subtitle="§6.3 requires the decision to be readable by contract ID, independently of the AEGIS database. This page holds no key and submits no transaction; every value above came from a read-only simulation you can run yourself."
    >
      <pre className="overflow-x-auto rounded bg-slate-900 p-3 font-mono text-xs text-slate-100">
        {cli}
      </pre>
      <p className="mt-3 text-xs text-slate-500">
        Network passphrase: <code className="font-mono">{env.networkPassphrase}</code> · RPC:{" "}
        <code className="font-mono break-all">{env.rpcUrl}</code>
      </p>
    </Card>
  );
}
