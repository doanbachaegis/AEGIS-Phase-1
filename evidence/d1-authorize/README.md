# D1 — on-chain authorization evidence (70 runs)

Evidence for **SOW §6.1 D1** and **§6.3 acceptance criterion 1**: each of the
seven §5.2 scenarios executed ten times against the live testnet contract, with
the verdict *and* the reason code checked against the expectation on every run.

**Result: 70 / 70 passed.**

| Artefact | What it is |
| --- | --- |
| `results.md` | the result table — 70 runs × 7 scenarios, plus the `u32 → name` reason-code key |
| `runs.ndjson` | one raw JSON record per run: full intent, canonical preimage, expectation, on-chain decision, tx hash |
| `decision-export.json` | the decision export: `decision_id`, `intent_hash`, `policy_version`, `verdict`, `reason_code`, `ledger_seq` (+ name translations) |
| `decision-export.csv` | the same export as CSV |
| `agents.json` | the four agent identities, the policy each was registered with, and the registration / revocation transactions |

Reproduce with `bash scripts/d1-run.sh` (see *Reproducing* below).

## Session

| | |
| --- | --- |
| Session id | `20260904T070836Z` |
| Network | testnet |
| Contract | `CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA` |
| `caller` for every `authorize` | `aegis-operator` |
| Ledger range | 4496439 – 4496577 |
| Policy version applied | 1, on every one of the 70 runs |

## Reason codes are `u32` on the wire

SOW §5.2 names the failure paths in SCREAMING_SNAKE. The contract stores them as
a `u32`, and that is what the export and the console carry. Every table here
prints both, because "correct verdict and reason code" is not checkable against
a bare integer:

| `u32` | name | | `u32` | name |
| --- | --- | --- | --- | --- |
| 0 | `Ok` | | 4 | `AgentRevoked` |
| 1 | `CapExceeded` | | 5 | `WindowCapExceeded` |
| 2 | `ServiceNotAllowed` | | 6 | `PendingApproval` |
| 3 | `AssetMismatch` | | 7 | `OwnerRejected` |

`verdict` is likewise a `u32`: 0 `Approved`, 1 `Rejected`, 2 `RequiresApproval`.

## Scenario → agent → asset design

Four agent identities, **generated fresh for the session**, each registered at
**policy version 1** with a byte-for-byte copy of `aegis-agent-1`'s live policy,
and never bumped afterwards.

| Agent | Scenarios | Why it exists |
| --- | --- | --- |
| `aegis-d1-compliant` | 1 | the only agent that ever receives an `Approved` verdict, so the only one whose tumbling window is ever charged |
| `aegis-d1-limits` | 2, 5 | the amount-limit cases; never approved, so its window stays at **zero spend** |
| `aegis-d1-mismatch` | 3, 4 | the service and asset cases; never approved |
| `aegis-d1-revoked` | 6 | registered active, then revoked *before* any of its runs was sent |

Scenario 7 replays intents belonging to all six of the other scenarios, so it
uses all four agents.

### Why fresh identities, and why version 1 forever

*Fresh*, because the window is **tumbling and 24 hours wide**. Re-using an
identity across sessions would carry yesterday's spend into today's scenario 1
and silently convert `Approved` into `WindowCapExceeded`.

*Never bumped*, because the reviewer console renders an agent's **current**
policy next to a decision. An agent whose policy moved after a decision was
recorded would be displayed against a threshold that was not the one applied —
the evidence would be misleading even though the chain was correct.

### Why `aegis-agent-1` was not used

It is deliberately untouched: no `authorize`, no `set_policy`, no
`revoke_agent`. Two reasons, and either alone is sufficient:

1. A concurrent D2/D3 evidence run is using it. Its 24-hour window is shared
   state; ten approvals here would consume budget that run depends on.
2. Its policy must stay at version 1 for that run's evidence to read honestly.

### Why the window never became the binding constraint

Only an `Approved` verdict charges the window — the contract calls
`charge_window` solely on that branch. `Rejected` and `RequiresApproval` charge
nothing. So of the 70 runs, only scenario 1's ten can spend, and they were sized
in advance:

```
scenario 1 total charge   1183399999 stroops
cumulative_window_cap     2000000000 stroops
utilisation                    59.2%   (headroom 816600001)
largest single amount      250000000 == approval_threshold, so it approves
                                        rather than escalating
```

The final on-chain window read back at the end of the session matches that
prediction exactly:

```
aegis-d1-compliant  spent 1183399999
aegis-d1-limits     spent          0
aegis-d1-mismatch   spent          0
aegis-d1-revoked    spent          0
```

Putting scenario 5 on the **zero-spend** `aegis-d1-limits` agent is a
correctness measure, not tidiness. In `evaluate` the window check sits *before*
the threshold check, so a dirty window turns `PendingApproval` into
`WindowCapExceeded` — a wrong reason code on a run that still looks plausible.
Keeping that agent's window empty removes the failure mode by construction
instead of by arithmetic.

### Assets

| Key | SAC address | Canonical string | Used by |
| --- | --- | --- | --- |
| USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `USDC:GBBD47IF…` | the policy asset — scenarios 1, 2, 3, 5, 6 |
| XLM | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | `XLM:native` | scenario 4, runs 1–5 |
| EURC | `CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ` | `EURC:GB3Q6QDZ…` | scenario 4, runs 6–10 |

The XLM and EURC addresses are real testnet SAC addresses, derived with
`stellar contract id asset`, not invented strings — so scenario 4 rejects a
genuine other asset rather than a typo.

## Check-ordering evidence

`evaluate` checks in a fixed order: **revoked → service → asset → per-intent cap
→ window cap → threshold**. A run that breaks two rules at once must report the
*earlier* one, so a number of runs break a second rule deliberately:

| Run | Breaks | Must report | Why it matters |
| --- | --- | --- | --- |
| s2 r7–r10 | per-intent cap **and** window cap | `CapExceeded` | the per-intent limit is not masked by the budget |
| s3 r8 | unlisted service **and** over threshold | `ServiceNotAllowed` | an unlisted service is refused, not escalated to a human |
| s3 r9 | unlisted service **and** over cap | `ServiceNotAllowed` | |
| s4 r9 | wrong asset **and** over threshold | `AssetMismatch` | a wrong-asset intent is refused, not escalated |
| s4 r10 | wrong asset **and** over cap | `AssetMismatch` | |
| s6 r4–r8 | revoked **and** cap / threshold / service / asset | `AgentRevoked` | revocation really is immediate and unconditional |
| s6 r8 | revoked **and** *every* other rule at once | `AgentRevoked` | |

All of these came out as required.

Boundary values were exercised on both sides of each limit: `amount ==
approval_threshold` approves (s1 r10), `threshold + 1` escalates (s5 r1),
`amount == per_intent_cap` escalates (s5 r10), `cap + 1` rejects (s2 r1).
Scenario 3 also pins byte-exact service matching: `OpenAI-API` (case variant,
r8) and `"openai-api "` (one trailing U+0020, r10) are both refused, matching the
"no normalization or case folding" rule stated in `services.json`.

## Verifying an `intent_hash` with no AEGIS code

Every record carries `canonical_preimage_hex` — the exact bytes of
`canonical_intent` — so a reviewer can recompute the hash with stock tools:

```sh
jq -r 'select(.run_index == 1) | .canonical_preimage_hex' runs.ndjson \
  | xxd -r -p | shasum -a 256
# compare with: jq -r 'select(.run_index == 1) | .intent_hash' runs.ndjson
```

All 70 were checked this way after the run: **70/70 match**.

`decision_id` is independently recomputable too, as
`sha256("AEGIS-DECISION-v1" || intent_hash || policy_version_be_u32)`. All 70
match the value stored on chain.

## Notes on things that were not obvious

- **Scenario 7 has no single expected reason code.** The other six scenarios map
  to one `(verdict, reason_code)` pair each. A replay must return *whatever the
  original decision was*, so its ten runs carry six different codes between them
  (3 × `Ok`, 2 × `CapExceeded`, 2 × `PendingApproval`, and one each of
  `ServiceNotAllowed`, `AssetMismatch`, `AgentRevoked`). That is the intended
  result, not drift. The replay targets were chosen to cover all six other
  scenarios precisely so idempotency is shown to hold for *every* verdict the
  contract can produce, rather than only for approvals.

- **A replay is a real transaction, not a read.** `authorize` bumps the instance
  TTL on every entry, so simulation reports a replay as a write
  (`simulation_was_read_call: false` on all ten). Each replay therefore consumed
  a transaction and a fee, and landed in a later ledger — between 24 and 120
  ledgers after the one holding the decision it returned. That gap is useful evidence: the stored `ledger_seq` is
  unchanged while the replay demonstrably executed on chain, which is exactly
  what "the original decision is returned and no new decision is created" means.
  Worth noting for the gateway, whose `chain.ts` short-circuits on
  `tx.isReadCall` — that branch will *not* fire for a replay.

- **The transaction source is a disposable account, not the operator.**
  `authorize` needs two authorizations, `caller` (owner or operator) and the
  agent, but neither has to be the transaction *source*. A throwaway keypair,
  generated per session, signs the envelope and pays the fee while the operator
  and the agent each sign an auth entry. Auth entries carry a random nonce
  rather than a sequence number, so this session could not collide with the
  concurrent D2/D3 run submitting as the operator at the same time. The on-chain
  authorization is unchanged and still comes from the operator key — visible in
  the export as `caller` in `decision-export.json`.

- **`agentId` in the canonical preimage is the agent's Stellar address**, not a
  registry alias. These four identities are created by the run script and are
  not in `services.json`, so there is no registry `agent_id` to use; binding the
  preimage to the on-chain address is what keeps it self-verifying. The gateway
  path (D2/D3) uses the registry `agent_id` instead. `canonical_intent` treats
  the field as an opaque length-prefixed string, so both are valid canonical
  forms — but a reviewer diffing a D1 preimage against a D2 preimage should
  expect this field to differ in kind.

- **Agent secret keys are not persisted anywhere.** The four identities live
  only in the run process. They are throwaway testnet accounts whose sole
  capability is signing their own `authorize` auth entries under a policy this
  script created, and they have no funds beyond the friendbot grant. A re-run
  generates new ones; what reproduces is the *evidence*, not the identities.
  Everything a reviewer needs — addresses, policies, transaction hashes — is in
  `agents.json` and verifiable on chain.

## Reproducing

```sh
pnpm build                 # the runner imports the built dist/ of @aegis/{bindings,canonical}
bash scripts/d1-run.sh     # full 70  -> evidence/d1-authorize/
bash scripts/d1-run.sh --smoke   # 7 runs, one per scenario -> evidence/d1-authorize-smoke/
```

The script reads `.env` from the repo root and exits non-zero if any run's
verdict or reason code differs from its expectation, so a drift fails loudly
rather than being written into the table.

The plan — every amount, service, asset and the reason each row is in the set —
is `scripts/d1-plan.ts`, kept separate from the runner so it can be reviewed as
data. `clientRef` carries the session id, so a re-run produces fresh
`intent_hash` values rather than silently replaying the previous session's
decisions.
