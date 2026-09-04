# D1 - authorize runs (SOW 6.1 D1, 6.3 criterion 1)

- Session: `20260904T070836Z`
- Contract: `CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA` (testnet)
- Runs: **70 / 70 passed** (verdict AND reason code both as expected, and the decision readable back on chain)

## Reason codes

`reason_code` is a `u32` on the wire. SOW 5.2 names them in SCREAMING_SNAKE; the mapping is:

| u32 | name |
| --- | --- |
| 0 | `Ok` |
| 1 | `CapExceeded` |
| 2 | `ServiceNotAllowed` |
| 3 | `AssetMismatch` |
| 4 | `AgentRevoked` |
| 5 | `WindowCapExceeded` |
| 6 | `PendingApproval` |
| 7 | `OwnerRejected` |

`verdict` is likewise a `u32`: 0 `Approved`, 1 `Rejected`, 2 `RequiresApproval`.

## Scenario summary

| # | Scenario | Expected verdict / reason | Runs | Passed |
| --- | --- | --- | --- | --- |
| 1 | Compliant intent | Approved / Ok | 10 | 10 |
| 2 | Amount over per_intent_cap | Rejected / CapExceeded | 10 | 10 |
| 3 | Service not whitelisted | Rejected / ServiceNotAllowed | 10 | 10 |
| 4 | Asset not the policy asset | Rejected / AssetMismatch | 10 | 10 |
| 5 | Above approval_threshold, at or under per_intent_cap | RequiresApproval / PendingApproval | 10 | 10 |
| 6 | Revoked agent | Rejected / AgentRevoked | 10 | 10 |
| 7 | Replay of an already-authorized intent_hash | original decision returned unchanged | 10 | 10 |

## All runs

| # | Scn | Agent | Service | Asset | Amount | Expected | Observed verdict | reason_code | policy_v | ledger_seq | decision_id | Pass |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | --- | :---: |
| 1 | 1 | compliant | `openai-api` | USDC | 1 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496439 | `37ba5f064522...` | PASS |
| 2 | 1 | compliant | `anthropic-api` | USDC | 2.5 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496441 | `c177db1ad47a...` | PASS |
| 3 | 1 | compliant | `openai-api` | USDC | 4.75 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496443 | `510dfd9c5002...` | PASS |
| 4 | 1 | compliant | `anthropic-api` | USDC | 7 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496445 | `b5b819ebd909...` | PASS |
| 5 | 1 | compliant | `openai-api` | USDC | 9.9999999 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496447 | `40a865d180b7...` | PASS |
| 6 | 1 | compliant | `anthropic-api` | USDC | 12.34 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496449 | `55ae5ac7c7ea...` | PASS |
| 7 | 1 | compliant | `openai-api` | USDC | 15 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496451 | `6d68b160c443...` | PASS |
| 8 | 1 | compliant | `anthropic-api` | USDC | 18.75 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496453 | `63e95f08b307...` | PASS |
| 9 | 1 | compliant | `openai-api` | USDC | 22 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496455 | `8fae4f435efb...` | PASS |
| 10 | 1 | compliant | `anthropic-api` | USDC | 25 | Approved / Ok | Approved | 0 `Ok` | 1 | 4496457 | `f4f74405eb37...` | PASS |
| 11 | 2 | limits | `openai-api` | USDC | 50.0000001 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496459 | `408cf2f0935d...` | PASS |
| 12 | 2 | limits | `anthropic-api` | USDC | 60 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496461 | `f8e0e1e63754...` | PASS |
| 13 | 2 | limits | `openai-api` | USDC | 75 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496463 | `d15fa65d8283...` | PASS |
| 14 | 2 | limits | `anthropic-api` | USDC | 99.9999999 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496465 | `bcce910b3f52...` | PASS |
| 15 | 2 | limits | `openai-api` | USDC | 100 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496467 | `066a6a9cb511...` | PASS |
| 16 | 2 | limits | `anthropic-api` | USDC | 123.45 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496469 | `57e923505f64...` | PASS |
| 17 | 2 | limits | `openai-api` | USDC | 250 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496471 | `e69f9826e6f2...` | PASS |
| 18 | 2 | limits | `anthropic-api` | USDC | 500 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496473 | `ec88a1d62bef...` | PASS |
| 19 | 2 | limits | `openai-api` | USDC | 1000 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496475 | `7d2306e48974...` | PASS |
| 20 | 2 | limits | `anthropic-api` | USDC | 9999.9999999 | Rejected / CapExceeded | Rejected | 1 `CapExceeded` | 1 | 4496477 | `a5aaa7fc5114...` | PASS |
| 21 | 3 | mismatch | `stability-api` | USDC | 0.5 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496479 | `d832df75af0d...` | PASS |
| 22 | 3 | mismatch | `google-vertex` | USDC | 1.2 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496481 | `ab9005b7c3a1...` | PASS |
| 23 | 3 | mismatch | `cohere-api` | USDC | 3 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496483 | `6f1ad0a952de...` | PASS |
| 24 | 3 | mismatch | `mistral-api` | USDC | 4.5 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496485 | `ac627fa8d21f...` | PASS |
| 25 | 3 | mismatch | `replicate-api` | USDC | 6 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496487 | `f4f3f233c42f...` | PASS |
| 26 | 3 | mismatch | `huggingface-api` | USDC | 8.8 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496489 | `5fe15f5568aa...` | PASS |
| 27 | 3 | mismatch | `elevenlabs-api` | USDC | 15 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496491 | `c70e6f5513cb...` | PASS |
| 28 | 3 | mismatch | `OpenAI-API` | USDC | 26 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496493 | `9c128f273e4a...` | PASS |
| 29 | 3 | mismatch | `openai-api-v2` | USDC | 60 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496495 | `fb1ddecc6553...` | PASS |
| 30 | 3 | mismatch | `openai-api ` | USDC | 1.5 | Rejected / ServiceNotAllowed | Rejected | 2 `ServiceNotAllowed` | 1 | 4496497 | `b8bcd6b6383f...` | PASS |
| 31 | 4 | mismatch | `openai-api` | XLM | 0.8 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496499 | `c3ed7752f076...` | PASS |
| 32 | 4 | mismatch | `anthropic-api` | XLM | 2 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496501 | `ef6bd07564a1...` | PASS |
| 33 | 4 | mismatch | `openai-api` | XLM | 5.5 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496503 | `1e90628c4348...` | PASS |
| 34 | 4 | mismatch | `anthropic-api` | XLM | 12 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496505 | `ff6f915a9b59...` | PASS |
| 35 | 4 | mismatch | `openai-api` | XLM | 24 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496507 | `09618457eac4...` | PASS |
| 36 | 4 | mismatch | `anthropic-api` | EURC | 0.95 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496509 | `331dc90eadac...` | PASS |
| 37 | 4 | mismatch | `openai-api` | EURC | 3.3 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496511 | `4dcf053efe16...` | PASS |
| 38 | 4 | mismatch | `anthropic-api` | EURC | 17.5 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496513 | `4e6c02a63bc7...` | PASS |
| 39 | 4 | mismatch | `openai-api` | EURC | 30 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496515 | `aabb98be43cc...` | PASS |
| 40 | 4 | mismatch | `anthropic-api` | EURC | 75 | Rejected / AssetMismatch | Rejected | 3 `AssetMismatch` | 1 | 4496517 | `ce4efb19a102...` | PASS |
| 41 | 5 | limits | `openai-api` | USDC | 25.0000001 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496519 | `1d651d411289...` | PASS |
| 42 | 5 | limits | `anthropic-api` | USDC | 26 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496521 | `5994dc08b3be...` | PASS |
| 43 | 5 | limits | `openai-api` | USDC | 30 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496523 | `2a3be4669e88...` | PASS |
| 44 | 5 | limits | `anthropic-api` | USDC | 33.3333333 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496525 | `f97d0c24ee73...` | PASS |
| 45 | 5 | limits | `openai-api` | USDC | 37.5 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496527 | `cc85a311394a...` | PASS |
| 46 | 5 | limits | `anthropic-api` | USDC | 40 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496529 | `bca4ee8ef5db...` | PASS |
| 47 | 5 | limits | `openai-api` | USDC | 44.4444444 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496531 | `e6626156dec0...` | PASS |
| 48 | 5 | limits | `anthropic-api` | USDC | 47.5 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496533 | `bfd69205d214...` | PASS |
| 49 | 5 | limits | `openai-api` | USDC | 49.9999999 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496535 | `9959dd830f76...` | PASS |
| 50 | 5 | limits | `anthropic-api` | USDC | 50 | RequiresApproval / PendingApproval | RequiresApproval | 6 `PendingApproval` | 1 | 4496537 | `f4c5185e93d1...` | PASS |
| 51 | 6 | revoked (revoked) | `openai-api` | USDC | 1 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496539 | `d55798d442c6...` | PASS |
| 52 | 6 | revoked (revoked) | `anthropic-api` | USDC | 25 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496541 | `0a88a05e1063...` | PASS |
| 53 | 6 | revoked (revoked) | `openai-api` | USDC | 50 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496543 | `6576903a68ea...` | PASS |
| 54 | 6 | revoked (revoked) | `anthropic-api` | USDC | 60 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496545 | `3f2a21e39d8b...` | PASS |
| 55 | 6 | revoked (revoked) | `openai-api` | USDC | 30 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496547 | `e59dfab14b43...` | PASS |
| 56 | 6 | revoked (revoked) | `stability-api` | USDC | 1.5 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496549 | `9edf6429a9d2...` | PASS |
| 57 | 6 | revoked (revoked) | `openai-api` | XLM | 4.5 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496551 | `6fb3d3636177...` | PASS |
| 58 | 6 | revoked (revoked) | `google-vertex` | EURC | 9999.9999999 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496553 | `2950696a1a3a...` | PASS |
| 59 | 6 | revoked (revoked) | `anthropic-api` | USDC | 7.5 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496555 | `f70462f846b1...` | PASS |
| 60 | 6 | revoked (revoked) | `openai-api` | USDC | 12.5 | Rejected / AgentRevoked | Rejected | 4 `AgentRevoked` | 1 | 4496557 | `46cd727e7655...` | PASS |
| 61 | 7 | compliant | `openai-api` | USDC | 1 | Approved / Ok (unchanged) | Approved | 0 `Ok` | 1 | 4496439 | `37ba5f064522...` | PASS |
| 62 | 7 | compliant | `openai-api` | USDC | 9.9999999 | Approved / Ok (unchanged) | Approved | 0 `Ok` | 1 | 4496447 | `40a865d180b7...` | PASS |
| 63 | 7 | compliant | `anthropic-api` | USDC | 25 | Approved / Ok (unchanged) | Approved | 0 `Ok` | 1 | 4496457 | `f4f74405eb37...` | PASS |
| 64 | 7 | limits | `openai-api` | USDC | 50.0000001 | Rejected / CapExceeded (unchanged) | Rejected | 1 `CapExceeded` | 1 | 4496459 | `408cf2f0935d...` | PASS |
| 65 | 7 | limits | `anthropic-api` | USDC | 9999.9999999 | Rejected / CapExceeded (unchanged) | Rejected | 1 `CapExceeded` | 1 | 4496477 | `a5aaa7fc5114...` | PASS |
| 66 | 7 | mismatch | `OpenAI-API` | USDC | 26 | Rejected / ServiceNotAllowed (unchanged) | Rejected | 2 `ServiceNotAllowed` | 1 | 4496493 | `9c128f273e4a...` | PASS |
| 67 | 7 | mismatch | `openai-api` | EURC | 30 | Rejected / AssetMismatch (unchanged) | Rejected | 3 `AssetMismatch` | 1 | 4496515 | `aabb98be43cc...` | PASS |
| 68 | 7 | limits | `openai-api` | USDC | 25.0000001 | RequiresApproval / PendingApproval (unchanged) | RequiresApproval | 6 `PendingApproval` | 1 | 4496519 | `1d651d411289...` | PASS |
| 69 | 7 | limits | `anthropic-api` | USDC | 50 | RequiresApproval / PendingApproval (unchanged) | RequiresApproval | 6 `PendingApproval` | 1 | 4496537 | `f4c5185e93d1...` | PASS |
| 70 | 7 | revoked (revoked) | `google-vertex` | EURC | 9999.9999999 | Rejected / AgentRevoked (unchanged) | Rejected | 4 `AgentRevoked` | 1 | 4496553 | `2950696a1a3a...` | PASS |

## Scenario 7 - replay detail

A replay must return the ORIGINAL decision: same `decision_id`, same `ledger_seq`, no new decision written. The replay transaction lands in a later ledger, and the gap between that ledger and the stored `ledger_seq` is what shows the decision was not rewritten.

| # | Replay of run | decision_id same | ledger_seq same | stored ledger_seq | replay tx ledger | new decision? |
| --- | --- | :---: | :---: | ---: | ---: | :---: |
| 61 | 1 (scenario 1) | yes | yes | 4496439 | 4496559 | no |
| 62 | 5 (scenario 1) | yes | yes | 4496447 | 4496561 | no |
| 63 | 10 (scenario 1) | yes | yes | 4496457 | 4496563 | no |
| 64 | 11 (scenario 2) | yes | yes | 4496459 | 4496565 | no |
| 65 | 20 (scenario 2) | yes | yes | 4496477 | 4496567 | no |
| 66 | 28 (scenario 3) | yes | yes | 4496493 | 4496569 | no |
| 67 | 39 (scenario 4) | yes | yes | 4496515 | 4496571 | no |
| 68 | 41 (scenario 5) | yes | yes | 4496519 | 4496573 | no |
| 69 | 50 (scenario 5) | yes | yes | 4496537 | 4496575 | no |
| 70 | 58 (scenario 6) | yes | yes | 4496553 | 4496577 | no |

## Verifying an intent_hash without any AEGIS code

Each record in `runs.ndjson` carries `canonical_preimage_hex`, the exact bytes of `canonical_intent`. To check one:

```sh
jq -r 'select(.run_index == 1) | .canonical_preimage_hex' evidence/d1-authorize/runs.ndjson \
  | xxd -r -p | shasum -a 256
# compare against .intent_hash for the same run
```

