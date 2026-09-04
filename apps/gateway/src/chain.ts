import { Buffer } from "node:buffer";
import {
  Client,
  Errors,
  Keypair,
  ReasonCode,
  Verdict,
  contract,
  rpc,
  type Decision,
} from "@aegis/bindings";
import { toHex } from "@aegis/canonical";
import type { AgentSigner } from "./agentSigner.js";
import { asContractFailure, type ContractFailure } from "./contractErrors.js";
import { KeyedMutex } from "./mutex.js";

/**
 * Everything that touches Soroban RPC.
 *
 * Two rules hold across this file:
 *
 * 1. **Never `simulate: false`.** Simulation is not an optimization here — it is
 *    what produces the auth entries the agent has to sign and the resource fee
 *    the envelope has to carry. Skipping it leaves an unsignable, unfundable
 *    transaction.
 * 2. **Never hardcode which address signs.** The signing loop iterates
 *    `tx.needsNonInvokerSigningBy()` against a signer map keyed by address, so
 *    it stays correct whichever credentials the RPC's simulation returns —
 *    including the day the network starts emitting v2 address credentials for
 *    the source account as well.
 */

/** A `Decision` with its Buffers rendered as hex. `amount` stays a bigint. */
export interface ChainDecision {
  decisionId: string;
  intentHash: string;
  agent: string;
  serviceId: string;
  asset: string;
  amount: bigint;
  policyVersion: number;
  verdict: Verdict;
  reasonCode: ReasonCode;
  originalReasonCode: ReasonCode;
  resolvedPolicyVersion: number | undefined;
  ledgerSeq: number;
  resolved: boolean;
  settled: boolean;
}

export interface ChainPolicy {
  agent: string;
  allowedAsset: string;
  allowedServices: string[];
  approvalThreshold: bigint;
  cumulativeWindowCap: bigint;
  perIntentCap: bigint;
  windowSeconds: bigint;
  status: number;
  version: number;
}

export interface SubmissionHooks {
  /** Fired as soon as the simulation has produced a verdict, before submission. */
  onVerdict?(decision: ChainDecision): void;
  /**
   * Fired with the transaction hash the instant the network accepts the
   * submission — BEFORE the confirmation wait. If the process dies or the
   * response is lost during the ~5s ledger close, this hash is the only way to
   * find out what happened, and it has to be recorded before the risk window,
   * not after it.
   */
  onSubmitted?(txHash: string): void;
  /** Fired once the transaction is in a closed ledger. */
  onFinality?(txHash: string, ledgerSeq: number): void;
}

export interface SubmissionResult {
  decision: ChainDecision;
  txHash: string | undefined;
  ledgerSeq: number | undefined;
  /** False when the call was a pure read and no envelope was submitted. */
  submitted: boolean;
}

/** A contract `Error`. Distinct from a Rejected verdict, which is a success. */
export class ContractCallError extends Error {
  constructor(readonly failure: ContractFailure) {
    super(`${failure.name} (#${failure.code})`);
    this.name = "ContractCallError";
  }
}

/** Anything else: RPC down, simulation blew up, transaction failed on ledger. */
export class ChainUnavailableError extends Error {
  constructor(
    message: string,
    /** The unparsed text. §6.1 D2 asks for the raw simulation error, verbatim. */
    readonly raw: string,
  ) {
    super(message);
    this.name = "ChainUnavailableError";
  }
}

const raw = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));

function rethrow(e: unknown): never {
  // Already classified — re-wrapping would flatten a mapped contract Error into
  // a generic 502, because `ContractCallError.message` is "Name (#N)" and does
  // not match the `Error(Contract, #N)` pattern.
  if (e instanceof ContractCallError || e instanceof ChainUnavailableError) throw e;
  const failure = asContractFailure(e);
  if (failure) throw new ContractCallError(failure);
  throw new ChainUnavailableError(e instanceof Error ? e.message : String(e), raw(e));
}

export function normalizeDecision(d: Decision): ChainDecision {
  return {
    decisionId: toHex(new Uint8Array(d.decision_id)),
    intentHash: toHex(new Uint8Array(d.intent_hash)),
    agent: d.agent,
    serviceId: d.service_id,
    asset: d.asset,
    amount: d.amount,
    policyVersion: d.policy_version,
    verdict: d.verdict,
    reasonCode: d.reason_code,
    originalReasonCode: d.original_reason_code,
    resolvedPolicyVersion: d.resolved_policy_version ?? undefined,
    ledgerSeq: d.ledger_seq,
    resolved: d.resolved,
    settled: d.settled,
  };
}

export interface AuthorizeInput {
  intentHash: Uint8Array;
  agentAddress: string;
  serviceId: string;
  /** the asset's SAC address, NOT the `"CODE:ISSUER"` string */
  assetSac: string;
  amount: bigint;
}

export interface AegisChainOptions {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  caller: Keypair;
  owner: Keypair | undefined;
  agentSigner: AgentSigner;
  txTimeoutSeconds: number;
}

export class AegisChain {
  private readonly mutex = new KeyedMutex();
  private readonly callerSigner: contract.KeypairSigner;
  private readonly ownerSigner: contract.KeypairSigner | undefined;

  constructor(private readonly opts: AegisChainOptions) {
    this.callerSigner = new contract.KeypairSigner(opts.caller, opts.networkPassphrase);
    this.ownerSigner = opts.owner
      ? new contract.KeypairSigner(opts.owner, opts.networkPassphrase)
      : undefined;
  }

  /**
   * `timeoutInSeconds` is a METHOD option, not a client option: it sets the
   * transaction's time bounds AND how long `SentTransaction` waits for the
   * ledger to close. Both belong to the individual call.
   */
  private get methodOptions(): contract.MethodOptions {
    return { timeoutInSeconds: this.opts.txTimeoutSeconds };
  }

  get callerAddress(): string {
    return this.opts.caller.publicKey();
  }

  get ownerAddress(): string | undefined {
    return this.opts.owner?.publicKey();
  }

  /** A read-only client. No signer: views are simulated and never submitted. */
  private readClient(): Client {
    return new Client({
      contractId: this.opts.contractId,
      networkPassphrase: this.opts.networkPassphrase,
      rpcUrl: this.opts.rpcUrl,
      publicKey: this.callerAddress,
      errorTypes: Errors,
    });
  }

  private writeClient(signer: contract.KeypairSigner): Client {
    return new Client({
      contractId: this.opts.contractId,
      networkPassphrase: this.opts.networkPassphrase,
      rpcUrl: this.opts.rpcUrl,
      publicKey: signer.address,
      signTransaction: signer,
      // The caller's own auth-entry signer, in case simulation returns ADDRESS
      // credentials for the source account rather than SOURCE_ACCOUNT ones.
      signAuthEntry: signer,
      errorTypes: Errors,
    });
  }

  /**
   * `authorize(caller, intent_hash, agent, service_id, asset, amount)`.
   *
   * A `Rejected` verdict is NOT an error here — it is a governance decision the
   * contract recorded, and it comes back through the success path.
   */
  async authorize(input: AuthorizeInput, hooks: SubmissionHooks = {}): Promise<SubmissionResult> {
    const client = this.writeClient(this.callerSigner);
    return this.submit(
      () =>
        client.authorize({
          caller: this.callerAddress,
          intent_hash: Buffer.from(input.intentHash),
          agent: input.agentAddress,
          service_id: input.serviceId,
          asset: input.assetSac,
          amount: input.amount,
        }, this.methodOptions),
      this.callerSigner,
      hooks,
    );
  }

  /**
   * `resolve(decision_id, approve)`. **owner-only on chain** — it goes through
   * `require_owner`, not `require_caller`, so the operator key cannot stand in
   * for it however the gateway is configured.
   */
  async resolve(
    decisionIdHex: string,
    approve: boolean,
    hooks: SubmissionHooks = {},
  ): Promise<SubmissionResult> {
    const signer = this.ownerSigner;
    if (!signer) {
      throw new ChainUnavailableError(
        "resolve() is owner-only on chain and OWNER_SECRET is not configured",
        "OWNER_SECRET missing",
      );
    }
    const client = this.writeClient(signer);
    return this.submit(
      () =>
        client.resolve({
          decision_id: Buffer.from(decisionIdHex, "hex"),
          approve,
        }, this.methodOptions),
      signer,
      hooks,
    );
  }

  async getDecision(decisionIdHex: string): Promise<ChainDecision> {
    try {
      const tx = await this.readClient().get_decision({
        decision_id: Buffer.from(decisionIdHex, "hex"),
      });
      useAbiErrorNames(tx);
      assertSimulationOk(tx);
      return normalizeDecision(unwrap(tx.result));
    } catch (e) {
      rethrow(e);
    }
  }

  async decisionByIntent(intentHashHex: string): Promise<ChainDecision> {
    try {
      const tx = await this.readClient().decision_by_intent({
        intent_hash: Buffer.from(intentHashHex, "hex"),
      });
      useAbiErrorNames(tx);
      assertSimulationOk(tx);
      return normalizeDecision(unwrap(tx.result));
    } catch (e) {
      rethrow(e);
    }
  }

  async getPolicy(agentAddress: string): Promise<ChainPolicy> {
    try {
      const tx = await this.readClient().get_policy({ agent: agentAddress });
      useAbiErrorNames(tx);
      assertSimulationOk(tx);
      const p = unwrap(tx.result);
      return {
        agent: p.agent,
        allowedAsset: p.allowed_asset,
        allowedServices: [...p.allowed_services],
        approvalThreshold: p.approval_threshold,
        cumulativeWindowCap: p.cumulative_window_cap,
        perIntentCap: p.per_intent_cap,
        windowSeconds: p.window_seconds,
        status: p.status,
        version: p.version,
      };
    } catch (e) {
      rethrow(e);
    }
  }

  /**
   * Build -> simulate -> collect every required auth signature -> submit.
   *
   * Serialized on the source account: see `KeyedMutex`. The lock is taken around
   * the whole build/submit, because the sequence number is read during `build`
   * and consumed at `send`.
   */
  private async submit(
    build: () => Promise<contract.AssembledTransaction<contract.Result<Decision>>>,
    signer: contract.KeypairSigner,
    hooks: SubmissionHooks,
  ): Promise<SubmissionResult> {
    return this.mutex.run(signer.address, async () => {
      let tx: contract.AssembledTransaction<contract.Result<Decision>>;
      try {
        // No `simulate: false`. The simulation is what produces the auth entries
        // and the resource fee.
        tx = await build();
      } catch (e) {
        rethrow(e);
      }

      useAbiErrorNames(tx);
      // A contract Error surfaces here, from the RPC's own words, before any
      // signing or submission happens.
      assertSimulationOk(tx);

      // The verdict is already knowable from the simulation. Report it now, so
      // the POST-to-verdict timing measures the decision rather than the ledger.
      let simulated: ChainDecision;
      try {
        simulated = normalizeDecision(unwrap(tx.result));
      } catch (e) {
        rethrow(e);
      }
      hooks.onVerdict?.(simulated);

      if (tx.isReadCall) {
        // Nothing to write: the contract answered entirely from storage. Do not
        // burn a sequence number and a fee to re-learn what we already have.
        return { decision: simulated, txHash: undefined, ledgerSeq: undefined, submitted: false };
      }

      await this.signAllAuthEntries(tx, signer);

      let txHash: string | undefined;
      const watcher = new (class extends contract.Watcher {
        override onSubmitted(response?: { hash?: string }): void {
          // Captured BEFORE the confirmation wait — see SubmissionHooks.
          if (response?.hash) {
            txHash = response.hash;
            hooks.onSubmitted?.(response.hash);
          }
        }
        override onProgress(): void {}
      })();

      try {
        const sent = await tx.signAndSend({ watcher });
        const decision = normalizeDecision(unwrap(sent.result));
        // `ledger` only exists on a transaction the RPC actually found; a
        // NOT_FOUND response carries no ledger, so narrow before reading it.
        const response = sent.getTransactionResponse;
        const ledgerSeq =
          response && response.status !== rpc.Api.GetTransactionStatus.NOT_FOUND
            ? response.ledger
            : undefined;
        if (txHash && ledgerSeq !== undefined) hooks.onFinality?.(txHash, ledgerSeq);
        return { decision, txHash, ledgerSeq, submitted: true };
      } catch (e) {
        if (e instanceof ContractCallError) throw e;
        const failure = asContractFailure(e);
        if (failure) throw new ContractCallError(failure);
        throw new ChainUnavailableError(
          txHash
            ? `submitted as ${txHash} but the result was not observed: ${e instanceof Error ? e.message : String(e)}`
            : e instanceof Error
              ? e.message
              : String(e),
          raw(e),
        );
      }
    });
  }

  /**
   * Sign every auth entry the simulation says is outstanding.
   *
   * Deliberately a LOOP over `needsNonInvokerSigningBy()` and not a single
   * hardcoded `signAuthEntries({ address: agent })`: the set of addresses is
   * whatever the RPC returned for this particular simulation. Today that is the
   * agent, because the caller's authorization rides on the envelope signature as
   * source-account credentials. If it ever also contains the caller, or a second
   * agent, this still signs the right things.
   */
  private async signAllAuthEntries(
    tx: contract.AssembledTransaction<contract.Result<Decision>>,
    signer: contract.KeypairSigner,
  ): Promise<void> {
    const outstanding = tx.needsNonInvokerSigningBy();
    for (const address of outstanding) {
      const signAuthEntry =
        address === signer.address
          ? signer.signAuthEntry
          : this.opts.agentSigner.canSign(address)
            ? this.opts.agentSigner.authEntrySignerFor(address)
            : undefined;
      if (!signAuthEntry) {
        throw new ChainUnavailableError(
          `no signer configured for auth entry ${address} — add it to AGENT_SECRETS`,
          `needsNonInvokerSigningBy: ${outstanding.join(", ")}`,
        );
      }
      // Sequential, not parallel: `signAuthEntries` mutates the built
      // transaction's operation in place, so two in flight would race.
      await tx.signAuthEntries({ address, signAuthEntry });
    }
  }
}

function unwrap<T>(result: contract.Result<T>): T {
  if (result.isErr()) {
    // `Err` from a `#[contracterror]`. Re-raise in the shape `asContractFailure`
    // reads, so both the simulation-throw path and this one land in one place.
    const name = result.unwrapErr().message;
    const code = Object.entries(Errors).find(([, v]) => v.message === name)?.[0];
    throw new Error(
      code ? `Error(Contract, #${code}) ${name}` : `contract returned an error: ${name}`,
    );
  }
  return result.unwrap();
}

/**
 * Restate the error table in the terms `contractErrors.ts` reads.
 *
 * The SDK builds `errorTypes` itself, from the contract spec — and it uses each
 * error case's **doc comment** as the `message`, not its name:
 *
 * ```js
 * errorTypes: spec.errorCases().reduce(
 *   (acc, curr) => ({ ...acc, [curr.value()]: { message: curr.doc().toString() } }), {})
 * ```
 *
 * It is applied AFTER the caller's options, so passing `errorTypes` to the
 * `Client` constructor has no effect at all. The consequence is not cosmetic:
 * `AlreadyResolved` arrives as *"resolve() is terminal — a second call fails"*,
 * and the undocumented cases — `NotAuthorizedCaller` among them — arrive as an
 * EMPTY STRING. An HTTP mapping keyed on the error name then silently falls
 * through to `unmapped_contract_error`, turning a clean 409 into a 500.
 *
 * Overwriting `tx.options.errorTypes` after the build restores the discriminant
 * -> name table the ABI actually defines.
 */
function useAbiErrorNames(tx: { options: { errorTypes?: Record<number, { message: string }> } }): void {
  tx.options.errorTypes = Errors;
}

/**
 * A failed simulation, reported from the simulation itself rather than from a
 * re-thrown string.
 *
 * `AssembledTransaction.result` reaches the same place by throwing and then
 * regex-matching its own error message, which loses the RPC's original text.
 * §6.1 D2 asks for the raw simulation error, so read it at the source.
 */
function assertSimulationOk(tx: { simulation?: rpc.Api.SimulateTransactionResponse }): void {
  const simulation = tx.simulation;
  if (!simulation || !rpc.Api.isSimulationError(simulation)) return;
  const failure = asContractFailure(new Error(simulation.error));
  if (failure) throw new ContractCallError({ ...failure, raw: simulation.error });
  throw new ChainUnavailableError(`simulation failed: ${simulation.error}`, simulation.error);
}
