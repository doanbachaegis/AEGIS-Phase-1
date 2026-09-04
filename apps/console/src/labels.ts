/**
 * Human labels for the contract's numeric enums.
 *
 * `Verdict` and `ReasonCode` arrive from the ABI as numbers. Every map here is
 * `satisfies Record<Enum, ...>`, so if `pnpm bindings` regenerates the ABI with a new
 * variant, this file stops compiling instead of quietly rendering a blank label — the
 * same reason `packages/bindings` is committed and CI checks it for drift.
 */

import { AgentStatus, ReasonCode, Verdict } from "@aegis/bindings";

export const VERDICT_LABEL = {
  [Verdict.Approved]: "Approved",
  [Verdict.Rejected]: "Rejected",
  [Verdict.RequiresApproval]: "Requires approval",
} satisfies Record<Verdict, string>;

/** The identifier as it is written in the contract source — what a reviewer greps for. */
export const VERDICT_NAME = {
  [Verdict.Approved]: "Approved",
  [Verdict.Rejected]: "Rejected",
  [Verdict.RequiresApproval]: "RequiresApproval",
} satisfies Record<Verdict, string>;

export const REASON_NAME = {
  [ReasonCode.Ok]: "Ok",
  [ReasonCode.CapExceeded]: "CapExceeded",
  [ReasonCode.ServiceNotAllowed]: "ServiceNotAllowed",
  [ReasonCode.AssetMismatch]: "AssetMismatch",
  [ReasonCode.AgentRevoked]: "AgentRevoked",
  [ReasonCode.WindowCapExceeded]: "WindowCapExceeded",
  [ReasonCode.PendingApproval]: "PendingApproval",
  [ReasonCode.OwnerRejected]: "OwnerRejected",
} satisfies Record<ReasonCode, string>;

export const REASON_LABEL = {
  [ReasonCode.Ok]: "Within policy",
  [ReasonCode.CapExceeded]: "Above the per-intent cap",
  [ReasonCode.ServiceNotAllowed]: "Service not on the whitelist",
  [ReasonCode.AssetMismatch]: "Asset differs from the policy asset",
  [ReasonCode.AgentRevoked]: "Agent has been revoked",
  [ReasonCode.WindowCapExceeded]: "Above the cumulative window cap",
  [ReasonCode.PendingApproval]: "Escalated to a human approver",
  [ReasonCode.OwnerRejected]: "Rejected by the owner",
} satisfies Record<ReasonCode, string>;

/** The SOW §5.2 scenario each code was written to cover. Empty where the SOW names none. */
export const REASON_SCENARIO = {
  [ReasonCode.Ok]: "SOW §5.2 scenario 1",
  [ReasonCode.CapExceeded]: "SOW §5.2 scenario 2",
  [ReasonCode.ServiceNotAllowed]: "SOW §5.2 scenario 3",
  [ReasonCode.AssetMismatch]: "SOW §5.2 scenario 4",
  [ReasonCode.AgentRevoked]: "SOW §5.2 scenario 6",
  [ReasonCode.WindowCapExceeded]: "adversarial: window boundary (DECISIONS.md #3)",
  [ReasonCode.PendingApproval]: "SOW §5.2 scenario 5",
  [ReasonCode.OwnerRejected]: "SOW §5.2 scenario 5, owner declines",
} satisfies Record<ReasonCode, string>;

export const AGENT_STATUS_LABEL = {
  [AgentStatus.Active]: "Active",
  [AgentStatus.Revoked]: "Revoked",
} satisfies Record<AgentStatus, string>;

/**
 * A refusal is a successful governance outcome, so it is rendered with the same weight
 * as an approval — only the hue differs. Muting rejections would undercut the entire
 * premise of the product (§4.1 D4: "rejected intents show their reason code; do not
 * hide them").
 */
export type VerdictTone = "approved" | "refused" | "pending";

export const VERDICT_TONE = {
  [Verdict.Approved]: "approved",
  [Verdict.Rejected]: "refused",
  [Verdict.RequiresApproval]: "pending",
} satisfies Record<Verdict, VerdictTone>;
