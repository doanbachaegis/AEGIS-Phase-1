# D2 — pending-approval trail (SOW §5.2 scenario 5)

Generated 2026-09-04T07:26:14Z

One intent above the approval threshold, from submission to a payment on the ledger, with the
on-chain `resolve()` call in the middle. Three escalations were produced in all; this is the one
that went the whole way.

## The policy that escalated it

| Field | Value |
|---|---|
| agent | `agent-1` → [`GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH`](https://stellar.expert/explorer/testnet/account/GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH) |
| policy version | **1** (unchanged for the whole run) |
| `approval_threshold` | 250 000 000 stroops = 25.0000000 USDC |
| `per_intent_cap` | 500 000 000 stroops = 50.0000000 USDC |

## Step 1 — submission escalates, HTTP 202

`POST /v1/intents`, amount **30.0000000 USDC**, service `openai-api`.

- `intent_hash` `9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a`
- `decision_id` `17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0`
- verdict **RequiresApproval**, reason `PendingApproval`, HTTP **202** with `Location: /v1/decisions/17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0`
- authorize tx [`8accce1c2632f7b75548d9ce027d14cf340ae0de87766576272826ba3eb6004c`](https://stellar.expert/explorer/testnet/tx/8accce1c2632f7b75548d9ce027d14cf340ae0de87766576272826ba3eb6004c) at ledger 4496437

The §4.1 D2 rule string, rendered from the policy the contract actually held at that moment:

```json
{
  "rule": "amount 30 > threshold 25",
  "threshold": "25",
  "threshold_stroops": "250000000",
  "policy_version": 1,
  "decision_policy_version": 1,
  "resolve_url": "/v1/decisions/17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0/resolve"
}
```

The threshold is **snapshotted at escalation time** on purpose: a later `set_policy` cannot
silently change what this queue entry meant.

## Step 2 — it appears in the pending queue

`GET /v1/approvals` derives pending-ness **from the chain**: every candidate is re-read with
`get_decision` and kept only while the contract still reports `RequiresApproval` and unresolved.

At the end of the run the queue holds **1** entry — `s14`
(`7504f529518b41ce…`, 26.0000000 USDC), which was left open deliberately so the
queue is demonstrably non-empty and demonstrably filtered: `s10` and `s15` are both resolved and
neither is listed. Full snapshot in `d2-index.json` → `approvals_snapshot`.

## Step 3 — the owner resolves it on chain

`POST /v1/decisions/17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0/resolve` with `{"approve": true}`.

`resolve()` is **owner-only on chain** (`require_owner`), so the gateway's operator key cannot
stand in for it however the process is configured.

| Field | Before | After |
|---|---|---|
| verdict | RequiresApproval | **Approved** |
| `reason_code` | PendingApproval | `Ok` |
| `original_reason_code` | PendingApproval | `PendingApproval` — **unchanged** |
| `policy_version` | 1 | 1 — frozen, `decision_id` binds it |
| `resolved_policy_version` | — | 1 — the version the re-judgement ran under |
| `resolved` | false | true |

resolve tx [`3a91bc4bd295797af946a5067eb9ddac5d03aa347b4d383f0ecddd1e1e52f0e5`](https://stellar.expert/explorer/testnet/tx/3a91bc4bd295797af946a5067eb9ddac5d03aa347b4d383f0ecddd1e1e52f0e5)

The escalation survives the approval: `original_reason_code` still reads `PendingApproval`, so the
chain itself records that this spend needed a human, not just that it ended up approved.

## Step 4 — and only then can it settle

- `mark_settled` at ledger 4496517
- payment tx [`c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) at ledger 4496518
- verifier: **VERIFIED**

## The other two escalations

| Case | Amount | Outcome | reason_code | original_reason_code |
|---|--:|---|---|---|
| `s14` | 26.0000000 | still pending, never resolved | `PendingApproval` | `PendingApproval` |
| `s15` | 27.5000000 | **owner rejected** | `OwnerRejected` | `PendingApproval` |

`s15`'s refusal is on chain as tx [`d4b5200926ab14b443005842cb0c521905e80af731d5cbfb5a4025b028f672df`](https://stellar.expert/explorer/testnet/tx/d4b5200926ab14b443005842cb0c521905e80af731d5cbfb5a4025b028f672df). Both `s10` and `s15` then
refused a second `resolve()` — see `d2-refusals.md`.
