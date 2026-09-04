import { Keypair, contract } from "@aegis/bindings";

/**
 * The seam between "who signs for the agent" and "how `authorize` is called".
 *
 * `authorize` needs TWO signatures (DECISIONS.md #7): the `caller` — owner or
 * operator — signs the transaction envelope as its source account, and the agent
 * signs its own auth entry via `agent.require_auth()`. Those are two different
 * questions and they are answered by two different keys.
 *
 * In Phase 1 both keys live in this process (DECISIONS.md #10), so the gateway
 * can produce both. That is a trust boundary, not an architecture: the on-chain
 * check that a leaked operator key cannot impersonate another agent still runs,
 * but it no longer buys anything in deployment, because compromising the gateway
 * yields both keys.
 *
 * Phase 2 replaces this with the SDK's prepare / `signAuthEntries` / submit
 * round trip, in which the agent key never leaves the agent. That is why the
 * signing sits behind this interface: a `RemoteAgentSigner` that forwards the
 * auth-entry preimage to its owner satisfies the same contract, and `chain.ts`
 * does not change.
 */
export interface AgentSigner {
  /** Named in the transcript so a reviewer can see which trust model produced a run. */
  readonly kind: string;
  /** Whether this signer can produce an auth entry for `address`. */
  canSign(address: string): boolean;
  /**
   * The SEP-43-shaped auth-entry callback for `address`, in the form the SDK's
   * `AssembledTransaction.signAuthEntries({ address, signAuthEntry })` accepts.
   */
  authEntrySignerFor(address: string): contract.SignAuthEntry;
}

/**
 * Phase 1: agent secret keys held in-process, keyed by address.
 *
 * Keyed by ADDRESS rather than by `agent_id` because the addresses to sign for
 * come from `tx.needsNonInvokerSigningBy()` — whatever the RPC's simulation says
 * needs a signature. Keying on a gateway-side identifier would mean guessing
 * which credentials the network asked for.
 */
export class InProcessAgentSigner implements AgentSigner {
  readonly kind = "in-process-keystore";
  private readonly signers = new Map<string, contract.SignAuthEntry>();

  constructor(secrets: ReadonlyMap<string, string>, networkPassphrase: string) {
    for (const [address, secret] of secrets) {
      const keypair = Keypair.fromSecret(secret);
      this.signers.set(address, new contract.KeypairSigner(keypair, networkPassphrase).signAuthEntry);
    }
  }

  canSign(address: string): boolean {
    return this.signers.has(address);
  }

  authEntrySignerFor(address: string): contract.SignAuthEntry {
    const signer = this.signers.get(address);
    if (!signer) throw new Error(`no agent signer configured for ${address}`);
    return signer;
  }

  get addresses(): string[] {
    return [...this.signers.keys()];
  }
}
