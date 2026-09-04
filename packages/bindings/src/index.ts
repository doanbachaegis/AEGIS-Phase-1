import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




/**
 * Execution errors (access control, state machine). Distinct from `ReasonCode` —
 * that one is a *policy verdict*, RECORDED on-chain rather than raised as a panic.
 */
export const Errors = {
  1: {message:"NotInitialized"},
  2: {message:"AlreadyInitialized"},
  3: {message:"NotOwner"},
  4: {message:"NotAuthorizedCaller"},
  5: {message:"AgentNotRegistered"},
  6: {message:"DecisionNotFound"},
  /**
   * resolve() called on a decision that is not in the RequiresApproval state
   */
  7: {message:"NotPendingApproval"},
  /**
   * resolve() is terminal — a second call fails
   */
  8: {message:"AlreadyResolved"},
  9: {message:"AlreadySettled"},
  10: {message:"NotApproved"},
  11: {message:"InvalidAmount"},
  /**
   * mark_settled() on a decision whose agent has been revoked since it was approved.
   * Revocation takes effect immediately (SOW §5.2 scenario 6).
   * Appended at the END so no existing discriminant shifts (§5.1 ABI freeze).
   */
  12: {message:"AgentRevoked"}
}


export interface Policy {
  agent: string;
  /**
 * SAC address of the asset (Phase 1: testnet USDC)
 */
allowed_asset: string;
  allowed_services: Array<string>;
  approval_threshold: i128;
  cumulative_window_cap: i128;
  owner: string;
  per_intent_cap: i128;
  status: AgentStatus;
  version: u32;
  /**
 * TUMBLING window, not rolling — see DECISIONS.md #3
 */
window_seconds: u64;
}

export type DataKey = {tag: "Owner", values: void} | {tag: "Operator", values: void} | {tag: "Policy", values: readonly [string]} | {tag: "Window", values: readonly [string]} | {tag: "Decision", values: readonly [Buffer]} | {tag: "IntentIndex", values: readonly [Buffer]};

export enum Verdict {
  Approved = 0,
  Rejected = 1,
  RequiresApproval = 2,
}


export interface Decision {
  agent: string;
  amount: i128;
  asset: string;
  decision_id: Buffer;
  intent_hash: Buffer;
  ledger_seq: u32;
  /**
 * The code recorded at `authorize()` time. Written ONCE and never again, so an
 * approval cannot erase the fact that the decision was ever escalated: after
 * `resolve(approve = true)` `reason_code` reads `Ok` while this still reads
 * `PendingApproval` (SOW §5.2 scenario 5 stays visible in the evidence trail).
 */
original_reason_code: ReasonCode;
  /**
 * The version that PRODUCED this decision. Frozen for life: it is bound into
 * `decision_id` and `memo_hash` (DECISIONS.md #4, SOW §6.3), so moving it would make
 * both un-recomputable from public data.
 */
policy_version: u32;
  /**
 * The CURRENT (final) code. `resolve()` overwrites it.
 */
reason_code: ReasonCode;
  /**
 * whether it went through the human approver path `resolve()` (D4 surfaces escalation)
 */
resolved: boolean;
  /**
 * The policy version that was current when `resolve()` ran, or `None` while the
 * decision has never been resolved.
 * 
 * `resolve(approve = true)` re-judges against the policy current at resolve time
 * while `policy_version` stays frozen, so without this field a re-judgement that
 * still passed was indistinguishable from one that never ran. On the owner-rejection
 * path no re-judgement happens; the field then records the version that was current
 * at the moment of the rejection, which keeps the invariant
 * `resolved == resolved_policy_version.is_some()` checkable by a reader.
 */
resolved_policy_version: Option<u32>;
  service_id: string;
  settled: boolean;
  verdict: Verdict;
}

/**
 * Reason behind a verdict. Every failure path in SOW §5.2 maps to exactly one code.
 */
export enum ReasonCode {
  Ok = 0,
  CapExceeded = 1,
  ServiceNotAllowed = 2,
  AssetMismatch = 3,
  AgentRevoked = 4,
  WindowCapExceeded = 5,
  PendingApproval = 6,
  OwnerRejected = 7,
}

export enum AgentStatus {
  Active = 0,
  Revoked = 1,
}


/**
 * Spend state for one window. Reset LAZILY when a new epoch starts —
 * no history is kept, so storage stays bounded.
 */
export interface WindowState {
  spent: i128;
  window_start: u64;
}



export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  init: ({owner}: {owner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Human approver path. **owner-only** and **terminal** (§6.3).
   */
  resolve: ({decision_id, approve}: {decision_id: Buffer, approve: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Decision>>>

  /**
   * Construct and simulate a authorize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Evaluate an intent against the active policy version and STORE the decision on-chain.
   * 
   * **Idempotent on `intent_hash`**: calling again returns the original decision, creates
   * no new decision and raises no error (SOW §5.2 scenario 7 + §6.3). The "single-use"
   * property lives at SETTLEMENT, guarded by the `settled` flag — see DECISIONS.md #1.
   * 
   * `caller` must be the owner or the configured operator and must sign; `agent` must
   * sign independently. `caller` is NOT part of `canonical_intent`, so it never enters
   * `intent_hash`, `decision_id` or `memo_hash`.
   */
  authorize: ({caller, intent_hash, agent, service_id, asset, amount}: {caller: string, intent_hash: Buffer, agent: string, service_id: string, asset: string, amount: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Decision>>>

  /**
   * Construct and simulate a memo_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * `sha256(intent_hash || policy_version_be || decision_id)` computed ON CHAIN.
   * The verifier compares this against the transaction's real MEMO_HASH.
   */
  memo_hash: ({decision_id}: {decision_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Buffer>>>

  /**
   * Construct and simulate a get_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_policy: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Policy>>>

  /**
   * Construct and simulate a get_window transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * EFFECTIVE window state (tumbling reset already applied).
   */
  get_window: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<WindowState>>>

  /**
   * Construct and simulate a set_policy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Bump the version. Existing decisions keep their own `policy_version` (§6.3).
   */
  set_policy: ({policy}: {policy: Policy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a get_decision transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_decision: ({decision_id}: {decision_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Decision>>>

  /**
   * Construct and simulate a mark_settled transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Called by the executor right before submitting. Guards against double-settle.
   * 
   * `caller` must be the owner or the configured operator, and must sign.
   */
  mark_settled: ({caller, decision_id}: {caller: string, decision_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Decision>>>

  /**
   * Construct and simulate a revoke_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_agent: ({agent}: {agent: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_operator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_operator: ({operator}: {operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a register_agent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register_agent: ({policy}: {policy: Policy}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u32>>>

  /**
   * Construct and simulate a decision_by_intent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  decision_by_intent: ({intent_hash}: {intent_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Decision>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEaW5pdAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAD1IdW1hbiBhcHByb3ZlciBwYXRoLiAqKm93bmVyLW9ubHkqKiBhbmQgKip0ZXJtaW5hbCoqICjCpzYuMykuAAAAAAAAB3Jlc29sdmUAAAAAAgAAAAAAAAALZGVjaXNpb25faWQAAAAD7gAAACAAAAAAAAAAB2FwcHJvdmUAAAAAAQAAAAEAAAPpAAAH0AAAAAhEZWNpc2lvbgAAAAM=",
        "AAAAAAAAAilFdmFsdWF0ZSBhbiBpbnRlbnQgYWdhaW5zdCB0aGUgYWN0aXZlIHBvbGljeSB2ZXJzaW9uIGFuZCBTVE9SRSB0aGUgZGVjaXNpb24gb24tY2hhaW4uCgoqKklkZW1wb3RlbnQgb24gYGludGVudF9oYXNoYCoqOiBjYWxsaW5nIGFnYWluIHJldHVybnMgdGhlIG9yaWdpbmFsIGRlY2lzaW9uLCBjcmVhdGVzCm5vIG5ldyBkZWNpc2lvbiBhbmQgcmFpc2VzIG5vIGVycm9yIChTT1cgwqc1LjIgc2NlbmFyaW8gNyArIMKnNi4zKS4gVGhlICJzaW5nbGUtdXNlIgpwcm9wZXJ0eSBsaXZlcyBhdCBTRVRUTEVNRU5ULCBndWFyZGVkIGJ5IHRoZSBgc2V0dGxlZGAgZmxhZyDigJQgc2VlIERFQ0lTSU9OUy5tZCAjMS4KCmBjYWxsZXJgIG11c3QgYmUgdGhlIG93bmVyIG9yIHRoZSBjb25maWd1cmVkIG9wZXJhdG9yIGFuZCBtdXN0IHNpZ247IGBhZ2VudGAgbXVzdApzaWduIGluZGVwZW5kZW50bHkuIGBjYWxsZXJgIGlzIE5PVCBwYXJ0IG9mIGBjYW5vbmljYWxfaW50ZW50YCwgc28gaXQgbmV2ZXIgZW50ZXJzCmBpbnRlbnRfaGFzaGAsIGBkZWNpc2lvbl9pZGAgb3IgYG1lbW9faGFzaGAuAAAAAAAACWF1dGhvcml6ZQAAAAAAAAYAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAALaW50ZW50X2hhc2gAAAAD7gAAACAAAAAAAAAABWFnZW50AAAAAAAAEwAAAAAAAAAKc2VydmljZV9pZAAAAAAAEAAAAAAAAAAFYXNzZXQAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAABAAAD6QAAB9AAAAAIRGVjaXNpb24AAAAD",
        "AAAAAAAAAJFgc2hhMjU2KGludGVudF9oYXNoIHx8IHBvbGljeV92ZXJzaW9uX2JlIHx8IGRlY2lzaW9uX2lkKWAgY29tcHV0ZWQgT04gQ0hBSU4uClRoZSB2ZXJpZmllciBjb21wYXJlcyB0aGlzIGFnYWluc3QgdGhlIHRyYW5zYWN0aW9uJ3MgcmVhbCBNRU1PX0hBU0guAAAAAAAACW1lbW9faGFzaAAAAAAAAAEAAAAAAAAAC2RlY2lzaW9uX2lkAAAAA+4AAAAgAAAAAQAAA+kAAAPuAAAAIAAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X3BvbGljeQAAAAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAfQAAAABlBvbGljeQAAAAAAAw==",
        "AAAAAAAAADhFRkZFQ1RJVkUgd2luZG93IHN0YXRlICh0dW1ibGluZyByZXNldCBhbHJlYWR5IGFwcGxpZWQpLgAAAApnZXRfd2luZG93AAAAAAABAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAD6QAAB9AAAAALV2luZG93U3RhdGUAAAAAAw==",
        "AAAAAAAAAE1CdW1wIHRoZSB2ZXJzaW9uLiBFeGlzdGluZyBkZWNpc2lvbnMga2VlcCB0aGVpciBvd24gYHBvbGljeV92ZXJzaW9uYCAowqc2LjMpLgAAAAAAAApzZXRfcG9saWN5AAAAAAABAAAAAAAAAAZwb2xpY3kAAAAAB9AAAAAGUG9saWN5AAAAAAABAAAD6QAAAAQAAAAD",
        "AAAAAAAAAAAAAAAMZ2V0X2RlY2lzaW9uAAAAAQAAAAAAAAALZGVjaXNpb25faWQAAAAD7gAAACAAAAABAAAD6QAAB9AAAAAIRGVjaXNpb24AAAAD",
        "AAAAAAAAAJRDYWxsZWQgYnkgdGhlIGV4ZWN1dG9yIHJpZ2h0IGJlZm9yZSBzdWJtaXR0aW5nLiBHdWFyZHMgYWdhaW5zdCBkb3VibGUtc2V0dGxlLgoKYGNhbGxlcmAgbXVzdCBiZSB0aGUgb3duZXIgb3IgdGhlIGNvbmZpZ3VyZWQgb3BlcmF0b3IsIGFuZCBtdXN0IHNpZ24uAAAADG1hcmtfc2V0dGxlZAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAALZGVjaXNpb25faWQAAAAD7gAAACAAAAABAAAD6QAAB9AAAAAIRGVjaXNpb24AAAAD",
        "AAAAAAAAAAAAAAAMcmV2b2tlX2FnZW50AAAAAQAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMc2V0X29wZXJhdG9yAAAAAQAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAOcmVnaXN0ZXJfYWdlbnQAAAAAAAEAAAAAAAAABnBvbGljeQAAAAAH0AAAAAZQb2xpY3kAAAAAAAEAAAPpAAAABAAAAAM=",
        "AAAAAAAAAAAAAAASZGVjaXNpb25fYnlfaW50ZW50AAAAAAABAAAAAAAAAAtpbnRlbnRfaGFzaAAAAAPuAAAAIAAAAAEAAAPpAAAH0AAAAAhEZWNpc2lvbgAAAAM=",
        "AAAABAAAAKFFeGVjdXRpb24gZXJyb3JzIChhY2Nlc3MgY29udHJvbCwgc3RhdGUgbWFjaGluZSkuIERpc3RpbmN0IGZyb20gYFJlYXNvbkNvZGVgIOKAlAp0aGF0IG9uZSBpcyBhICpwb2xpY3kgdmVyZGljdCosIFJFQ09SREVEIG9uLWNoYWluIHJhdGhlciB0aGFuIHJhaXNlZCBhcyBhIHBhbmljLgAAAAAAAAAAAAAFRXJyb3IAAAAAAAAMAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAACAAAAAAAAAAhOb3RPd25lcgAAAAMAAAAAAAAAE05vdEF1dGhvcml6ZWRDYWxsZXIAAAAABAAAAAAAAAASQWdlbnROb3RSZWdpc3RlcmVkAAAAAAAFAAAAAAAAABBEZWNpc2lvbk5vdEZvdW5kAAAABgAAAEhyZXNvbHZlKCkgY2FsbGVkIG9uIGEgZGVjaXNpb24gdGhhdCBpcyBub3QgaW4gdGhlIFJlcXVpcmVzQXBwcm92YWwgc3RhdGUAAAASTm90UGVuZGluZ0FwcHJvdmFsAAAAAAAHAAAALXJlc29sdmUoKSBpcyB0ZXJtaW5hbCDigJQgYSBzZWNvbmQgY2FsbCBmYWlscwAAAAAAAA9BbHJlYWR5UmVzb2x2ZWQAAAAACAAAAAAAAAAOQWxyZWFkeVNldHRsZWQAAAAAAAkAAAAAAAAAC05vdEFwcHJvdmVkAAAAAAoAAAAAAAAADUludmFsaWRBbW91bnQAAAAAAAALAAAA121hcmtfc2V0dGxlZCgpIG9uIGEgZGVjaXNpb24gd2hvc2UgYWdlbnQgaGFzIGJlZW4gcmV2b2tlZCBzaW5jZSBpdCB3YXMgYXBwcm92ZWQuClJldm9jYXRpb24gdGFrZXMgZWZmZWN0IGltbWVkaWF0ZWx5IChTT1cgwqc1LjIgc2NlbmFyaW8gNikuCkFwcGVuZGVkIGF0IHRoZSBFTkQgc28gbm8gZXhpc3RpbmcgZGlzY3JpbWluYW50IHNoaWZ0cyAowqc1LjEgQUJJIGZyZWV6ZSkuAAAAAAxBZ2VudFJldm9rZWQAAAAM",
        "AAAAAQAAAAAAAAAAAAAABlBvbGljeQAAAAAACgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAMFNBQyBhZGRyZXNzIG9mIHRoZSBhc3NldCAoUGhhc2UgMTogdGVzdG5ldCBVU0RDKQAAAA1hbGxvd2VkX2Fzc2V0AAAAAAAAEwAAAAAAAAAQYWxsb3dlZF9zZXJ2aWNlcwAAA+oAAAAQAAAAAAAAABJhcHByb3ZhbF90aHJlc2hvbGQAAAAAAAsAAAAAAAAAFWN1bXVsYXRpdmVfd2luZG93X2NhcAAAAAAAAAsAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAOcGVyX2ludGVudF9jYXAAAAAAAAsAAAAAAAAABnN0YXR1cwAAAAAH0AAAAAtBZ2VudFN0YXR1cwAAAAAAAAAAB3ZlcnNpb24AAAAABAAAADRUVU1CTElORyB3aW5kb3csIG5vdCByb2xsaW5nIOKAlCBzZWUgREVDSVNJT05TLm1kICMzAAAADndpbmRvd19zZWNvbmRzAAAAAAAG",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAABgAAAAAAAAAAAAAABU93bmVyAAAAAAAAAAAAAAAAAAAIT3BlcmF0b3IAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAATAAAAAQAAAAAAAAAGV2luZG93AAAAAAABAAAAEwAAAAEAAAAAAAAACERlY2lzaW9uAAAAAQAAA+4AAAAgAAAAAQAAAEJpbnRlbnRfaGFzaCAtPiBkZWNpc2lvbl9pZC4gVGhlIGJhc2lzIG9mIGlkZW1wb3RlbmN5IChzY2VuYXJpbyA3KS4AAAAAAAtJbnRlbnRJbmRleAAAAAABAAAD7gAAACA=",
        "AAAAAwAAAAAAAAAAAAAAB1ZlcmRpY3QAAAAAAwAAAAAAAAAIQXBwcm92ZWQAAAAAAAAAAAAAAAhSZWplY3RlZAAAAAEAAAAAAAAAEFJlcXVpcmVzQXBwcm92YWwAAAAC",
        "AAAAAQAAAAAAAAAAAAAACERlY2lzaW9uAAAADgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAABWFzc2V0AAAAAAAAEwAAAAAAAAALZGVjaXNpb25faWQAAAAD7gAAACAAAAAAAAAAC2ludGVudF9oYXNoAAAAA+4AAAAgAAAAAAAAAApsZWRnZXJfc2VxAAAAAAAEAAABL1RoZSBjb2RlIHJlY29yZGVkIGF0IGBhdXRob3JpemUoKWAgdGltZS4gV3JpdHRlbiBPTkNFIGFuZCBuZXZlciBhZ2Fpbiwgc28gYW4KYXBwcm92YWwgY2Fubm90IGVyYXNlIHRoZSBmYWN0IHRoYXQgdGhlIGRlY2lzaW9uIHdhcyBldmVyIGVzY2FsYXRlZDogYWZ0ZXIKYHJlc29sdmUoYXBwcm92ZSA9IHRydWUpYCBgcmVhc29uX2NvZGVgIHJlYWRzIGBPa2Agd2hpbGUgdGhpcyBzdGlsbCByZWFkcwpgUGVuZGluZ0FwcHJvdmFsYCAoU09XIMKnNS4yIHNjZW5hcmlvIDUgc3RheXMgdmlzaWJsZSBpbiB0aGUgZXZpZGVuY2UgdHJhaWwpLgAAAAAUb3JpZ2luYWxfcmVhc29uX2NvZGUAAAfQAAAAClJlYXNvbkNvZGUAAAAAAMVUaGUgdmVyc2lvbiB0aGF0IFBST0RVQ0VEIHRoaXMgZGVjaXNpb24uIEZyb3plbiBmb3IgbGlmZTogaXQgaXMgYm91bmQgaW50bwpgZGVjaXNpb25faWRgIGFuZCBgbWVtb19oYXNoYCAoREVDSVNJT05TLm1kICM0LCBTT1cgwqc2LjMpLCBzbyBtb3ZpbmcgaXQgd291bGQgbWFrZQpib3RoIHVuLXJlY29tcHV0YWJsZSBmcm9tIHB1YmxpYyBkYXRhLgAAAAAAAA5wb2xpY3lfdmVyc2lvbgAAAAAABAAAADRUaGUgQ1VSUkVOVCAoZmluYWwpIGNvZGUuIGByZXNvbHZlKClgIG92ZXJ3cml0ZXMgaXQuAAAAC3JlYXNvbl9jb2RlAAAAB9AAAAAKUmVhc29uQ29kZQAAAAAAVHdoZXRoZXIgaXQgd2VudCB0aHJvdWdoIHRoZSBodW1hbiBhcHByb3ZlciBwYXRoIGByZXNvbHZlKClgIChENCBzdXJmYWNlcyBlc2NhbGF0aW9uKQAAAAhyZXNvbHZlZAAAAAEAAAI0VGhlIHBvbGljeSB2ZXJzaW9uIHRoYXQgd2FzIGN1cnJlbnQgd2hlbiBgcmVzb2x2ZSgpYCByYW4sIG9yIGBOb25lYCB3aGlsZSB0aGUKZGVjaXNpb24gaGFzIG5ldmVyIGJlZW4gcmVzb2x2ZWQuCgpgcmVzb2x2ZShhcHByb3ZlID0gdHJ1ZSlgIHJlLWp1ZGdlcyBhZ2FpbnN0IHRoZSBwb2xpY3kgY3VycmVudCBhdCByZXNvbHZlIHRpbWUKd2hpbGUgYHBvbGljeV92ZXJzaW9uYCBzdGF5cyBmcm96ZW4sIHNvIHdpdGhvdXQgdGhpcyBmaWVsZCBhIHJlLWp1ZGdlbWVudCB0aGF0CnN0aWxsIHBhc3NlZCB3YXMgaW5kaXN0aW5ndWlzaGFibGUgZnJvbSBvbmUgdGhhdCBuZXZlciByYW4uIE9uIHRoZSBvd25lci1yZWplY3Rpb24KcGF0aCBubyByZS1qdWRnZW1lbnQgaGFwcGVuczsgdGhlIGZpZWxkIHRoZW4gcmVjb3JkcyB0aGUgdmVyc2lvbiB0aGF0IHdhcyBjdXJyZW50CmF0IHRoZSBtb21lbnQgb2YgdGhlIHJlamVjdGlvbiwgd2hpY2gga2VlcHMgdGhlIGludmFyaWFudApgcmVzb2x2ZWQgPT0gcmVzb2x2ZWRfcG9saWN5X3ZlcnNpb24uaXNfc29tZSgpYCBjaGVja2FibGUgYnkgYSByZWFkZXIuAAAAF3Jlc29sdmVkX3BvbGljeV92ZXJzaW9uAAAAA+gAAAAEAAAAAAAAAApzZXJ2aWNlX2lkAAAAAAAQAAAAAAAAAAdzZXR0bGVkAAAAAAEAAAAAAAAAB3ZlcmRpY3QAAAAH0AAAAAdWZXJkaWN0AA==",
        "AAAAAwAAAFJSZWFzb24gYmVoaW5kIGEgdmVyZGljdC4gRXZlcnkgZmFpbHVyZSBwYXRoIGluIFNPVyDCpzUuMiBtYXBzIHRvIGV4YWN0bHkgb25lIGNvZGUuAAAAAAAAAAAAClJlYXNvbkNvZGUAAAAAAAgAAAAUc2NlbmFyaW8gMSDigJQgdmFsaWQAAAACT2sAAAAAAAAAAAAlc2NlbmFyaW8gMiDigJQgZXhjZWVkcyBwZXJfaW50ZW50X2NhcAAAAAAAAAtDYXBFeGNlZWRlZAAAAAABAAAALnNjZW5hcmlvIDMg4oCUIHNlcnZpY2UgaXMgbm90IG9uIHRoZSB3aGl0ZWxpc3QAAAAAABFTZXJ2aWNlTm90QWxsb3dlZAAAAAAAAAIAAAAyc2NlbmFyaW8gNCDigJQgYXNzZXQgZGlmZmVycyBmcm9tIHRoZSBwb2xpY3kgYXNzZXQAAAAAAA1Bc3NldE1pc21hdGNoAAAAAAAAAwAAACVzY2VuYXJpbyA2IOKAlCBhZ2VudCBoYXMgYmVlbiByZXZva2VkAAAAAAAADEFnZW50UmV2b2tlZAAAAAQAAAA8ZXhjZWVkcyBjdW11bGF0aXZlX3dpbmRvd19jYXAgKGFkdmVyc2FyaWFsOiB3aW5kb3cgYm91bmRhcnkpAAAAEVdpbmRvd0NhcEV4Y2VlZGVkAAAAAAAABQAAAEBzY2VuYXJpbyA1IOKAlCBhYm92ZSB0aHJlc2hvbGQsIGJlbG93IGNhcCDihpIgd2FpdCBmb3IgdGhlIG93bmVyAAAAD1BlbmRpbmdBcHByb3ZhbAAAAAAGAAAAH293bmVyIHJlamVjdGVkIGl0IHZpYSByZXNvbHZlKCkAAAAADU93bmVyUmVqZWN0ZWQAAAAAAAAH",
        "AAAAAwAAAAAAAAAAAAAAC0FnZW50U3RhdHVzAAAAAAIAAAAAAAAABkFjdGl2ZQAAAAAAAAAAAAAAAAAHUmV2b2tlZAAAAAAB",
        "AAAAAQAAAHJTcGVuZCBzdGF0ZSBmb3Igb25lIHdpbmRvdy4gUmVzZXQgTEFaSUxZIHdoZW4gYSBuZXcgZXBvY2ggc3RhcnRzIOKAlApubyBoaXN0b3J5IGlzIGtlcHQsIHNvIHN0b3JhZ2Ugc3RheXMgYm91bmRlZC4AAAAAAAAAAAALV2luZG93U3RhdGUAAAAAAgAAAAAAAAAFc3BlbnQAAAAAAAALAAAAAAAAAAx3aW5kb3dfc3RhcnQAAAAG",
        "AAAABQAAAHBFbWl0dGVkIGV2ZXJ5IHRpbWUgYGF1dGhvcml6ZSgpYCBwcm9kdWNlcyBhIG5ldyBkZWNpc2lvbi4KTGV0cyByZXZpZXdlcnMgaW5kZXggYnkgYWdlbnQgd2l0aG91dCByZWFkaW5nIHN0b3JhZ2UuAAAAAAAAAA1EZWNpc2lvbkV2ZW50AAAAAAAAAQAAAA5kZWNpc2lvbl9ldmVudAAAAAAAAgAAAAAAAAAFYWdlbnQAAAAAAAATAAAAAQAAAAAAAAAIZGVjaXNpb24AAAfQAAAACERlY2lzaW9uAAAAAAAAAAI=",
        "AAAABQAAAEdFbWl0dGVkIHdoZW4gdGhlIG93bmVyIHJlc29sdmVzIGEgZGVjaXNpb24gc2l0dGluZyBpbiBSZXF1aXJlc0FwcHJvdmFsLgAAAAAAAAAADVJlc29sdmVkRXZlbnQAAAAAAAABAAAADnJlc29sdmVkX2V2ZW50AAAAAAACAAAAAAAAAAVhZ2VudAAAAAAAABMAAAABAAAAAAAAAAhkZWNpc2lvbgAAB9AAAAAIRGVjaXNpb24AAAAAAAAAAg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<Result<void>>,
        resolve: this.txFromJSON<Result<Decision>>,
        authorize: this.txFromJSON<Result<Decision>>,
        memo_hash: this.txFromJSON<Result<Buffer>>,
        get_policy: this.txFromJSON<Result<Policy>>,
        get_window: this.txFromJSON<Result<WindowState>>,
        set_policy: this.txFromJSON<Result<u32>>,
        get_decision: this.txFromJSON<Result<Decision>>,
        mark_settled: this.txFromJSON<Result<Decision>>,
        revoke_agent: this.txFromJSON<Result<void>>,
        set_operator: this.txFromJSON<Result<void>>,
        register_agent: this.txFromJSON<Result<u32>>,
        decision_by_intent: this.txFromJSON<Result<Decision>>
  }
}