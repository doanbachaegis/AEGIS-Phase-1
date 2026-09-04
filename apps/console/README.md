# Reviewer Verification Console (D4)

## 🔑 Architectural invariant

Acceptance criteria §6.3:
> *"Every decision can be read on-chain by contract ID, **independently of the AEGIS database**."*

So the console **calls Soroban RPC directly** for everything that is authoritative:

| Data | Source | Label in the UI |
|---|---|---|
| verdict, reason_code, policy_version, decision_id, amount, asset | `get_decision()` / `decision_by_intent()` via Soroban RPC | **"read from chain"** |
| memo_hash | `memo_hash()` — computed by the contract itself | **"read from chain"** |
| purpose, client_ref | AEGIS API | "supplementary display" |

**No** `fetch('/api/intents/:id')` for the first group — doing that destroys the single
strongest piece of evidence the whole project has.

## Display requirements (§4.1 D4)

- agent + owner, policy version, **which rule made the decision**, verdict + reason code
- `decision_id` + Stellar Expert link to the contract
- if approved: amount, asset, `MEMO_HASH`, Stellar Expert link to the transaction
- **rejected intents show their reason code; do not hide them**
- clear labels: **"Testnet"** and **"no real funds"**

If Week 3 slips: cut **styling**, not the number of test runs (§5.1).
