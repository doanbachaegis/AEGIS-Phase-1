# Postman collection — driving the gateway by hand

Two files:

| File | What it is |
| --- | --- |
| `AEGIS-Phase1.postman_collection.json` | 14 requests in 6 folders, each with assertions on `verdict` and `reason_code` |
| `AEGIS-testnet.postman_environment.json` | `base_url` (the deployed gateway) and an **empty** `write_key` |

Nothing here is a mock. Every `POST` reaches the Soroban contract and writes a `Decision`
on chain; the reads come straight out of contract storage.

## Setup

1. Import both files (Postman → *Import*), then select the **AEGIS — testnet (Railway)**
   environment.
2. Paste `AEGIS_WRITE_KEY` into the environment's `write_key` value. It is typed `secret`
   and is **deliberately left empty in the committed file** — exporting a collection with a
   key in it publishes the key. Reads need no key at all.
3. Run the folders top to bottom. `decision_id` and `intent_hash` are captured from the
   responses, so folder 5 looks up what folder 2 created.

Headless, same collection:

```
newman run docs/postman/AEGIS-Phase1.postman_collection.json \
  -e docs/postman/AEGIS-testnet.postman_environment.json \
  --env-var "write_key=$AEGIS_WRITE_KEY"
```

## Four things that look like bugs and are not

- **A rejection is HTTP 200.** The policy was evaluated and a verdict was reached — nothing
  failed. Branch on `verdict` in the body, never on `res.ok`. Only a malformed or
  unauthorized request gets a 4xx.
- **Re-sending an identical body returns the original decision.** `intent_hash` is a pure
  function of the six intent fields, so a byte-identical intent is the *same* intent, not a
  new one. The collection's pre-request script varies `client_ref` for exactly this reason;
  one request pins it on purpose to demonstrate the replay.
- **A response takes ~5–8 s, not the ~700 ms in the evidence pack.** Both numbers are in
  every response under `timings_ms`: `verdict_ms` is the contract ruling, `finality_ms`
  includes waiting for the ledger to close. The evidence pack reports the first.
- **`/v1/approvals` can come back empty right after an escalation.** This deploy runs
  `database: degraded`, so the pending index lives in the process and a restart clears it.
  The decisions themselves are on chain — `GET /v1/decisions/{id}` still returns them.

## Budget

The live policy for `agent-1` caps cumulative approved spend at **200 USDC per 24 h**. The
first pass of this collection approves 70 USDC of that (20 + 20 replay + 30 after resolve);
every later pass approves 50, because the replay request returns its original decision instead
of spending again. So roughly three passes fit in a 24 h window before `WindowCapExceeded`
starts answering. That is the policy working, but it is worth knowing before a demo rather
than during one.

## What this collection cannot show

Settlement. The gateway issues verdicts and never moves money; paying out is a separate
executor CLI (`node apps/executor/dist/cli.js settle --decision <decision_id>`). That
separation is the point — see `DECISIONS.md` — but it means an `Approved` response is an
authorization, not a payment.
