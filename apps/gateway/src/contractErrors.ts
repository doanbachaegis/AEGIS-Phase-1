import { Errors, ReasonCode, Verdict } from "@aegis/bindings";

/**
 * Contract `Error` -> HTTP, and the enum-name/number pairs the transcript needs.
 *
 * `Error` and `ReasonCode` are different things and the mapping keeps them apart.
 * A `ReasonCode` is a **governance verdict** that the contract RECORDED on chain;
 * an `Error` is an execution failure that produced no decision at all. Only the
 * second kind belongs in this table.
 */

/** `Error(Contract, #N)` is how a soroban `#[contracterror]` reaches the SDK. */
const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/;

export type ContractErrorName = (typeof Errors)[keyof typeof Errors]["message"];

export interface ContractFailure {
  code: number;
  name: string;
  /** The unparsed simulation text. Logged verbatim — §6.1 D2 wants the raw error. */
  raw: string;
}

export function asContractFailure(err: unknown): ContractFailure | undefined {
  const raw = err instanceof Error ? err.message : String(err);
  const match = CONTRACT_ERROR.exec(raw);
  if (!match?.[1]) return undefined;
  const code = Number(match[1]);
  const entry = (Errors as Record<number, { message: string } | undefined>)[code];
  return { code, name: entry?.message ?? `UnknownContractError(${code})`, raw };
}

export interface HttpMapping {
  status: number;
  /** Stable machine-readable key for the response body. */
  error: string;
  /**
   * True when the failure means AEGIS is misconfigured rather than the caller
   * being wrong — logged at `error` level and surfaced as a 5xx.
   */
  alert: boolean;
  detail: string;
}

/**
 * The judgement calls, stated rather than buried:
 *
 * - `NotAuthorizedCaller` / `NotOwner` mean **our own** key is not the one the
 *   contract accepts. The client did nothing wrong and cannot fix it, so a 4xx
 *   would be a lie that also hides an operational failure. 500 + alert.
 * - `NotInitialized` is the same class of problem: the gateway is pointed at a
 *   contract that was never `init`'d.
 * - `AgentNotRegistered` is a real client error, but a semantic one — the request
 *   was well-formed and the registry resolved it, the chain simply holds no
 *   policy for that agent. 422, not 400.
 * - The state-machine errors (`NotPendingApproval`, `AlreadyResolved`,
 *   `AlreadySettled`, `NotApproved`, `AgentRevoked`) are conflicts with the
 *   current on-chain state: 409.
 * - `InvalidAmount` should be unreachable — `IntentRequest` rejects non-positive
 *   amounts before the hasher sees them. If it ever fires it is still a caller
 *   error: 400.
 */
const MAPPING: Record<string, { status: number; error: string; alert: boolean }> = {
  NotInitialized: { status: 500, error: "contract_not_initialized", alert: true },
  AlreadyInitialized: { status: 500, error: "contract_already_initialized", alert: true },
  NotOwner: { status: 500, error: "gateway_not_owner", alert: true },
  NotAuthorizedCaller: { status: 500, error: "gateway_not_authorized_caller", alert: true },
  AgentNotRegistered: { status: 422, error: "agent_not_registered", alert: false },
  DecisionNotFound: { status: 404, error: "decision_not_found", alert: false },
  NotPendingApproval: { status: 409, error: "not_pending_approval", alert: false },
  AlreadyResolved: { status: 409, error: "already_resolved", alert: false },
  AlreadySettled: { status: 409, error: "already_settled", alert: false },
  NotApproved: { status: 409, error: "not_approved", alert: false },
  InvalidAmount: { status: 400, error: "invalid_amount", alert: false },
  AgentRevoked: { status: 409, error: "agent_revoked", alert: false },
};

export function httpForContractFailure(failure: ContractFailure): HttpMapping {
  const m = MAPPING[failure.name];
  if (!m) {
    // An error the ABI grew after this table was written. Fail loud, not silent.
    return {
      status: 500,
      error: "unmapped_contract_error",
      alert: true,
      detail: `${failure.name} (#${failure.code})`,
    };
  }
  return { ...m, detail: `${failure.name} (#${failure.code})` };
}

export const verdictName = (v: Verdict): string => Verdict[v] ?? `Unknown(${String(v)})`;
export const reasonName = (r: ReasonCode): string => ReasonCode[r] ?? `Unknown(${String(r)})`;
