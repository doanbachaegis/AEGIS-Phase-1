# §6.1 artifact index

Every artifact SOW §6.1 asks for, mapped to the file that satisfies it — and, where one does not
exist yet, said so plainly rather than omitted.

Status uses §6.2's own vocabulary:

| | |
|---|---|
| ✅ **Present** | the artifact exists and is complete |
| 🟡 **Partial** | part of the artifact exists; the gap is named in the row |
| ❌ **Missing** | the artifact does not exist yet; the reason is named in the row |

Paths are relative to `evidence/` unless they start with a directory that exists at the repository
root (`tools/`, `packages/`, `apps/`, `contracts/`).

**Start with `README.md` in this directory** — it explains how to verify each claim below.

---

## Deliverable 1 — On-Chain Authorization Contract

| §6.1 artifact | Status | Where |
|---|---|---|
| Deployed Testnet contract ID with Stellar Expert link | ✅ Present | [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA) — carried at the top of `d1-authorize/README.md`, `d2-results.md`, `d3-results.md` and `d3-audit-receipts.md` |
| Source repository | ✅ Present | <https://github.com/doanbachaegis/AEGIS-Phase-1> — public; contract source in `contracts/authorization/` |
| Adversarial test suite output | ✅ Present | `d1-adversarial-suite.txt` — `cargo test`, **59 tests, 0 failures** (55 contract + 4 canonical-vector) |
| Decision export for all 70 runs: `decision_id`, `intent_hash`, `policy_version`, `verdict`, `reason_code`, `ledger_seq` | ✅ Present | `d1-authorize/decision-export.json` and `.csv` — all six fields, with `u32 → name` translations alongside |
| Result table for 70 runs across the 7 scenarios | ✅ Present | `d1-authorize/results.md` — **70/70**, verdict *and* reason code checked on every run |

**Supporting, beyond what §6.1 lists:** `d1-authorize/runs.ndjson` (one raw record per run, including
the exact canonical preimage that was hashed), `d1-authorize/agents.json` (the four agent identities,
their policies, and their registration/revocation transactions), `d1-authorize/README.md` (the run
design — why fresh identities, why the window never became the binding constraint, and the
check-ordering evidence).

The adversarial areas §4.1 D1 names are covered by tests in `d1-adversarial-suite.txt`: access
control (`stranger_cannot_mark_settled`, `owner_can_authorize_while_a_distinct_operator_is_configured`,
`the_agent_must_still_sign_even_when_the_caller_is_the_owner`), replay
(`replay_of_a_settled_intent_hash_returns_the_original_decision`, `replay_does_not_increase_window_spend`),
revocation (`scenario_6_revoked_agent_is_rejected`, `settlement_is_refused_after_the_agent_is_revoked`,
`resolve_refuses_to_approve_a_revoked_agent`), stale policy version
(`set_policy_bumps_version_and_leaves_existing_decisions_untouched`,
`resolved_decision_keeps_the_policy_version_that_named_it`), double resolve
(`resolve_on_non_pending_decision_fails`), and cumulative-window boundaries
(`cumulative_window_boundary`, `window_resets_in_new_epoch`, `resolve_cannot_push_the_window_past_its_cap`).

---

## Deliverable 2 — Intent Gateway & Decision Binding

| §6.1 artifact | Status | Where |
|---|---|---|
| Request and response transcripts for the 20 submissions | ✅ Present | `d2-gateway.ndjson` (the gateway's own log, raw and unedited — carries the full canonical preimage per intent), `d2-responses.ndjson` (client side: exact request body, HTTP status, response body, latency), `d2-intent-lookups.ndjson` (`GET /v1/intents/:hash` for every submission) |
| Published canonical serialization spec | ✅ Present | `packages/canonical/SPEC.md` — implemented twice, in Rust and TypeScript, both asserting against `vectors/canonical-vectors.json`; §5 covers the asset mapping |
| Pending-approval trail for scenario 5, including the on-chain `resolve()` call | ✅ Present | `d2-approval-trail.md` — case `s10` end to end: escalation → queue → owner `resolve()` on chain → settlement, with the tx hash of each step |
| Record of the two double-resolve attempts and the two bypass attempts, both refused | ✅ Present | `d2-refusals.md` — 4/4 refused (2 × `AlreadyResolved` HTTP 409, 2 × `NOT_APPROVED` exit 1) |
| Result table for 20 runs plus median decision time | ✅ Present | `d2-results.md` — **20/20**; median POST → verdict **713 ms**, median POST → finality **5628 ms** |

**Supporting:** `d2-preimage-recompute.txt` (all 20 hashes recomputed with `xxd` and `shasum` only —
20/20 match), `d2-window-budget.md` (the cumulative-window arithmetic the run was planned against),
`d2-index.json` (machine-readable case index plus the `/v1/approvals` snapshot),
`d2-gateway-registry.effective.json` (see *Known gaps* below).

**Two medians, not one.** §6.1 asks for "the median decision time". Reporting a single number would
be misleading, because the two questions a reader might have — *how fast can the agent be told?* and
*how fast is the decision durable?* — have different answers separated by one Stellar ledger close.
Both are given, in `d2-results.md`.

---

## Deliverable 3 — Decision-Gated Settlement & Audit Receipt

| §6.1 artifact | Status | Where |
|---|---|---|
| 10 Testnet transaction hashes with Stellar Expert links | ✅ Present | `d3-results.md` — full hashes and links; re-checked against Horizon 2026-09-04, **all 10 resolve and report `successful: true`** |
| `MEMO_HASH` and receipt preimage for each | ✅ Present | `d3-results.md` — the 68-byte preimage per settlement; also in each `d3-receipts/*.json` as `settlement.memo_preimage` |
| Audit receipt joining agent, owner, policy version, verdict, `decision_id`, `tx_hash` | ✅ Present | `d3-audit-receipts.md` — all six fields per settlement, each with the source it was read from; machine-readable in `d3-receipts/` |
| Record of the 10 replay attempts showing no second payment | ✅ Present | `d3-results.md` — **10 attempts, 10 refusals, 0 payments**; proven three independent ways (balances, executor gate, verifier memo scan) |
| Standalone verifier script and its output | ✅ Present | `tools/verifier/` (the tool, with its own README) and `d3-verifier/` (per-settlement reports, `.txt` and `.json`) — **10/10 VERIFIED, 21/21 checks, exit 0, `--strict`** |
| Result table for 10 runs | ✅ Present | `d3-results.md` |

**Supporting:** `d3-state.json` (every executor invocation of the run with stdout and stderr),
`d2-d3-README.md` (how the run was produced and under what conditions).

The verifier reads Horizon and Soroban RPC only — never the AEGIS API, never the generated bindings.
`README.md` §3.6 explains how to run it yourself and what its four exit codes mean, including why
exit `3` must never be read as a pass.

---

## Deliverable 4 — Reviewer Verification Console & Evidence Pack

| §6.1 artifact | Status | Where |
|---|---|---|
| Public link to the console, *"the primary evidence for the Ambassador to open and search"* | ✅ Present | **<https://aegis-production-2216.up.railway.app>** — live, no login, no setup. Paste any reference from `d4-intent-references.md` into the lookup box, or open a decision directly at `/intent/<intent_hash>` or `/decision/<decision_id>`. Verified by 82 real page loads in `d4-results.md` |
| List of intent references for testing | ✅ Present | `d4-intent-references.md` — the 10 settled, the 20 D2 submissions, and all 70 D1 decisions, each with `intent_hash`, `decision_id`, expected and observed verdict, reason code, and tx hash where settled |
| Screenshot of one approved intent showing the full chain and one refused intent showing its reason code | ✅ Present | `d4-screenshots/` — **`approved-full-chain.png`** (case `s10`: policy escalated it → owner `resolve()` on chain → settled, `memo_hash()` and all) and **`refused-owner-rejected.png`** (case `s15`: `Rejected` / `OwnerRejected`, with the `original_reason_code` `PendingApproval` the contract never rewrote). Two further refusals — `AgentRevoked` and `CapExceeded` — are included, and `d4-screenshots/README.md` says why each was chosen |
| Result table showing 70/70 decisions viewable and 10/10 transaction links live | ✅ Present | `d4-results.md` — **70/70** decisions rendered with the correct verdict *and* reason code, and **10/10** transaction links live, each bound to its decision by a `MEMO_HASH` match. Produced by loading all 80 references in a real browser, plus 3 controls that had to find nothing. The console renders each transaction link itself, having found it by scanning the public ledger for the memo the contract commits to — the bounds of that search are stated under *Known gaps* below |
| Consolidated evidence pack for D1 to D3 | ✅ Present | this directory; `INDEX.md` (this file) is its map and `README.md` its front door |
| Reviewer README and public repo link | ✅ Present | `README.md` in this directory; repo <https://github.com/doanbachaegis/AEGIS-Phase-1> (public — verified) |

**Supporting:** `d4-console-verification.json` (every one of the 82 page loads, with what the page
rendered and the SHA-256 of its rendered text), `d4-screenshots/README.md` (why each reference was
chosen, and the one cosmetic defect the images record rather than crop).

**How the D4 numbers were produced, in one line:** a headless Chrome loaded every reference against
the live console and the verdict and reason code were read back out of the rendered DOM — not
fetched from RPC by the checking script, which would have proved only that the data resolves.
`scripts/d4-console-verify.mjs` is the run; `scripts/d4-report.py` renders `d4-results.md` from it.
Both are re-runnable, and `d4-results.md` states plainly what the method does **not** prove.

---

## Known gaps, stated plainly

**1. The settlement transaction link is *searched for*, not stored — and the search is bounded.**

The console at <https://aegis-production-2216.up.railway.app> renders all **10/10** settlement
transaction links, but it is worth being exact about where they come from, because it is not where a
reviewer would assume.

The contract records **that** a decision was settled and never **which** Stellar transaction did it,
so there is no `settlement_tx_hash` on-chain. The obvious fix — have the AEGIS API name the
transaction — would ask a reviewer to trust the party under review to name its own receipt, and this
deployment could not do it anyway (`/health` reports `database: degraded`, which is also why
`purpose` and `client_ref` are absent). So the page instead **searches** the published settlement
accounts on Horizon for a transaction whose `MEMO_HASH` equals the `memo_hash()` the contract
returned, and tags the result *derived from ledger* — a third provenance tier, neither *read from
chain* nor *display only*. §6.3's *"independently of the AEGIS database"* is preserved: Horizon is
Stellar infrastructure, and the same request works from any browser tab.

**The limits of that search, stated rather than discovered:**

- It walks the **last 1000 transactions** of the accounts in `VITE_SETTLEMENT_ACCOUNTS` — the
  executor and the payee from `services.json`. Horizon has no global memo index, so "on the network"
  is approximated by "in the history of the accounts a settlement must touch". When the walk stops at
  that cap the page says so, and an absence found that way is not proof of absence. At Phase 1
  volumes the ten settlements are on the first page; a long-lived deployment would need a cursor.
- **A miss never contradicts `settled`.** That flag is the contract's own answer and is rendered from
  the contract. A failed or unreachable search is reported as a statement about the *search*.
- If the memo appeared on **two** transactions the page would list both rather than pick one — a
  decision settles once, so the discrepancy would be the finding.
- The search needs the accounts to be configured. Unset `VITE_SETTLEMENT_ACCOUNTS` and the card says
  the search was not configured; it never reports a decision as unsettled on that basis.

The binding is closed in both directions and independently: `d4-results.md` §B compares each
transaction's real `MEMO_HASH` against the `memo_hash()` **the page rendered**, and separately
confirms that the hash the browser found equals the one in the settlement receipt. Those two routes
never share a source.

**2. `apps/gateway/registry.json` pins a stale contract ID.**

It still names the pre-redeploy contract (`CAAD6727…`) while `.env`, `services.json` and the console
point at the current one. `Registry.load()` refuses to boot on that mismatch — correctly. The
evidence run worked around it with a corrected copy (`d2-gateway-registry.effective.json`, kept here
so it can be diffed against the committed file, changing `network.contract_id` and nothing else)
rather than editing `apps/**` mid-run. **The fix belongs in the committed file.**

**3. One defect in the executor's error classification, found and not papered over.**

Settling a non-existent `decision_id` is correctly refused with no payment, but is classified
`SOURCE_UNAVAILABLE` (*retry later*) instead of `DECISION_NOT_FOUND` (*the chain answered, and the
answer is no*). Not a safety defect — no money moves either way — but a retry loop would spin
forever. Root cause, consequence and the one-line location are in `d2-refusals.md`; summarised in
`README.md` Part 7.

**4. `tools/verifier/README.md` has a stale "Status" section.**

It still states that the Horizon-side checks "have no live subject yet" because "the executor is
still a skeleton". That was true when written and is now false — ten settlements exist and all ten
verify. The tool is correct; only its README is out of date, and the example receipt in it shows the
old contract ID.

**5. Scenario 6 (`AgentRevoked`) is demonstrated in D1 only, not through the gateway.**

Demonstrating it in the D2/D3 run would mean revoking `agent-1`, which would end its usefulness for
the rest of that evidence and change the policy version mid-run. It belongs with the D1 contract
evidence, where disposable agent identities can be revoked — and there it is exercised ten times,
including five runs that break a second rule simultaneously to prove revocation outranks everything.

---

## Corrections owed to the SOW text, not to the code

Recorded here because a reviewer comparing the SOW against the delivery will hit them, and they are
document defects rather than implementation gaps. Full reasoning in `DECISIONS.md`.

| SOW text | Issue |
|---|---|
| §4.1 D1: *"`intent_hash` is single-use"* | §5.2 scenario 7 and §6.3 both require it to be **idempotent**. The contract is idempotent, because that is the behaviour being scored; the D1 wording needs correcting (`DECISIONS.md` #1). |
| §4.1 D1: the printed `authorize` signature | It omits the `caller` parameter, which is now the **first** argument of `authorize` and `mark_settled` (`DECISIONS.md` #7). The printed signature is wrong as written. |
| §5.2 reason-code enum | It never names the cumulative-window code (the contract uses `WindowCapExceeded`, code `5`) nor the owner-rejection code (`OwnerRejected`, code `7`), though §5.2 tests the window boundary and §4.1 requires owner rejection (`DECISIONS.md` #3). |
| §7.2: *"< 2 sec"* | Scoped there as a roadmap figure rather than an acceptance criterion. The verdict median (**713 ms**) is inside it; the finality median (**5628 ms**) cannot be, because Stellar closes a ledger about every 5 seconds. Both numbers are reported in `d2-results.md`. |

---

## The two Phase 1 trust boundaries

Not §6.1 artifacts, but a reviewer scoring the trust model needs them and should not have to dig
them out of `DECISIONS.md`. Both are written out in full in `README.md` Part 4.

| | Boundary | Effect |
|---|---|---|
| `DECISIONS.md` #6 | Phase 1 trusts the **executor key** | the memo commitment makes misuse **detectable, not impossible** |
| `DECISIONS.md` #10 | The gateway holds the **agents' secret keys** | *"a leaked operator key cannot impersonate another agent"* holds **on chain but not in this deployment** — both signatures come from one trust domain |
