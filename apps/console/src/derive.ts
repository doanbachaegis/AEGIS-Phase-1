/**
 * Everything on this page that is not literally a field of `Decision` is DERIVED from
 * fields that are, and the derivation is stated next to the result. Nothing here
 * invents a fact the chain does not support.
 *
 * SOW §4.1 D4 asks for "the rule that decided the outcome". The contract stores the
 * outcome and the reason code, not the predicate — so the predicate is reconstructed
 * from `reason_code` plus the agent's policy, and the console says out loud that
 * `get_policy` returns TODAY's policy rather than the frozen one that fired.
 */

import { formatAmount } from "@aegis/canonical/amount";
import { AgentStatus, ReasonCode, Verdict } from "@aegis/bindings";
import type { ChainDecision, CurrentPolicy, CurrentWindow } from "./chain.js";
import { REASON_NAME } from "./labels.js";

export interface RuleOperand {
  label: string;
  value: string;
  /** True when the value was read from the CURRENT policy and may not be the one that fired. */
  fromCurrentPolicy: boolean;
}

export interface RuleExplanation {
  /** The predicate in the contract's own vocabulary. */
  predicate: string;
  /** What the contract checked, in one sentence. */
  summary: string;
  operands: readonly RuleOperand[];
}

interface RuleContext {
  decision: ChainDecision;
  policy: CurrentPolicy | null;
  window: CurrentWindow | null;
}

const UNREADABLE = "unavailable (get_policy could not be read)";

function chain(label: string, value: string): RuleOperand {
  return { label, value, fromCurrentPolicy: false };
}

function current(label: string, value: string | null): RuleOperand {
  return { label, value: value ?? UNREADABLE, fromCurrentPolicy: true };
}

function amountOperand(d: ChainDecision): RuleOperand {
  return chain("amount (this intent)", formatAmount(d.amount));
}

type RuleFn = (ctx: RuleContext) => RuleExplanation;

/**
 * `satisfies Record<ReasonCode, RuleFn>`: a regenerated ABI carrying a ninth reason
 * code becomes a compile error here, not a decision page that shows a verdict with no
 * explanation of why.
 */
const RULES = {
  [ReasonCode.Ok]: ({ decision, policy }) => ({
    predicate:
      "amount <= per_intent_cap && amount <= approval_threshold && " +
      "service_id ∈ allowed_services && asset == allowed_asset && " +
      "window_spent + amount <= cumulative_window_cap && status == Active",
    summary: "Every policy check passed, so the contract approved the intent outright.",
    operands: [
      amountOperand(decision),
      current("per_intent_cap", policy ? formatAmount(policy.perIntentCap) : null),
      current("approval_threshold", policy ? formatAmount(policy.approvalThreshold) : null),
      current("cumulative_window_cap", policy ? formatAmount(policy.cumulativeWindowCap) : null),
      chain("service_id", decision.serviceId),
      current("allowed_services", policy ? policy.allowedServices.join(", ") || "(none)" : null),
    ],
  }),

  [ReasonCode.CapExceeded]: ({ decision, policy }) => ({
    predicate: "amount > per_intent_cap",
    summary: "The intent asked for more than the policy allows in a single payment.",
    operands: [
      amountOperand(decision),
      current("per_intent_cap", policy ? formatAmount(policy.perIntentCap) : null),
    ],
  }),

  [ReasonCode.ServiceNotAllowed]: ({ decision, policy }) => ({
    predicate: "service_id ∉ allowed_services",
    summary: "The agent is not permitted to pay this service under its policy.",
    operands: [
      chain("service_id", decision.serviceId),
      current("allowed_services", policy ? policy.allowedServices.join(", ") || "(none)" : null),
    ],
  }),

  [ReasonCode.AssetMismatch]: ({ decision, policy }) => ({
    predicate: "asset != allowed_asset",
    summary: "The intent named an asset the policy does not permit.",
    operands: [
      chain("asset (this intent)", decision.asset),
      current("allowed_asset", policy?.allowedAsset ?? null),
    ],
  }),

  [ReasonCode.AgentRevoked]: ({ policy }) => ({
    predicate: "status == Revoked",
    summary: "The agent's registration had been revoked; revocation takes effect immediately.",
    operands: [
      current(
        "status",
        policy ? (policy.status === AgentStatus.Revoked ? "Revoked" : "Active") : null,
      ),
    ],
  }),

  [ReasonCode.WindowCapExceeded]: ({ decision, policy, window }) => ({
    predicate: "window_spent + amount > cumulative_window_cap",
    summary:
      "The intent fits on its own but would push the agent past its spend cap for the " +
      "current tumbling window.",
    operands: [
      amountOperand(decision),
      current("window_spent (now)", window ? formatAmount(window.spent) : null),
      current("cumulative_window_cap", policy ? formatAmount(policy.cumulativeWindowCap) : null),
      current("window_seconds", policy ? policy.windowSeconds.toString() : null),
    ],
  }),

  [ReasonCode.PendingApproval]: ({ decision, policy }) => ({
    predicate: "amount > approval_threshold  (and amount <= per_intent_cap)",
    summary:
      "Above the threshold at which a human must sign off, but still inside the hard cap — " +
      "so the contract escalated instead of refusing.",
    operands: [
      amountOperand(decision),
      current("approval_threshold", policy ? formatAmount(policy.approvalThreshold) : null),
      current("per_intent_cap", policy ? formatAmount(policy.perIntentCap) : null),
    ],
  }),

  [ReasonCode.OwnerRejected]: ({ decision }) => ({
    predicate: "resolve(decision_id, approve = false)",
    summary:
      "No policy rule refused this. The owner declined it by hand on the human-approver " +
      "path, which is owner-only and terminal.",
    operands: [
      amountOperand(decision),
      chain("original_reason_code", REASON_NAME[decision.originalReasonCode]),
    ],
  }),
} satisfies Record<ReasonCode, RuleFn>;

export function explainRule(
  decision: ChainDecision,
  policy: CurrentPolicy | null,
  window: CurrentWindow | null,
): RuleExplanation {
  return RULES[decision.reasonCode]({ decision, policy, window });
}

/**
 * The rule that produced the ORIGINAL outcome, which differs from the final one exactly
 * when the decision was escalated and then resolved.
 */
export function explainOriginalRule(
  decision: ChainDecision,
  policy: CurrentPolicy | null,
  window: CurrentWindow | null,
): RuleExplanation | null {
  if (decision.originalReasonCode === decision.reasonCode) return null;
  return RULES[decision.originalReasonCode]({ decision, policy, window });
}

export type EscalationState = "none" | "pending" | "resolved";

export interface Escalation {
  state: EscalationState;
  headline: string;
  /** Why the console is entitled to say this — the derivation, spelled out. */
  basis: string;
}

/**
 * `resolved == true` implies the decision was escalated: `evaluate()` reaches
 * `RequiresApproval` by exactly one path and always pairs it with `PendingApproval`,
 * and `resolve()` refuses any decision whose verdict is not `RequiresApproval`
 * (`NotPendingApproval`). Since DECISIONS.md #8 the contract also records
 * `original_reason_code` explicitly, so the claim rests on a stored field rather than
 * on a reader reasoning about the contract's control flow.
 */
export function escalation(d: ChainDecision): Escalation {
  if (d.resolved) {
    return {
      state: "resolved",
      headline: "Escalated to a human approver, then resolved",
      basis:
        `resolved = true, and resolve() accepts only a decision whose verdict is ` +
        `RequiresApproval — any other state fails with NotPendingApproval. The contract ` +
        `also kept original_reason_code = ${REASON_NAME[d.originalReasonCode]}, written once at ` +
        `authorize() time and never rewritten, so the approval could not erase the escalation.`,
    };
  }
  if (d.verdict === Verdict.RequiresApproval) {
    return {
      state: "pending",
      headline: "Escalated to a human approver, awaiting a decision",
      basis:
        `verdict = RequiresApproval and resolved = false. resolve() is owner-only and ` +
        `terminal; until it runs, no settlement can occur.`,
    };
  }
  return {
    state: "none",
    headline: "Decided by policy alone — no human in the loop",
    basis: `resolved = false and verdict = ${d.verdict === Verdict.Approved ? "Approved" : "Rejected"}.`,
  };
}

export type CaveatLevel = "info" | "warn";

export interface Caveat {
  level: CaveatLevel;
  message: string;
}

/**
 * The honest note demanded by DECISIONS.md #9: two policy versions can be in play for
 * one decision, and `get_policy` returns neither of them by definition — it returns
 * whatever is current right now.
 */
export function policyVersionCaveats(
  d: ChainDecision,
  policy: CurrentPolicy | null,
): readonly Caveat[] {
  const out: Caveat[] = [];

  if (policy === null) {
    out.push({
      level: "warn",
      message:
        "get_policy could not be read for this agent, so no threshold or cap is shown below. " +
        "The verdict and reason code above are unaffected: they are stored on the decision itself.",
    });
    return out;
  }

  if (policy.version === d.policyVersion) {
    out.push({
      level: "info",
      message:
        `get_policy returns the CURRENT policy, which is still v${policy.version} — the same ` +
        `version that produced this decision. The values below are therefore the ones that ` +
        `were actually applied.`,
    });
  } else {
    out.push({
      level: "warn",
      message:
        `get_policy returns the CURRENT policy, v${policy.version}. This decision was produced ` +
        `under v${d.policyVersion}, which is frozen into decision_id and memo_hash and cannot be ` +
        `re-read from the contract. The caps and thresholds below are today's values, NOT the ` +
        `ones that produced this decision — treat them as context, not as evidence.`,
    });
  }

  if (d.resolvedPolicyVersion !== null && d.resolvedPolicyVersion !== d.policyVersion) {
    out.push({
      level: "warn",
      message:
        `This decision was re-judged at resolve() time against v${d.resolvedPolicyVersion}, not ` +
        `the v${d.policyVersion} it was created under. resolve(approve = true) re-runs the full ` +
        `evaluation on purpose, so an escalation cannot be rubber-stamped after the owner ` +
        `tightened a cap.`,
    });
  }

  return out;
}

/** Friendly name for the asset SAC, alongside — never instead of — the raw address. */
export function assetLabel(sac: string, usdcSac: string | null): string | null {
  return usdcSac !== null && sac === usdcSac ? "USDC (testnet)" : null;
}
