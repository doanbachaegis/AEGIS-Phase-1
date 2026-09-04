# ABI Decisions — must be settled before Day 7

SOW §5.1 freezes the contract ABI in **Week 1**. Both the gateway and the executor are built on
top of it, so changing it after Day 7 breaks D2 and D3 alike.

This scaffold already **implements a working default** for each question, marked
`⚠️ NOT YET FINALIZED` in the code. Leon confirms or changes it, then the warning is removed.

---

## #1 — Is `authorize()` idempotent, or does it fail on replay?

**Conflict within the SOW:**

| Source | What it says |
|---|---|
| §4.1 D1 | *"`intent_hash` is single-use"* → calling again = **error** |
| §5.2 scenario 7 | *"Original decision returned, no second payment"* → **idempotent** |
| §6.3 | *"A replayed `intent_hash` returns the original decision"* → **idempotent** |

**Scaffold choice: idempotent.** Two of the three sources say so, and the §6.3 acceptance criteria
are what gets scored. The "single-use" property moves to **settlement**, guarded by the `settled`
flag (`mark_settled` returns `AlreadySettled` the second time around).

→ **Action required: correct the D1 wording in the SOW** to match, before Tiffany submits it.

## #2 — How should `MEMO_HASH` be encoded?

§6.3 states `sha256(intent_hash || policy_version || decision_id)` but says nothing about how
`policy_version` is encoded. If Rust and TS interpret it differently the hashes diverge, and the
bug only surfaces in Week 4.

**Scaffold choice:** `policy_version` = **4-byte big-endian `u32`**. The preimage is exactly **68 bytes**.

No domain separator is added — all three fields are fixed-width, so the concatenation is already
unambiguous, and leaving it that way matches §6.3 **verbatim**.

The contract exposes a `memo_hash(decision_id)` view that computes the value **on-chain**, so a
verifier does not have to trust the TS implementation.

## #3 — Cumulative window: tumbling or rolling?

SOW out-of-scope #12 says Phase 1 ships *one* configurable cumulative window, but does not state
its semantics.

**Scaffold choice: TUMBLING.** A rolling window would require storing and scanning every past
decision along with its timestamp → unbounded storage, and Soroban fees that grow with history.

State: `WindowState { window_start, spent }`, reset **lazily** when
`now >= window_start + window_seconds`.

**New reason code:** §5.2 includes an adversarial test for *"cumulative-window boundaries"*, but
the enum in the SOW **is missing the name of the code**. The scaffold uses `WindowCapExceeded`.
→ **Action required: add this code to §5.2 of the SOW.**

## #4 — How is `decision_id` generated?

The SOW does not say.

**Scaffold choice: deterministic derivation.**

```
decision_id = sha256("AEGIS-DECISION-v1" || intent_hash[32] || policy_version_be_u32[4])
```

Benefit: a reviewer can recompute `decision_id` from public data without having to trust AEGIS —
exactly the spirit of *"checkable rather than asserted"* (§6.1).

Trade-off: `decision_id` carries no entropy of its own. That is fine for Phase 1, because
`intent_hash` is already the unique key.

---

## #5 — Outside the ABI proper, but on the same deadline: how is `asset` represented?

The canonical intent hashes `asset` as a **`"CODE:ISSUER"` string** (the data the agent submits),
whereas the contract stores `allowed_asset` as an **`Address`** (the asset's SAC).

The gateway has to map between these two forms, and that mapping must be **deterministic and
public** — otherwise a reviewer cannot recompute `intent_hash`.

→ Settle the mapping table in `packages/canonical/SPEC.md` once the real contract ID for testnet
USDC is available.

---

## #6 — Trust boundary of the executor key (not a Day 7 blocker, but it must be written down)

The contract decides `service_id` + `amount`, but **nothing on-chain forces the executor to pay
exactly that**. A compromised executor can still pay the wrong thing — it is merely **detected
afterwards**, once the verifier runs; it is not prevented.

The SOW already handles most of this: D3 requires the verifier to check `amount`, `asset` and
`destination` against the on-chain decision.

**Phase 1 decision: leave it as is**, but the README must say so explicitly:

> Phase 1 trusts the executor key; the memo commitment makes misuse **detectable**,
> not impossible. Phase 2 moves settlement into the contract.

Phase 2 makes `settle(decision_id)` call `token::Client::transfer` through the SAC → decision and
settlement become a single transaction, with no need to trust the executor.
