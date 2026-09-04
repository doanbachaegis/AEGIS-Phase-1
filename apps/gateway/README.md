# D2 — Intent Gateway

The only path that turns an agent request into something the contract can evaluate. The executor
(D3) has no second input path: it accepts a `decision_id` and nothing else.

```
POST /v1/intents                    submit an intent, get a decision
GET  /v1/intents/:intent_hash       the decision, plus the preimage the chain does not hold
GET  /v1/decisions/:id              the decision, read from the chain
POST /v1/decisions/:id/resolve      the human approver path (owner-only ON CHAIN)
GET  /v1/approvals                  escalations still pending, per the chain
GET  /health                        including whether a database is attached
```

## Two signatures, two questions

`authorize(caller, intent_hash, agent, service_id, asset, amount)` requires **two** signatures and
they answer different questions (`DECISIONS.md` #7):

| signature | question | how it is produced |
|---|---|---|
| `caller` — owner or operator | *is this gateway allowed to submit decisions at all?* | signs the transaction envelope as source account |
| `agent` — via `agent.require_auth()` | *did this agent authorize its own spend?* | signs its own auth entry |

The second is what stops a leaked operator key from minting decisions in another agent's name. In
Phase 1 **both keys live in this process** (`DECISIONS.md` #10), so that property holds on chain
but not in deployment: compromising the gateway yields both. Misuse is detectable, not impossible —
the same shape as the executor-key boundary in #6.

The agent side sits behind `AgentSigner` (`src/agentSigner.ts`) for exactly this reason. Phase 2's
prepare / `signAuthEntries` / submit round trip is a different implementation of that interface;
`src/chain.ts` does not change.

### Three things `src/chain.ts` will not do

- **Never `simulate: false`.** The simulation is what produces the auth entries the agent has to
  sign and the resource fee the envelope has to carry.
- **Never hardcode who signs.** The signing loop walks `tx.needsNonInvokerSigningBy()` against a
  signer map keyed by address, so it stays correct whichever credentials the RPC returns.
- **Never overlap two submissions from one source account.** `KeyedMutex` serializes on the source
  account: two concurrent POSTs reading the same sequence number is a `txBAD_SEQ`, which looks like
  a network fault and is actually a lost decision.

The transaction hash is captured from the submission response **before** the confirmation wait, and
logged there, so a crash inside the ~5s ledger close still leaves a handle on what was sent.

## HTTP mapping

**`Rejected` is HTTP 200.** A rejection is a *successful governance decision*: the policy was
evaluated, a verdict was reached, and the contract wrote it where it can be read forever. A 4xx
would claim the request was malformed or unauthorized — it was neither — and would push clients
into retry-on-4xx paths for an answer that is final and idempotent. Clients branch on the `verdict`
field, never on `res.ok`. The SOW does not settle this; it is a judgement call, recorded here.

| outcome | status | notes |
|---|---|---|
| `Approved` | 200 | |
| `Rejected` | 200 | `verdict` + `reason_code` in the body |
| `RequiresApproval` | 202 | `Location: /v1/decisions/:id`, plus the §4.1 D2 rule string, e.g. `amount 30 > threshold 25` |
| `NotAuthorizedCaller`, `NotOwner`, `NotInitialized` | **500 + alert** | *our* key is wrong. The client did nothing wrong and cannot fix it; a 4xx would misattribute the fault and hide an operational failure |
| `AgentNotRegistered` | 422 | well-formed, resolvable, but the chain holds no policy for that agent |
| `DecisionNotFound` | 404 | |
| `NotPendingApproval`, `AlreadyResolved`, `AlreadySettled`, `NotApproved`, `AgentRevoked` | 409 | conflicts with current on-chain state |
| `InvalidAmount` | 400 | unreachable — the schema rejects non-positive amounts first |
| RPC unreachable / simulation blew up | 502 | the chain did not answer; that is ours, not the caller's |
| unknown `agent_id` / `asset` | 400 | no address means no `authorize()` call and so no on-chain evidence to produce |

An unknown **`service_id` is deliberately not rejected here.** `Policy.allowed_services` is the
authority and the contract records `ServiceNotAllowed` on chain (§5.2 scenario 3); a local
pre-filter would replace that evidence with gateway behaviour.

## The transcript (SOW §6.1 D2)

The pino log **is** the evidence. Three record types, all keyed by `request_id`:

| `event` | when | what it carries |
|---|---|---|
| `intent.received` | before any chain call | the intent, and the full canonical preimage as `canonical_hex` |
| `decision.recorded` | after the verdict | verdict and reason as **both** name and number, ids, timings |
| `intent.failed` | instead of the above | the raw, unparsed simulation error |

`canonical_hex` is the highest-value field in the log, because it removes AEGIS from the loop:

```bash
echo -n <canonical_hex> | xxd -r -p | shasum -a 256   # == intent_hash
```

A fourth line, `chain.submitted`, is operational rather than evidentiary — it records the
transaction hash at submission time.

**Two timings, never one.** `verdict_ms` is POST → the contract's answer, known from the
simulation. `finality_ms` is POST → the decision in a closed ledger, and includes the ledger close.
They differ by roughly an order of magnitude (~0.9s vs ~6s on testnet) and answer different
questions. Reporting one number invites the wrong conclusion about whichever question the reader
had in mind.

**BigInt breaks both serializers.** `TypeError: Do not know how to serialize a BigInt` thrown
inside a pino call does not lose a line, it loses the transcript record. Amounts are converted at
every boundary with `formatAmount` / `.toString()`; `jsonSafe` is the net under that rule, not a
substitute for it.

## The registry

`registry.json` (this directory) maps `agent_id` → `G…` address and `asset "CODE:ISSUER"` → SAC.
Both are needed because `canonical_intent` hashes **strings** while the contract compares
**Addresses**. `services.json` (repo root, owned by D3) maps `service_id` → destination and is read
here, never written.

The asset table carries **two** assets. The second, non-policy one exists so a §5.2 scenario 4
(`AssetMismatch`) intent resolves to a real SAC and is judged **by the contract** rather than turned
away locally as `unknown_asset` — otherwise that scenario would be demonstrated by gateway code
instead of by on-chain evidence.

Both files are **published, not enforced**: nothing in contract storage commits to them. Same
standing as `services.json`, same reasoning as `DECISIONS.md` #5.

## The database

`intent_hash` is the primary key, because it is the chain's own key — DB and chain cannot then
disagree about what a row means.

The database is **not** the record of decisions; §6.3 requires those to be readable on chain by
contract ID alone. Its real job is the part the chain does not hold: `purpose` and `client_ref` are
hashed into `intent_hash` but never stored on-chain, and §6.1 D2 requires a reviewer to recompute
`intent_hash` from a submitted intent. Without them that claim is unverifiable.

Replay protection is **not** reimplemented here. The contract is idempotent on `intent_hash`
(`DECISIONS.md` #1); the `onConflictDoNothing` clause stops a duplicate *submission* from
overwriting the first one's `request_id`, not a duplicate *decision*.

`approval_queue` has no `pending` column. Pending-ness is derived from the chain: `GET /v1/approvals`
re-reads `get_decision` for every candidate and keeps only the ones the contract still reports as
`RequiresApproval` and unresolved. A boolean here would go stale the moment the owner resolved a
decision through the console, the CLI, or a second gateway instance.

### Running without one

The server **boots and serves the chain path with no database**, logging a warning and degrading.
A gateway that refused to call `authorize` because Postgres was down would turn an
evidence-collection outage into a governance outage. `GET /health` reports `"database": "degraded"`.

What that costs is enumerated on `DegradedStore` in `src/db/store.ts`. In short: `purpose` and
`client_ref` survive only in the transcript, duplicate-submission reporting is per-process, and the
escalation *index* does not survive a restart. Nothing about whether a decision is correct,
reachable, or settleable changes — the chain is the authority on all three.

Migrations are generated and committed, never applied at boot (a process that migrates on boot
cannot also boot without a database):

```bash
pnpm --filter @aegis/gateway db:generate   # after editing src/db/schema.ts
pnpm --filter @aegis/gateway db:migrate    # explicit, against a provisioned instance
```

## Configuration

See `.env.example`. `OPERATOR_SECRET` is preferred over `OWNER_SECRET` for `caller` — it is the
less privileged of the two accepted callers and cannot change policy or revoke an agent.
`OWNER_SECRET` is required only for `resolve()`, which is owner-only on chain via `require_owner`.
`AGENT_SECRETS` is keyed by **address**, matching what `needsNonInvokerSigningBy()` reports.
