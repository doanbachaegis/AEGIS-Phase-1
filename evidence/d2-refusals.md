# D2/D3 — the four refusals

Generated 2026-09-04T07:26:14Z

SOW §6.1 D2 requires two attempts to resolve an already-resolved decision and two attempts to
hand the executor an intent with no approved decision. **All four had to be refused, and the
refusals are the evidence.** All four were.

| # | Attempt | Target | Refused by | Answer | Evidence |
|--:|---|---|---|---|---|
| 1 | second `resolve()` of an already-resolved decision | `s10` (`17594051cc98c12d…`) | contract, via `POST /v1/decisions/:id/resolve` | **HTTP 409 · `AlreadyResolved`** | `d2-responses.ndjson`, `d2-gateway.ndjson` |
| 2 | second `resolve()` of an already-resolved decision | `s15` (`03defcb77539553d…`) | contract, via `POST /v1/decisions/:id/resolve` | **HTTP 409 · `AlreadyResolved`** | `d2-responses.ndjson`, `d2-gateway.ndjson` |
| 3 | `aegis-settle settle` against a decision that authorizes no payment | `7504f529518b41ce…` — decision is RequiresApproval and still unresolved — nobody has approved this spend | executor gate, before any transaction was built | **exit 1 · `NOT_APPROVED`** | `d3-state.json` → `refusals` |
| 4 | `aegis-settle settle` against a decision that authorizes no payment | `c942b69f7af06b01…` — decision is Rejected (CapExceeded) — the contract refused this spend outright | executor gate, before any transaction was built | **exit 1 · `NOT_APPROVED`** | `d3-state.json` → `refusals` |

## What each refusal proves

**1 and 2 — `resolve()` is terminal.** `s10` was approved by the owner and `s15` was rejected by
the owner. Both were then resolved a second time; the second call on `s15` deliberately asked for
the *opposite* answer. The contract refused both with `AlreadyResolved` (`Error #8`), so an
approver cannot revisit a decision after the fact, and the gateway mapped that to HTTP 409 —
a conflict with on-chain state, not a malformed request.

**3 and 4 — settlement is gated on the decision, not on the request.** The executor's only input
is a `decision_id`; it re-reads the decision from the contract and refuses on its own evidence:

```
$ aegis-settle settle --decision 7504f529518b41ce2edc3fcdc04cbb819d2024842c3402519cb66af58d4264c7
NOT_APPROVED: the contract did not approve this spend (expected Approved, got RequiresApproval)
  ^ refused by the decision itself — re-running changes nothing until the chain does

$ aegis-settle settle --decision c942b69f7af06b0172aa39f81e3e42412a9b83c4b8fbfdebe0b9411d314b9db2
NOT_APPROVED: the contract did not approve this spend (expected Approved, got Rejected)
  ^ refused by the decision itself — re-running changes nothing until the chain does

```

One is `RequiresApproval` and still unresolved — nobody has approved that spend. The other is
`Rejected` with `CapExceeded` — the contract refused it outright. Both refusals happen at the
gate, before an envelope exists, so no transaction was built and nothing was marked settled.

## A fifth attempt, and a real finding

Not required by the SOW, run anyway: settle a `decision_id` that does not exist on chain
(`0000000000000000…`, 32 zero bytes).

It **was refused** — exit 1, no payment — but with the code `SOURCE_UNAVAILABLE`,
not the `DECISION_NOT_FOUND` gate code `apps/executor/src/errors.ts` defines for exactly this case:

```
SOURCE_UNAVAILABLE: the contract returned No decision is stored under this decision_id or intent_hash. Also what a
reader sees if the persistent entry has been archived and not restored. from get_decision
```

The cause is visible in the message. `apps/executor/src/chain.ts` decides whether a failure is a
*not-found answer* or an *unreachable source* by looking for the string `"DecisionNotFound"`
(`const NOT_FOUND`, and `mentionsNotFound`) — the variant's **name**. What the generated client
actually surfaces as `message` is the variant's **doc comment** (`"No decision is stored under
this decision_id…"`), so the test never matches and the answer falls through to the
`SOURCE_UNAVAILABLE` branch.

Consequence, stated precisely: **the settlement is still refused and no money moves** — this is not
a safety defect. But `SOURCE_UNAVAILABLE` means *"a public data source could not be reached"*, i.e.
retry later, while the truth is *"the chain answered, and the answer is no"*. An operator or a
recovery loop that retries on `SOURCE_UNAVAILABLE` would retry forever against a decision that
will never exist. The verifier draws exactly this distinction on its own exit codes (`3
UNAVAILABLE` is *not* a pass), so the executor collapsing it here is inconsistent with the
project's own stated rule.

`memoHash()`, a few lines below in the same file, applies the identical string test and would
misclassify the same way. It never gets the chance: `getDecision` runs first and the gate refuses
before `memo_hash()` is ever called. So one root cause, one observable symptom.

Not fixed here: `apps/**` is out of scope for this evidence run, and a one-line change to a
trust-boundary file is worth a review rather than a drive-by edit.
