# D1 — On-Chain Authorization Contract

Decisions are produced and stored **on-chain**, so they cannot be rewritten after a
payment by the very service that submitted that payment. That is what separates AEGIS
from an approval dashboard backed by an ordinary database.

## Access control

| Function | Who can call it |
|---|---|
| `init`, `set_operator`, `register_agent`, `set_policy`, `revoke_agent` | **owner** |
| `authorize`, `mark_settled` | the **owner** *or* the configured **operator** — passed explicitly as `caller` |
| `resolve` | **owner** — and **terminal** |
| `get_decision`, `decision_by_intent`, `get_policy`, `memo_hash` | anyone (view) |

`authorize` also calls `agent.require_auth()`: even a leaked operator key **cannot
impersonate another agent**. Compromising the operator key does not get you past policy.

### `caller: Address` on `authorize` / `mark_settled`

Both take `caller: Address` as their **first** parameter. The contract does
`caller.require_auth()` and then accepts iff `caller == owner` or an operator is configured
and `caller == operator`; anything else is `NotAuthorizedCaller`.

The parameter is what makes the disjunction expressible at all. `Address::require_auth`
**traps** on failure and soroban-sdk 27 exposes no predicate form — soroban-env-common's
`env.json` lists only `require_auth`, `require_auth_for_args`, `authorize_as_curr_contract`
and the custom-account hooks — so "try the owner, then the operator" is not available: the
first miss aborts the whole invocation. The contract must name exactly **one** address
before any authorization runs. Taking that address from the invocation turns the
disjunction into a plain equality check *after* the auth has already succeeded.

`caller` is a claim, not a credential. Naming the owner buys a third party nothing: it
cannot produce the owner's signature, so `caller.require_auth()` traps before the
membership check is reached. A caller that signs perfectly well as some *other* account
gets past the auth and is turned away by the membership check instead.

`caller` is **not** part of `canonical_intent` (which covers `agent_id`, `service_id`,
`asset`, `amount`, `purpose`, `client_ref`), so it never enters `intent_hash`,
`decision_id` or `memo_hash`. Who submitted an intent does not change what the intent *is*.

> Before this parameter existed, the check resolved to *operator-if-set-else-owner*, which
> locked the owner out of both entry points the moment an operator was configured.

## Reason code ↔ scenario §5.2

| Code | Scenario |
|---|---|
| `Ok` | 1 — compliant |
| `CapExceeded` | 2 — exceeds the per-intent cap |
| `ServiceNotAllowed` | 3 — service is not on the whitelist |
| `AssetMismatch` | 4 — asset differs from the policy |
| `PendingApproval` | 5 — above the threshold, below the cap |
| `AgentRevoked` | 6 — agent has been revoked |
| `WindowCapExceeded` | exceeds the cumulative window ⚠️ **the SOW omits this code** — DECISIONS.md #3 |
| `OwnerRejected` | owner rejected it via `resolve()` |

## Notes

- **Idempotent on `intent_hash`** (scenario 7). What is single-use is the *settlement*,
  guarded by the `settled` flag.
- **Tumbling window**, reset lazily. A rolling window would require walking history →
  unbounded storage.
- `extend_ttl` on every write to a persistent entry, **and on every entry point for the
  instance entry** — views included. `Owner` and `Operator` live in instance storage, so
  an archived instance entry fails *every* call and breaks the claim
  *"readable with the contract ID alone"*.
- `set_policy` **bumps the version**; existing decisions keep their own `policy_version`.

## Revocation and stale approvals

Policy is re-read at **every** gate, not just at `authorize`:

- `resolve(approve = true)` **re-runs the full evaluation against the policy that is
  current at resolve time**. A decision escalated under v1 and approved after the owner
  revoked the agent, or lowered `per_intent_cap` / `cumulative_window_cap`, is recorded as
  `Rejected` with the reason the evaluation produced — it is not rubber-stamped.
- `mark_settled` refuses with `AgentRevoked` when the agent's policy status is `Revoked`,
  even for a decision that was legitimately `Approved` beforehand. Settlement is the last
  on-chain gate before money moves, so §5.2 scenario 6's *"revocation takes effect
  immediately"* has to hold there too.
- The window charge itself is capped: a charge that would cross `cumulative_window_cap`
  writes nothing and turns the verdict into `WindowCapExceeded`. The cap is enforced where
  the budget is **spent**, not only where it is judged.

### `policy_version` vs `resolved_policy_version`

A decision approved via `resolve()` **keeps the `policy_version` it was created with**,
even when the re-judgement ran against a newer version.

`decision_id = sha256("AEGIS-DECISION-v1" || intent_hash || policy_version_be)`
(DECISIONS.md #4) and `memo_hash` both bind that field. Rewriting it would make
`decision_id` un-recomputable from public data — the *"checkable rather than asserted"*
property in §6.1 — and would contradict §6.3 (*"existing decisions keep their own
`policy_version`"*).

The version the re-judgement actually ran under is therefore recorded in a **second**
field, `resolved_policy_version: Option<u32>`, which no hash binds:

| | meaning |
|---|---|
| `policy_version` | the version that PRODUCED the decision. Frozen for life; bound into `decision_id` and `memo_hash`. |
| `resolved_policy_version` | the version that was current when `resolve()` ran. `None` until resolved. |

`resolved == resolved_policy_version.is_some()` is an invariant: the owner-rejection path
runs no re-judgement, but still records the version that was current when the owner acted,
so a reader never has to distinguish "not resolved" from "resolved but unrecorded". A
re-judgement that still passed is now visible as such — previously it was
indistinguishable from one that never ran.

### `reason_code` vs `original_reason_code`

`resolve()` overwrites `reason_code`, so after an approval it reads `Ok` and the chain
would otherwise no longer record that the decision was ever escalated.
`original_reason_code` is written **once**, at `authorize()` time, and never again:

| | meaning |
|---|---|
| `reason_code` | the CURRENT (final) code. Rewritten by `resolve()`. |
| `original_reason_code` | the code `authorize()` recorded. Never rewritten. |

For a decision escalated under §5.2 scenario 5 and then approved, that is
`reason_code = Ok` beside `original_reason_code = PendingApproval`. For a decision that
never went through the human path, the two are equal.
