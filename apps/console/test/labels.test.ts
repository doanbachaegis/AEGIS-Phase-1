import { describe, expect, it } from "vitest";
import { AgentStatus, ReasonCode, Verdict } from "@aegis/bindings";
import {
  AGENT_STATUS_LABEL,
  REASON_LABEL,
  REASON_NAME,
  REASON_SCENARIO,
  VERDICT_LABEL,
  VERDICT_NAME,
  VERDICT_TONE,
} from "../src/labels.js";

/**
 * The `satisfies Record<Enum, …>` annotations already make a missing label a COMPILE
 * error. These tests cover what the type system cannot see: that no label is empty, and
 * that `REASON_NAME` still matches the identifiers in the contract source — a reviewer
 * greps for those strings.
 */
function numericMembers(e: Record<string, unknown>): number[] {
  return Object.values(e).filter((v): v is number => typeof v === "number");
}

describe("enum label maps", () => {
  it("labels every Verdict the ABI defines", () => {
    for (const v of numericMembers(Verdict)) {
      expect(VERDICT_LABEL[v as Verdict]).toBeTruthy();
      expect(VERDICT_NAME[v as Verdict]).toBeTruthy();
      expect(VERDICT_TONE[v as Verdict]).toBeTruthy();
    }
  });

  it("labels every ReasonCode the ABI defines", () => {
    for (const r of numericMembers(ReasonCode)) {
      expect(REASON_LABEL[r as ReasonCode]).toBeTruthy();
      expect(REASON_NAME[r as ReasonCode]).toBeTruthy();
      expect(REASON_SCENARIO[r as ReasonCode]).toBeTruthy();
    }
  });

  it("labels every AgentStatus the ABI defines", () => {
    for (const s of numericMembers(AgentStatus)) {
      expect(AGENT_STATUS_LABEL[s as AgentStatus]).toBeTruthy();
    }
  });

  it("reproduces the contract's own identifiers", () => {
    expect(REASON_NAME[ReasonCode.WindowCapExceeded]).toBe("WindowCapExceeded");
    expect(REASON_NAME[ReasonCode.PendingApproval]).toBe("PendingApproval");
    expect(REASON_NAME[ReasonCode.OwnerRejected]).toBe("OwnerRejected");
    expect(VERDICT_NAME[Verdict.RequiresApproval]).toBe("RequiresApproval");
  });

  it("gives a refusal its own tone rather than folding it into 'not approved'", () => {
    expect(VERDICT_TONE[Verdict.Rejected]).toBe("refused");
    expect(VERDICT_TONE[Verdict.RequiresApproval]).toBe("pending");
    expect(VERDICT_TONE[Verdict.Approved]).toBe("approved");
  });
});
