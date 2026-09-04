# D1 — On-Chain Authorization Contract

Decisions are produced and stored **on-chain**, so they cannot be rewritten after a
payment by the very service that submitted that payment. That is what separates AEGIS
from an approval dashboard backed by an ordinary database.

## Access control

| Function | Who can call it |
|---|---|
| `init`, `set_operator`, `register_agent`, `set_policy`, `revoke_agent` | **owner** |
| `authorize`, `mark_settled` | owner **or** operator |
| `resolve` | **owner** — and **terminal** |
| `get_decision`, `decision_by_intent`, `get_policy`, `memo_hash` | anyone (view) |

`authorize` also calls `agent.require_auth()`: even a leaked operator key **cannot
impersonate another agent**. Compromising the operator key does not get you past policy.

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
- `extend_ttl` on every write to a persistent entry. An archived entry breaks the claim
  *"readable with the contract ID alone"*.
- `set_policy` **bumps the version**; existing decisions keep their own `policy_version`.
