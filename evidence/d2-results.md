# D2 — Intent Gateway: 20 submissions

Generated 2026-09-04T07:26:14Z · contract [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA) · Stellar **testnet**

SOW §6.1 D2 asks for request/response transcripts for 20 submissions with varied field
combinations, a pending-approval trail, and a result table with the median decision time.

## Where the evidence is

| File | What it is |
|---|---|
| `d2-gateway.ndjson` | **The transcript.** The gateway's own pino log, raw and unedited: `intent.received` (with the full canonical preimage), `chain.submitted`, `decision.recorded`, `intent.failed`. |
| `d2-responses.ndjson` | The client side of the same conversation: exact request body, HTTP status, response body, client-observed latency. |
| `d2-intent-lookups.ndjson` | `GET /v1/intents/:intent_hash` for every submission — the decision plus the preimage the chain does not hold. |
| `d2-preimage-recompute.txt` | All 20 `intent_hash` values recomputed with `xxd` and `shasum` only. |
| `d2-index.json` | Machine-readable index: case → intent_hash, decision_id, verdict, tx_hash. |

## Recomputing a hash without AEGIS code

Every `intent.received` record carries `canonical_hex`, the exact bytes that were hashed:

```bash
echo -n <canonical_hex> | xxd -r -p | shasum -a 256   # == intent_hash
```

`./scripts/d2-verify-preimages.sh` runs that over the whole transcript. Result: **20 of 20 match**.

## Result table

All 20 submissions reached the contract and produced a stored on-chain decision: **20/20**.

| # | Case | Field variation | Service | Amount (USDC) | HTTP | Verdict | Reason | Decision id | verdict ms | finality ms |
|--:|---|---|---|--:|--:|---|---|---|--:|--:|
| 1 | `s01` | baseline: both optional fields populated | `openai-api` | 1.5000000 | 200 | **Approved** | `Ok` | `b62b0ce89c7e3f09…` | 1061 | 8931 |
| 2 | `s02` | second allowed service | `anthropic-api` | 2.2500000 | 200 | **Approved** | `Ok` | `94d56d8ca36958d3…` | 646 | 5769 |
| 3 | `s03` | empty purpose (hashed as a zero-length string) | `openai-api` | 3.0000000 | 200 | **Approved** | `Ok` | `c4d77369099a58ef…` | 685 | 3407 |
| 4 | `s04` | empty client_ref | `anthropic-api` | 4.5000000 | 200 | **Approved** | `Ok` | `7ae3e83b024a3813…` | 760 | 5751 |
| 5 | `s05` | both optional fields empty | `openai-api` | 5.0000000 | 200 | **Approved** | `Ok` | `60dcb6be99ae41da…` | 705 | 5830 |
| 6 | `s06` | 1024-byte purpose (canonical str16 field) | `anthropic-api` | 6.2500000 | 200 | **Approved** | `Ok` | `f188da8765686e2a…` | 805 | 4168 |
| 7 | `s07` | 255-byte client_ref (canonical str8 field at its maximum) | `openai-api` | 7.5000000 | 200 | **Approved** | `Ok` | `d49f94af3cf2c678…` | 731 | 4424 |
| 8 | `s08` | whole-number amount | `anthropic-api` | 8.0000000 | 200 | **Approved** | `Ok` | `541a7dd79996581c…` | 638 | 5783 |
| 9 | `s09` | amount just under the approval threshold band | `openai-api` | 9.7500000 | 200 | **Approved** | `Ok` | `75989785dcc5e742…` | 807 | 3951 |
| 10 | `s10` | amount above approval_threshold (25 USDC), below per_intent_cap (50 USDC) | `openai-api` | 30.0000000 | 202 | **RequiresApproval** | `PendingApproval` | `17594051cc98c12d…` | 710 | 5968 |
| 11 | `s11` | amount above per_intent_cap | `openai-api` | 75.0000000 | 200 | **Rejected** | `CapExceeded` | `c942b69f7af06b01…` | 738 | 4091 |
| 12 | `s12` | service_id outside Policy.allowed_services | `aws-bedrock` | 5.0000000 | 200 | **Rejected** | `ServiceNotAllowed` | `9a8e398f4db01ce3…` | 641 | 5554 |
| 13 | `s13` | asset that is not Policy.allowed_asset | `openai-api` | 5.0000000 | 200 | **Rejected** | `AssetMismatch` | `fac6528a6d9d1469…` | 716 | 3879 |
| 14 | `s14` | second escalation, deliberately left unresolved | `anthropic-api` | 26.0000000 | 202 | **RequiresApproval** | `PendingApproval` | `7504f529518b41ce…` | 657 | 5762 |
| 15 | `s15` | third escalation, to be refused by the owner | `openai-api` | 27.5000000 | 202 | **RequiresApproval** | `PendingApproval` | `03defcb77539553d…` | 695 | 8744 |
| 16 | `s16` | byte-identical resubmission of s01 (idempotency on intent_hash) | `openai-api` | 1.5000000 | 200 | **Approved** | `Ok` | `b62b0ce89c7e3f09…` | 734 | 4086 |
| 17 | `s17` | byte-identical resubmission of a REJECTED intent | `openai-api` | 75.0000000 | 200 | **Rejected** | `CapExceeded` | `c942b69f7af06b01…` | 644 | 5302 |
| 18 | `s18` | one stroop, the smallest representable amount | `openai-api` | 0.0000001 | 200 | **Approved** | `Ok` | `37c793a5e1e79f41…` | 790 | 5702 |
| 19 | `s19` | seven decimal places, full stroop precision | `anthropic-api` | 12.3456789 | 200 | **Approved** | `Ok` | `3c605cc0e1fe58e2…` | 658 | 3965 |
| 20 | `s20` | 2048-byte purpose plus a whole-number amount | `openai-api` | 1.0000000 | 200 | **Approved** | `Ok` | `c1e498ed8b8797e8…` | 724 | 5989 |

Verdicts as first recorded: **13 Approved · 4 Rejected · 3 RequiresApproval**.
Two of the three escalations were then resolved by the owner (see `d2-approval-trail.md`),
which rewrites `reason_code` but never `original_reason_code`.

### Which variation each case exercises

| Case | What it is there to show |
|---|---|
| `s03`, `s04`, `s05` | empty `purpose`, empty `client_ref`, and both empty — zero-length strings inside the canonical preimage |
| `s06`, `s20` | 1 024- and 2 048-byte `purpose` — the two-byte length prefix of canonical field 5 |
| `s07` | 255-byte `client_ref` — canonical field 6 at its maximum |
| `s08`, `s20` | whole-number amounts |
| `s18` | `0.0000001` — one stroop, the smallest representable amount |
| `s19` | `12.3456789` — full seven-decimal precision, carried to the ledger without rounding |
| `s11` | amount above `per_intent_cap` → `CapExceeded` |
| `s12` | `service_id` outside `Policy.allowed_services` → `ServiceNotAllowed`, judged on chain, not filtered by the gateway |
| `s13` | a non-policy asset (EURC) that resolves to a real SAC → `AssetMismatch` from the contract |
| `s10`, `s14`, `s15` | amounts above `approval_threshold` → three escalations: approved, left pending, owner-rejected |
| `s16`, `s17` | byte-identical resubmissions of `s01` and `s11` → the same `decision_id`, no second decision |

### Idempotency (SOW §5.2 scenario 7)

| Replay | Of | Same intent_hash | Same decision_id | New decision created |
|---|---|---|---|---|
| `s16` | `s01` | yes | yes | no |
| `s17` | `s11` | yes | yes | no |

## Decision time — two medians, never one

| Measurement | What it answers | Median over 20 | Min | Max |
|---|---|--:|--:|--:|
| POST → verdict | how fast can the agent be told? (known from the simulation) | **713 ms** | 638 ms | 1061 ms |
| POST → finality | how fast is the decision durable? (includes a ledger close) | **5628 ms** | 3407 ms | 8931 ms |

The two differ by roughly a ledger close (~5 s on testnet). Reporting a single number would
invite the wrong conclusion about whichever question the reader had in mind, so both are given.

§7.2's *"< 2 sec"* is scoped there as a **roadmap figure, not an acceptance criterion**. Against it:
the verdict median of **713 ms** is inside it; the finality median of **5628 ms** is not, and
cannot be — Stellar closes a ledger about every 5 seconds and no amount of gateway tuning changes
that. Nothing here was tuned to flatter either number.

The two `resolve()` calls, measured the same way: verdict 668 ms / 797 ms, finality 4755 ms / 4917 ms.

## Run conditions

- Gateway: `caller_role` **operator**, database **postgres**, registry version 1.
- Agent `agent-1` = [`GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH`](https://stellar.expert/explorer/testnet/account/GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH), policy **version 1** throughout — no `set_policy` call was made during or around this run.
- A second evidence run (D1) was executing against the same contract with different agent identities at the same time. No submission in this table needed a retry.
