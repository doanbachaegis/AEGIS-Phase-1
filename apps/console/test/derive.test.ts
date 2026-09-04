import { describe, expect, it } from "vitest";
import { ReasonCode, Verdict, AgentStatus } from "@aegis/bindings";
import type { ChainDecision, CurrentPolicy, CurrentWindow } from "../src/chain.js";
import {
  escalation,
  explainOriginalRule,
  explainRule,
  policyVersionCaveats,
} from "../src/derive.js";

const DECISION: ChainDecision = {
  decisionId: "2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e",
  intentHash: "c51c74d5c445350d848e85fe3bb9cb1949fb73675893a09e654126bfb93b7a10",
  agent: "GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3",
  serviceId: "svc-demo",
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  amount: 125_000_000n,
  policyVersion: 1,
  resolvedPolicyVersion: null,
  verdict: Verdict.Approved,
  reasonCode: ReasonCode.Ok,
  originalReasonCode: ReasonCode.Ok,
  ledgerSeq: 4_493_376,
  resolved: false,
  settled: false,
};

const POLICY: CurrentPolicy = {
  agent: DECISION.agent,
  owner: "GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY",
  allowedAsset: DECISION.asset,
  allowedServices: ["svc-demo"],
  approvalThreshold: 500_000_000n,
  perIntentCap: 1_000_000_000n,
  cumulativeWindowCap: 5_000_000_000n,
  windowSeconds: 86_400n,
  status: AgentStatus.Active,
  version: 1,
};

const WINDOW: CurrentWindow = { spent: 125_000_000n, windowStart: 0n };

function withReason(reasonCode: ReasonCode, extra: Partial<ChainDecision> = {}): ChainDecision {
  return { ...DECISION, reasonCode, originalReasonCode: reasonCode, ...extra };
}

function numericMembers(e: Record<string, unknown>): number[] {
  return Object.values(e).filter((v): v is number => typeof v === "number");
}

describe("explainRule", () => {
  it("explains every reason code the ABI defines", () => {
    for (const code of numericMembers(ReasonCode)) {
      const rule = explainRule(withReason(code as ReasonCode), POLICY, WINDOW);
      expect(rule.predicate).toBeTruthy();
      expect(rule.summary).toBeTruthy();
      expect(rule.operands.length).toBeGreaterThan(0);
    }
  });

  it("names the escalation rule as amount > approval_threshold", () => {
    const rule = explainRule(withReason(ReasonCode.PendingApproval), POLICY, WINDOW);
    expect(rule.predicate).toContain("amount > approval_threshold");
  });

  it("marks policy-derived operands as coming from the CURRENT policy", () => {
    const rule = explainRule(withReason(ReasonCode.CapExceeded), POLICY, WINDOW);
    const amount = rule.operands.find((o) => o.label.startsWith("amount"));
    const cap = rule.operands.find((o) => o.label === "per_intent_cap");
    expect(amount?.fromCurrentPolicy).toBe(false);
    expect(cap?.fromCurrentPolicy).toBe(true);
  });

  it("stays renderable when get_policy could not be read", () => {
    const rule = explainRule(withReason(ReasonCode.CapExceeded), null, null);
    const cap = rule.operands.find((o) => o.label === "per_intent_cap");
    expect(cap?.value).toContain("unavailable");
  });

  it("formats money through formatAmount, never through Number", () => {
    const rule = explainRule(withReason(ReasonCode.CapExceeded), POLICY, WINDOW);
    expect(rule.operands.find((o) => o.label.startsWith("amount"))?.value).toBe("12.5");
    expect(rule.operands.find((o) => o.label === "per_intent_cap")?.value).toBe("100");
  });

  it("shows the original rule only when resolve() replaced the reason code", () => {
    expect(explainOriginalRule(DECISION, POLICY, WINDOW)).toBeNull();
    const resolved = withReason(ReasonCode.Ok, {
      originalReasonCode: ReasonCode.PendingApproval,
      resolved: true,
    });
    expect(explainOriginalRule(resolved, POLICY, WINDOW)?.predicate).toContain(
      "amount > approval_threshold",
    );
  });
});

describe("escalation", () => {
  it("reports no human in the loop for a straight policy decision", () => {
    expect(escalation(DECISION).state).toBe("none");
  });

  it("reports a pending escalation while the owner has not acted", () => {
    const pending = withReason(ReasonCode.PendingApproval, {
      verdict: Verdict.RequiresApproval,
      resolved: false,
    });
    expect(escalation(pending).state).toBe("pending");
  });

  it("derives escalation from resolved == true even when the final code reads Ok", () => {
    const approvedAfterEscalation = withReason(ReasonCode.Ok, {
      originalReasonCode: ReasonCode.PendingApproval,
      resolved: true,
      resolvedPolicyVersion: 1,
    });
    const e = escalation(approvedAfterEscalation);
    expect(e.state).toBe("resolved");
    expect(e.basis).toContain("NotPendingApproval");
    expect(e.basis).toContain("PendingApproval");
  });
});

describe("policyVersionCaveats", () => {
  it("says plainly when get_policy is unreadable", () => {
    const [first, ...rest] = policyVersionCaveats(DECISION, null);
    expect(first?.level).toBe("warn");
    expect(first?.message).toContain("get_policy could not be read");
    expect(rest).toHaveLength(0);
  });

  it("confirms the current policy is the one that fired when the versions match", () => {
    const caveats = policyVersionCaveats(DECISION, POLICY);
    expect(caveats[0]?.level).toBe("info");
    expect(caveats[0]?.message).toContain("still v1");
  });

  it("warns when the current policy is not the one that produced the decision", () => {
    const caveats = policyVersionCaveats(DECISION, { ...POLICY, version: 3 });
    expect(caveats[0]?.level).toBe("warn");
    expect(caveats[0]?.message).toContain("v3");
    expect(caveats[0]?.message).toContain("NOT the");
  });

  it("flags a re-judgement that ran under a different version", () => {
    const rejudged = { ...DECISION, resolved: true, resolvedPolicyVersion: 2 };
    const caveats = policyVersionCaveats(rejudged, { ...POLICY, version: 2 });
    expect(caveats).toHaveLength(2);
    expect(caveats[1]?.message).toContain("re-judged");
  });
});
