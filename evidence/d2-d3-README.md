# D2 + D3 evidence pack

Generated 2026-09-04T07:26:14Z · Stellar **testnet** · contract [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA)

Everything SOW §6.1 asks for from D2 (Intent Gateway & Decision Binding) and D3 (Decision-Gated
Settlement), produced in one run against the live testnet deployment.

## Headline

| | Result |
|---|---|
| Gateway submissions | **20/20** reached the contract and produced a stored on-chain decision |
| Median POST → verdict | **713 ms** |
| Median POST → finality | **5628 ms** (includes one ledger close) |
| `intent_hash` recomputed from the transcript | **20/20 match**, using `xxd` and `shasum` only |
| Required refusals | **4/4 refused** (2 × `AlreadyResolved`, 2 × `NOT_APPROVED`) |
| Settlements | **10/10** on testnet |
| USDC moved | **65.8456790** — equals the sum of the ten decisions, to the stroop |
| Replay attempts | **10/10 refused**, 0 second payments |
| Independent verifier | **10/10 VERIFIED** (`--strict`, exit 0) |

## Read in this order

| File | |
|---|---|
| `d2-results.md` | the 20-submission result table, both medians, and what each field variation shows |
| `d2-approval-trail.md` | scenario 5 end to end: escalation → queue → on-chain `resolve()` → settlement |
| `d2-refusals.md` | the four refusals, and one extra attempt that found a real defect |
| `d2-window-budget.md` | the cumulative-window arithmetic the run was planned against |
| `d3-results.md` | the 10 settlements, MEMO_HASH and preimages, replays, verifier output |
| `d3-audit-receipts.md` | agent / owner / policy version / verdict / decision_id / tx_hash, per settlement |

## Raw artefacts

| File | |
|---|---|
| `d2-gateway.ndjson` | the gateway's own pino log — **the transcript**, raw and unedited |
| `d2-responses.ndjson` | client-side request/response records |
| `d2-intent-lookups.ndjson` | `GET /v1/intents/:hash` for every submission |
| `d2-preimage-recompute.txt` | the 20 hash recomputations |
| `d2-index.json` | machine-readable case index, including the `/v1/approvals` snapshot |
| `d3-receipts/*.json` | one `aegis-receipt/1` document per settlement |
| `d3-verifier/*.txt`, `*.json` | the verifier's report for each settlement |
| `d3-state.json` | every executor invocation of the run, with stdout and stderr |
| `d2-gateway-registry.effective.json` | see *Run conditions* below |

## Reproducing it

```bash
./scripts/d2-gateway.sh start        # boot the gateway, capture its log as the transcript
python3 scripts/d2-run.py            # the 20 submissions + the resolve steps
./scripts/d2-verify-preimages.sh     # recompute all 20 hashes with xxd + shasum
python3 scripts/d3-run.py            # refusals, 10 settlements, 10 replays, 10 verifications
python3 scripts/d2-d3-report.py      # regenerate these Markdown files
./scripts/d2-gateway.sh stop
```

`scripts/d2-intents.json` is the run plan: the 20 submissions and their expected verdicts are
declared there, not embedded in code, so what was intended can be diffed against what happened.

## Run conditions, stated plainly

- **Policy version 1 throughout.** No `set_policy`, `register_agent`, `revoke_agent`,
  `set_operator` or `init` call was made before, during or after this run. The threshold and caps a
  reviewer reads on chain today are the ones every decision here was judged against.
- **A second evidence run (D1) was live on the same contract**, using different agent identities. No
  submission or settlement in this pack needed a retry because of it.
- **`apps/gateway/registry.json` still pins the pre-redeploy contract** (`CAAD6727…`), while `.env`,
  `services.json` and the console all point at the current one. `Registry.load()` refuses to boot on
  that mismatch — correctly. Rather than edit `apps/**` during an evidence run, `scripts/d2-gateway.sh`
  writes a corrected copy to `d2-gateway-registry.effective.json`, changing `network.contract_id` and
  nothing else, and points the gateway at it with `GATEWAY_REGISTRY_PATH`. The copy is kept here so it
  can be diffed against the committed file. **The real fix belongs in `apps/gateway/registry.json`.**
- **The gateway ran with a real Postgres**, not degraded, so `purpose` and `client_ref` are recoverable
  through `GET /v1/intents/:hash` as well as from the transcript. It was a throwaway instance on
  `DATABASE_URL` with `pnpm --filter @aegis/gateway db:migrate` applied, and it has since been shut
  down. Reproducing this run **without** a database is fine: the gateway degrades by design and every
  file in this pack still gets produced — `canonical_hex` lives in the transcript, not in the database.
- **Scenario 6 (`AgentRevoked`) is not in this pack.** Demonstrating it means revoking `agent-1`, which
  would end its usefulness for D2/D3 evidence and change the policy version. It belongs with the D1
  contract evidence, where a disposable agent identity can be revoked.

## What did not come out clean

One defect, found by an attempt that was not required: settling a `decision_id` that does not exist
on chain is refused — correctly, no payment — but classified `SOURCE_UNAVAILABLE` (*retry later*)
instead of `DECISION_NOT_FOUND` (*the chain answered, and the answer is no*). Cause, consequence and
the one-line location are in `d2-refusals.md`. Nothing was papered over to keep a table green.
