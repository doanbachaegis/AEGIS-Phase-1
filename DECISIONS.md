# ABI Decisions

SOW §5.1 freezes the contract ABI in **Week 1**. Both the gateway and the executor are built on
top of it, so changing it after Day 7 breaks D2 and D3 alike.

**Status — #1-#4 are settled as of 2026-09-04.** Leon confirmed the scaffold's default in each
case, the contract is deployed on testnet running them, and the `⚠️ NOT YET FINALIZED` markers have
been removed from `packages/canonical/SPEC.md`, `packages/canonical/src/memo.ts` and
`crates/canonical/src/lib.rs`. #5 was resolved the same day. #6 stays open **by design** — it is a
Phase 1 trust boundary, not an undecided question.

**#7–#9 are three ABI changes taken deliberately, before the Week-1 freeze rather than after it**
(2026-09-04). Unlike #1–#4 these are not scaffold defaults being confirmed: each one moves the
frozen surface, and each is being implemented in `contracts/authorization/**` against the wording
in the entries below. #7 makes the `authorize` signature printed in **SOW §4.1 D1** wrong — a
**seventh SOW correction**, quoted before-and-after in #7, which must land before submission.
**#10** records a Phase 1 trust boundary in the same shape as #6: open by design, written down
rather than hidden.

The reasoning below stays as written. The value of this file to a reviewer is *why* the ABI looks
the way it does, not just what it froze into. Three items still need action **on the SOW itself**
(#1, #3 and #7, flagged inline); only #7 has a code counterpart.

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

**Resolved 2026-09-04.** Phase 1 is testnet USDC only, so the mapping is a single pair:

| form | value |
|---|---|
| `"CODE:ISSUER"` string, hashed into canonical field 4 | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| SAC `Address`, stored as `allowed_asset` | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

The derivation is the part that actually satisfies the requirement:

```bash
stellar contract id asset \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet
# CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

A SAC address is a deterministic function of (network passphrase, asset code, issuer) with **no
AEGIS-controlled input**, so a reviewer recomputes it rather than trusting us. Pasting the address
on its own would have recorded a value without meeting the actual requirement.

Published in `packages/canonical/SPEC.md` **§5** — that is the delivered artifact (SOW §6.1 D2),
and it carries the limitation with it: **nothing on-chain links the SAC to the `CODE:ISSUER`
string.** `authorize()` takes `intent_hash` and `asset: Address` as separate arguments; the
contract compares Address to Address, and the string only ever appears inside the `intent_hash`
preimage. The binding between the two forms is that spec section plus the reviewer's own
recomputation. Better we write that down than let the reviewer find it.

The SAC side is configured as `USDC_SAC_ADDRESS` (`.env.example`).

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

---

## #7 — `caller: Address` becomes the **first** parameter of `authorize` and `mark_settled`

**The defect this fixes.** `require_caller` was *operator-if-set-else-owner*: it read the
`Operator` slot, fell back to `Owner` when the slot was empty, and called `require_auth()` on
whichever single address came out. The consequence is that **configuring an operator locked the
owner out of both entry points** — the owner could no longer `authorize` or `mark_settled` until it
pointed `set_operator` back at itself. That was documented in `contracts/authorization/README.md`
as a known limitation, and it is the behaviour being removed here.

**Why "owner OR operator" was inexpressible without an ABI change.** `Address::require_auth`
**traps** on failure, and soroban-sdk 27 exposes no predicate form — there is no
`try_require_auth`, so "try the owner, and if that misses try the operator" is not available: the
first miss aborts the whole invocation. The contract therefore has to name **one** address before
any authorization runs, and nothing in the invocation distinguished an owner-signed call from an
operator-signed one — instance storage looks identical whoever is calling. The missing input was
simply *who is calling*, which is why the fix has to be a parameter.

**Choice:**

```
authorize(caller, intent_hash, agent, service_id, asset, amount) -> Decision
mark_settled(caller, decision_id) -> Decision
```

`caller` is `require_auth()`ed and then accepted **iff**

```
caller == owner  ||  (an operator is configured && caller == operator)
```

This is the pattern OpenZeppelin's `stellar-contracts` uses for every multi-principal check: take
the principal as an argument, authenticate it, then test membership.

`authorize` **keeps its separate `agent.require_auth()`**. That is a different property — the
agent signs for itself, so a leaked operator key cannot mint decisions in another agent's name —
and it is deliberately *not* folded into the `caller` check. Two signatures, two questions.

**This is also what the SOW reads as.** §4.1 D1 says *"an operator may call `authorize` but cannot
change policy or revoke an agent"*. The natural reading of that sentence is that the operator is
**added** to the set of callers, not that it **displaces** the owner; the old behaviour satisfied
the letter of the sentence while contradicting how anyone would read it.

**Trade-off, stated plainly:**

- The previous behaviour is **gone**, not deprecated. Any caller that relied on the owner being
  locked out while an operator is set — nothing in this repo does, but the deployed instance
  predates the change — sees different access control after the redeploy.
- It is an ABI change made *inside* the Week-1 window, which is precisely the window §5.1 exists
  to protect. It is being taken now for that reason: after Day 7 it would not be available at all,
  and the alternative is shipping a contract whose access-control table cannot express its own
  README.
- One more `Address` argument on the two hottest entry points, and one more signature for the
  gateway to produce (see **#10**).

→ **Action required — this is the seventh SOW correction, and it must land before submission.**
§4.1 D1 states the signature verbatim. The `caller` parameter makes that text wrong:

| | Text |
|---|---|
| **Before** (SOW §4.1 D1, verbatim) | `authorize(intent_hash, agent_id, service_id, asset, amount) -> Decision` |
| **After** | `authorize(caller, intent_hash, agent_id, service_id, asset, amount) -> Decision` |

`mark_settled` gains `caller` as its first parameter on the same terms; the SOW does not print its
signature, so nothing there needs editing. Note that the ABI names the third parameter `agent:
Address` — the `agent_id` above is the SOW's own vocabulary, kept as-is so the edit is a
one-token insertion rather than a rewrite.

## #8 — `original_reason_code: ReasonCode` on `Decision`

**The gap.** `resolve()` overwrites `reason_code` with whatever the re-judgement produced. A
decision that was escalated as `PendingApproval` and then approved ends up on chain reading `Ok`;
one that was escalated and then rejected reads `OwnerRejected` or a policy failure code. Either
way, **the chain stops recording that the decision was ever escalated at all.**

**Choice: a second field, `original_reason_code`, set once at `authorize` time and never
rewritten.** `resolve()` writes `reason_code` and leaves `original_reason_code` alone.

**The counter-argument, which was real and was overruled.** The field is *derivable* from what is
already on chain. `evaluate()` reaches `RequiresApproval` by exactly one path, and that path always
pairs it with `PendingApproval`; `resolve()` refuses any decision whose verdict is not
`RequiresApproval` (`NotPendingApproval`). So `resolved == true` **already implies** that the
decision was escalated, and implies the original code was `PendingApproval`. On that reading the
new field stores nothing a careful reader could not reconstruct.

It was made explicit anyway. The derivation depends on a reviewer knowing three separate facts
about the contract's internals and trusting that all three still hold — including in a future
version where `evaluate()` grows a second escalation path, at which point every historical decision
silently changes meaning. An audit trail that requires the auditor to reason about control flow is
weaker than one that records the fact. The trade is: **one field of storage against a property that
holds by construction instead of by inference.**

**Trade-off:** `Decision` grows by one enum field — storage on every decision, forever, for
something usually inferable. And it is an ABI change, so it only exists because the Week-1 window
was still open.

## #9 — `resolved_policy_version: Option<u32>` on `Decision`

**The gap.** `resolve(approve = true)` **re-runs the full evaluation against the policy current at
resolve time** (that is the point of it — a decision escalated under v1 must not be rubber-stamped
after the owner revoked the agent or lowered a cap). But `policy_version` on the `Decision` stays
**frozen at the value it was created with**, and it has to: it is bound into `decision_id`
(`sha256("AEGIS-DECISION-v1" || intent_hash || policy_version_be)`, #4) and into `memo_hash`, so
rewriting it would make both un-recomputable from public data — the *"checkable rather than
asserted"* property in §6.1 — and would contradict §6.3's *"existing decisions keep their own
`policy_version`"*.

The consequence was that **the version a re-judgement actually ran under was not recorded
anywhere.** A re-judgement that still passes was indistinguishable from one that was never re-run.

**Choice:** `resolved_policy_version: Option<u32>` — `None` until `resolve()` runs, then the
version the re-judgement was evaluated against. `policy_version` keeps its frozen meaning; the new
field carries the second, genuinely different fact. Neither field moves `decision_id` or
`memo_hash` (see `packages/canonical/SPEC.md` §2–§3 — the preimages are unchanged).

**The counter-argument, which was real and was overruled.** The gap is *avoidable by process*:
never bump a policy for an agent that has live (unresolved) decisions, and the version at resolve
time is always the version at authorize time, so there is nothing to record. That is true, and it
costs nothing to implement because it is not code.

It was made explicit anyway, for the same reason as #8: it is a discipline, and a discipline that
is not enforced on chain is not a guarantee. Nothing in the contract prevents `set_policy` from
being called while decisions sit in `RequiresApproval` — the contract deliberately allows it,
because that is exactly the case where re-judgement matters. An evidence artifact whose
completeness depends on an operator never doing something the contract permits is the wrong shape.

**Trade-off:** a second version field on `Decision` invites the misreading that there are two
policy versions in play for one decision. There are — that is the fact being recorded — but it
puts a documentation burden on D4: the console must label them, not print both as *"policy
version"*.

---

## #10 — The gateway holds the agents' secret keys (Phase 1)

`authorize` requires **two** signatures: the `caller` (owner or operator, #7) and the agent, via
`agent.require_auth()`. SOW §4.1 D2 specifies `POST /v1/intents` as a **single synchronous
request** — the agent posts an intent and gets a decision back. There is no round trip inside that
request in which an external agent could be handed an auth entry to sign.

**Phase 1 decision: the gateway holds the agents' secret keys** and produces both signatures
itself.

**The cost, stated plainly.** `contracts/authorization/README.md` claims that even a leaked
operator key **cannot impersonate another agent**, because the agent signs for itself. The on-chain
check that backs that claim still runs, unchanged. But when the operator key *and* every agent key
live in **one process**, both signatures come out of a **single trust domain** — compromising the
gateway yields both. **In practice that property is gone**, even though the contract still enforces
it. It is the same shape as #6: the guarantee makes misuse **detectable**, not **impossible**.
Writing it down is the whole point; a reviewer who works this out unaided has found something we
concealed rather than something we disclosed.

**The Phase 2 improvement, named.** The property is recoverable with a **two-round-trip flow the
Stellar SDK already supports**, with no contract change:

1. `POST /v1/intents/prepare` — the gateway assembles the transaction and returns `tx.toJSON()`.
2. The agent runs **`signAuthEntries` locally**, against a key the gateway never sees.
3. `POST /v1/intents/submit` — the agent sends the signed JSON back; the gateway calls
   `client.fromJSON.authorize(json)` and then `signAndSend`, adding only the operator signature.

The agent key never leaves the agent, the two signatures come from two trust domains, and the
contract's claim holds in practice as well as on chain.

**Why it is not Phase 1:** it replaces D2's single synchronous `POST /v1/intents` with a
prepare/submit pair, which **changes the API surface the SOW specifies in §4.1 D2**. Changing a
specified endpoint shape is a larger correction than the seven wording edits already tracked, and
it is not what Phase 1 was scoped or scored on.

**Where this has to appear.** Not only here:

- `README.md` → **Phase 1 boundaries**, next to the executor-trust note (done).
- `.env.example`, on the key material itself, with the same ⚠️ framing as `EXECUTOR_SECRET` (done).
- ⚠️ **The reviewer README (D4 evidence pack, SOW §6.1) — still to be written.** This must reach
  the **reviewer**, not just developers reading the repo root. It belongs in the same section as
  the #6 executor-key note, in the same words: *Phase 1 places the operator key and the agent keys
  in one process, so the "a leaked operator key cannot impersonate another agent" property holds
  on chain but not in deployment; misuse is detectable, not impossible.* A reviewer scoring the
  trust model who finds this only by reading `DECISIONS.md` #10 has been under-served.
