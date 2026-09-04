# D4 — list of intent references for testing

SOW §6.1 D4 requires a **list of intent references for testing**. This is that list.

Every reference below is a real record on Stellar **testnet** against contract
[`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA).
Nothing here is illustrative and nothing is rounded.

**Generated from the evidence files, not typed by hand** — `evidence/d1-authorize/runs.ndjson`,
`evidence/d2-index.json` and `evidence/d3-receipts/*.json` are the sources.

## How to use a reference

A reference is an `intent_hash` or a `decision_id`. Both are 64 lowercase hex characters.

- **In the console** — <https://aegis-production-2216.up.railway.app> — paste either value into the
  lookup box, or open it directly at `/intent/<intent_hash>` or `/decision/<decision_id>`. The
  console tries `decision_by_intent` first and falls back to `get_decision`, so whichever of the two
  you were handed resolves. Every reference in this file was loaded that way and checked:
  `d4-results.md`.
- **Without the console**: read the decision straight off the chain —

```bash
stellar contract invoke \
  --id CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA \
  --network testnet --send=no --source-account <any-funded-testnet-account> \
  -- get_decision --decision_id <decision_id>
```

The reason-code and verdict integers that come back are translated in `evidence/README.md`.

## Reason code and verdict translation

Both are `u32` on the wire. Every table below prints the integer *and* the name, because
"correct verdict and reason code" cannot be checked against a bare integer.

| `reason_code` | name | | `verdict` | name |
| ---: | --- | --- | ---: | --- |
| 0 | `Ok` | | 0 | `Approved` |
| 1 | `CapExceeded` | | 1 | `Rejected` |
| 2 | `ServiceNotAllowed` | | 2 | `RequiresApproval` |
| 3 | `AssetMismatch` | | | |
| 4 | `AgentRevoked` | | | |
| 5 | `WindowCapExceeded` | | | |
| 6 | `PendingApproval` | | | |
| 7 | `OwnerRejected` | | | |

---

## A. The ten settled intents — start here

These are the ten that carry a payment on the ledger, so they are the only ten with a
transaction hash. SOW §6.1 D4 asks for *10/10 transaction links live*; these are those ten.

| # | Case | `intent_hash` | `decision_id` | Verdict | Reason | Amount USDC | Settlement tx |
| --: | --- | --- | --- | --- | --- | --: | --- |
| 1 | `s01` | `1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c` | `b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec` | 0 `Approved` | 0 `Ok` | 1.5000000 | [`fb025c010c5a7064…`](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) |
| 2 | `s02` | `819b379ac72cbd8157d6dbedc652d642becdfd0c3f91c8812742a3cf91ff1d29` | `94d56d8ca36958d3d2132b7b634c2d7e5283ac30498a1ef1df59765effae3c69` | 0 `Approved` | 0 `Ok` | 2.2500000 | [`432c0d7de523dea1…`](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) |
| 3 | `s03` | `91234faf84770fe725a7fb8e98f6260b0b244190dba4a019e942157b0eff3811` | `c4d77369099a58ef55c8479bc9789f5cf41e4337b8e9c43e55aa29b128730dce` | 0 `Approved` | 0 `Ok` | 3.0000000 | [`face6424cc52cb29…`](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) |
| 4 | `s04` | `c3273bbfadd8dd116b70ea82d10bfc0c1d22d6c6df9f9b2b56689b16719b3f53` | `7ae3e83b024a38133e98ba8be04993672313de78b8751215aa71740ec731b2bc` | 0 `Approved` | 0 `Ok` | 4.5000000 | [`a8a991c42226f1dd…`](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) |
| 5 | `s05` | `c1c754806a9554259b663e256c11df7c06bae1f9089b1481416e2c2b78e7364f` | `60dcb6be99ae41da14b0e0f6df425ee89e53b6f5d120c148f9c18683c725f3f1` | 0 `Approved` | 0 `Ok` | 5.0000000 | [`3112ecec2dd2a715…`](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) |
| 6 | `s06` | `c7e802f5f59fccd8774a83d346a1cb7c80a9d9b54f8435e6d6877209b6d838c3` | `f188da8765686e2a626ce864b71eae97f9a2d6c3400b215ac6f8b59c1ff89ae6` | 0 `Approved` | 0 `Ok` | 6.2500000 | [`87c09c1f4db564f3…`](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) |
| 10 | `s10` | `9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a` | `17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0` | 0 `Approved` | 0 `Ok` | 30.0000000 | [`c9242c10dd5fe72d…`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) |
| 18 | `s18` | `d7fb8673d3e5253dfaf29d779ff3360bf1cc88d9f60ef87afb5a815415592ffd` | `37c793a5e1e79f4143e42c36b9ffd2c6c4d1a5a1efdab7ebd03fe6610a9d8d45` | 0 `Approved` | 0 `Ok` | 0.0000001 | [`bc3cf80bbb1a7708…`](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) |
| 19 | `s19` | `b6a0f02f484c798ecdc44f4f0182098342bd7d11bbe58e6e360e60726e9d9898` | `3c605cc0e1fe58e2e4583d94388d4013605f2ad75b2244083893b575f1a23147` | 0 `Approved` | 0 `Ok` | 12.3456789 | [`6d7bd29941280801…`](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) |
| 20 | `s20` | `ef66d07610cad3d1ed169264ae2e3bf937d7508acc4a75bb81c66f66b3ff2a01` | `c1e498ed8b8797e83014d60a68238b70eb244ace22c01676671ad21e94dce04d` | 0 `Approved` | 0 `Ok` | 1.0000000 | [`92638827bb8c7a99…`](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) |

**10 settlements · 658456790 stroops = 65.8456790 USDC.** Full transaction hashes and the
MEMO_HASH preimage for each are in `d3-results.md`; the per-settlement audit receipt is in
`d3-audit-receipts.md`.

Two of these ten are worth opening first:

- **`s10`** is the escalation that went the whole way: `RequiresApproval` → owner `resolve()`
  on chain → settlement. Its `reason_code` reads `Ok` today but its `original_reason_code`
  still reads `PendingApproval`, so the chain itself records that a human was needed. Trail in
  `d2-approval-trail.md`.
- **`s18`** settles **0.0000001 USDC** — one stroop, the smallest amount Stellar can represent.
  It is in the set to show the amount path carries no floating point anywhere.

---

## B. The twenty gateway submissions (D2)

All 20 reached the contract and produced a stored on-chain decision. `Expected` is what
`scripts/d2-intents.json` declared **before** the run; `Observed` is what the contract answered.

| # | Case | Field variation | `intent_hash` | `decision_id` | Expected | Observed | HTTP | Settled |
| --: | --- | --- | --- | --- | --- | --- | --: | :---: |
| 1 | `s01` | baseline: both optional fields populated | `1a356a0c8b9490ca81748d53…` | `b62b0ce89c7e3f0938816b32…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 2 | `s02` | second allowed service | `819b379ac72cbd8157d6dbed…` | `94d56d8ca36958d3d2132b7b…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 3 | `s03` | empty purpose (hashed as a zero-length string) | `91234faf84770fe725a7fb8e…` | `c4d77369099a58ef55c8479b…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 4 | `s04` | empty client_ref | `c3273bbfadd8dd116b70ea82…` | `7ae3e83b024a38133e98ba8b…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 5 | `s05` | both optional fields empty | `c1c754806a9554259b663e25…` | `60dcb6be99ae41da14b0e0f6…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 6 | `s06` | 1024-byte purpose (canonical str16 field) | `c7e802f5f59fccd8774a83d3…` | `f188da8765686e2a626ce864…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 7 | `s07` | 255-byte client_ref (canonical str8 field at its maximum) | `60e5c7e09b8bfb06f3859a11…` | `d49f94af3cf2c678da233b9c…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | no |
| 8 | `s08` | whole-number amount | `e3349eadf7828f670b9776ea…` | `541a7dd79996581c18a7f3f7…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | no |
| 9 | `s09` | amount just under the approval threshold band | `e0e4e27c2570ec8748e9ef71…` | `75989785dcc5e742e62aa15d…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | no |
| 10 | `s10` | amount above approval_threshold (25 USDC), below per_intent_cap (50 USDC) | `9a9ebd5efcd76521bd822db1…` | `17594051cc98c12d479e027a…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 202 | yes |
| 11 | `s11` | amount above per_intent_cap | `6b3c47a27fac88487905c0cd…` | `c942b69f7af06b0172aa39f8…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 200 | no |
| 12 | `s12` | service_id outside Policy.allowed_services | `c023cb096681cd091595da0a…` | `9a8e398f4db01ce390e94b34…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 200 | no |
| 13 | `s13` | asset that is not Policy.allowed_asset | `fdf3afd4399177ec4837eb27…` | `fac6528a6d9d1469eaa0723a…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 200 | no |
| 14 | `s14` | second escalation, deliberately left unresolved | `d7da75c876abe272f1ad7653…` | `7504f529518b41ce2edc3fcd…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 202 | no |
| 15 | `s15` | third escalation, to be refused by the owner | `09a258410ca1af47de03012d…` | `03defcb77539553dac3b4d96…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 202 | no |
| 16 | `s16` | byte-identical resubmission of s01 (idempotency on intent_hash) | `1a356a0c8b9490ca81748d53…` | `b62b0ce89c7e3f0938816b32…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | no |
| 17 | `s17` | byte-identical resubmission of a REJECTED intent | `6b3c47a27fac88487905c0cd…` | `c942b69f7af06b0172aa39f8…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 200 | no |
| 18 | `s18` | one stroop, the smallest representable amount | `d7fb8673d3e5253dfaf29d77…` | `37c793a5e1e79f4143e42c36…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 19 | `s19` | seven decimal places, full stroop precision | `b6a0f02f484c798ecdc44f4f…` | `3c605cc0e1fe58e2e4583d94…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |
| 20 | `s20` | 2048-byte purpose plus a whole-number amount | `ef66d07610cad3d1ed169264…` | `c1e498ed8b8797e83014d60a…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 200 | yes |

`Observed` is the verdict **as first recorded**. Three cases escalated; two were then resolved
on chain by the owner, which rewrites `reason_code` but never `original_reason_code`:

| Case | First recorded | After the owner resolved | `original_reason_code` |
| --- | --- | --- | --- |
| `s10` | RequiresApproval / 6 `PendingApproval` | Approved / 0 `Ok` | `PendingApproval` |
| `s14` | RequiresApproval / 6 `PendingApproval` | never resolved — still pending | `PendingApproval` |
| `s15` | RequiresApproval / 6 `PendingApproval` | Rejected / 7 `OwnerRejected` | `PendingApproval` |

`s16` and `s17` are byte-identical resubmissions of `s01` and `s11`. They carry the **same**
`intent_hash` and the **same** `decision_id` as their originals — that is SOW §5.2 scenario 7,
and it is why the count of distinct references below is 18 rather than 20.

Distinct `intent_hash` values across the 20 submissions: **18**.

---

## C. The seventy authorization decisions (D1)

Seven §5.2 scenarios, ten runs each, all against the same live contract. SOW §6.1 D4 asks for
*70/70 decisions viewable*; these are those seventy. None of them is settled — D1 exercises the
authorization path only.

Runs 61–70 are scenario 7 (replay). They deliberately carry the **same** `intent_hash` and
`decision_id` as the earlier run they replay, so the seventy rows hold **60 distinct**
references.

| # | Scn | Scenario | `intent_hash` | `decision_id` | Expected | Observed | Ledger |
| --: | --: | --- | --- | --- | --- | --- | --: |
| 1 | 1 | Compliant intent | `b5a124f23f18c3d97c1d…` | `37ba5f064522e0978dbc…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496439 |
| 2 | 1 | Compliant intent | `befb88631339c7910d10…` | `c177db1ad47ac3c8ddaa…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496441 |
| 3 | 1 | Compliant intent | `55f68fa37bc8ee5d969d…` | `510dfd9c5002fb500161…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496443 |
| 4 | 1 | Compliant intent | `bdc632d4bff53db257d5…` | `b5b819ebd909662fa4fc…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496445 |
| 5 | 1 | Compliant intent | `557f826307a9e07169b8…` | `40a865d180b7a5e56741…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496447 |
| 6 | 1 | Compliant intent | `87eb98f884bdafced906…` | `55ae5ac7c7eacfe7bc63…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496449 |
| 7 | 1 | Compliant intent | `35425875bc0ddb493ffd…` | `6d68b160c4430bd35d43…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496451 |
| 8 | 1 | Compliant intent | `2aaefd2799717de3948e…` | `63e95f08b307f679b6cc…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496453 |
| 9 | 1 | Compliant intent | `30e3e7dbd7c520028723…` | `8fae4f435efbbc05b17b…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496455 |
| 10 | 1 | Compliant intent | `44aea3a844b3623a1eea…` | `f4f74405eb37881a3b2b…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496457 |
| 11 | 2 | Amount over per_intent_cap | `149d02c47dc0da138f04…` | `408cf2f0935d36818b07…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496459 |
| 12 | 2 | Amount over per_intent_cap | `6da7ce93564f583750f9…` | `f8e0e1e6375422740792…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496461 |
| 13 | 2 | Amount over per_intent_cap | `34517cdf9d3a97a0ab81…` | `d15fa65d82835ed7f744…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496463 |
| 14 | 2 | Amount over per_intent_cap | `d095f9aeee0936f5b6ad…` | `bcce910b3f52343270b2…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496465 |
| 15 | 2 | Amount over per_intent_cap | `48cf837775cd06c20eae…` | `066a6a9cb511451515f5…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496467 |
| 16 | 2 | Amount over per_intent_cap | `b37ea208b45cd174e4c8…` | `57e923505f64a787ade7…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496469 |
| 17 | 2 | Amount over per_intent_cap | `bc8779a17c8d89b441d8…` | `e69f9826e6f29afcf948…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496471 |
| 18 | 2 | Amount over per_intent_cap | `14e8bd74bacb2813a65e…` | `ec88a1d62befff901061…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496473 |
| 19 | 2 | Amount over per_intent_cap | `c0fcc096a6484a96277f…` | `7d2306e489746ab43178…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496475 |
| 20 | 2 | Amount over per_intent_cap | `c1c4b4d44e3446c6da13…` | `a5aaa7fc511435b76b42…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496477 |
| 21 | 3 | Service not whitelisted | `2fca457436af33556449…` | `d832df75af0dbdb6680a…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496479 |
| 22 | 3 | Service not whitelisted | `248c0a9596bd39c69237…` | `ab9005b7c3a16c4a10ed…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496481 |
| 23 | 3 | Service not whitelisted | `8320bb3e5861e19e39ed…` | `6f1ad0a952ded24d3039…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496483 |
| 24 | 3 | Service not whitelisted | `5043a2348cbffd7d4f39…` | `ac627fa8d21f8b66c801…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496485 |
| 25 | 3 | Service not whitelisted | `218d73d5caa76f949ffa…` | `f4f3f233c42fbe0193e9…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496487 |
| 26 | 3 | Service not whitelisted | `366145a05cf2c27fba61…` | `5fe15f5568aafd553ada…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496489 |
| 27 | 3 | Service not whitelisted | `7fa46f4a51747f624acb…` | `c70e6f5513cba43c63d2…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496491 |
| 28 | 3 | Service not whitelisted | `c8a6be71bbd8aaded899…` | `9c128f273e4aee00ed91…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496493 |
| 29 | 3 | Service not whitelisted | `7a3179759f7b1084b884…` | `fb1ddecc6553e7279463…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496495 |
| 30 | 3 | Service not whitelisted | `e82a0db009381d182a8b…` | `b8bcd6b6383fa4d1fda6…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496497 |
| 31 | 4 | Asset not the policy asset | `b0a66e65ddbfbced217b…` | `c3ed7752f0764f5b0523…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496499 |
| 32 | 4 | Asset not the policy asset | `a4dfa6fcc316dab360a2…` | `ef6bd07564a156995ba7…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496501 |
| 33 | 4 | Asset not the policy asset | `630e91a0298281eda54c…` | `1e90628c4348642da20b…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496503 |
| 34 | 4 | Asset not the policy asset | `9631a2ff136a9666ee0e…` | `ff6f915a9b599946932f…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496505 |
| 35 | 4 | Asset not the policy asset | `124bf4788809a83e1344…` | `09618457eac4f9d4666f…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496507 |
| 36 | 4 | Asset not the policy asset | `f8527fd4314bacffaa0c…` | `331dc90eadaceb7fd65e…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496509 |
| 37 | 4 | Asset not the policy asset | `d5df843ebeb92f4fdcc3…` | `4dcf053efe16b45c3558…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496511 |
| 38 | 4 | Asset not the policy asset | `e302b594d48f4784ee5b…` | `4e6c02a63bc775d1e2ff…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496513 |
| 39 | 4 | Asset not the policy asset | `6843e81d3e83cb162488…` | `aabb98be43cc73ad4821…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496515 |
| 40 | 4 | Asset not the policy asset | `dff504fe618e2b5e3a5a…` | `ce4efb19a102ddd6df2c…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496517 |
| 41 | 5 | Above approval_threshold, at or under per_intent_cap | `9ceb56e2964b7837d1c9…` | `1d651d4112893b0a700a…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496519 |
| 42 | 5 | Above approval_threshold, at or under per_intent_cap | `b80fed86bc4d2af8269c…` | `5994dc08b3beef582b0e…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496521 |
| 43 | 5 | Above approval_threshold, at or under per_intent_cap | `6f04480e07c74f91037c…` | `2a3be4669e8891c1f8b3…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496523 |
| 44 | 5 | Above approval_threshold, at or under per_intent_cap | `da21527f8a453f2dba17…` | `f97d0c24ee73a0ed6288…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496525 |
| 45 | 5 | Above approval_threshold, at or under per_intent_cap | `78db84d92fbfd8671862…` | `cc85a311394a0d36b12c…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496527 |
| 46 | 5 | Above approval_threshold, at or under per_intent_cap | `31c4bee706529317297c…` | `bca4ee8ef5db1c16a947…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496529 |
| 47 | 5 | Above approval_threshold, at or under per_intent_cap | `ccb1bffb6b52655da1a0…` | `e6626156dec097b97d83…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496531 |
| 48 | 5 | Above approval_threshold, at or under per_intent_cap | `b8fe140ce6ca7f9e4005…` | `bfd69205d2145ff601b3…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496533 |
| 49 | 5 | Above approval_threshold, at or under per_intent_cap | `3aa50187d129ae724317…` | `9959dd830f764c3852a5…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496535 |
| 50 | 5 | Above approval_threshold, at or under per_intent_cap | `69fd9db9436a48fb6f12…` | `f4c5185e93d1a53d5c0d…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496537 |
| 51 | 6 | Revoked agent | `a1d7080e0ea30c22d761…` | `d55798d442c61a01b714…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496539 |
| 52 | 6 | Revoked agent | `66657c5ce2407d136b17…` | `0a88a05e106373edb2e1…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496541 |
| 53 | 6 | Revoked agent | `bf9be96f6182f176054b…` | `6576903a68ea109cc155…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496543 |
| 54 | 6 | Revoked agent | `d9e081098a5c0134630b…` | `3f2a21e39d8b10fe6728…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496545 |
| 55 | 6 | Revoked agent | `4cf22031c795abf88acc…` | `e59dfab14b43b5991f38…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496547 |
| 56 | 6 | Revoked agent | `2dcf077da487b355a9de…` | `9edf6429a9d24edbfa93…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496549 |
| 57 | 6 | Revoked agent | `bd71572d9362d3d0a13a…` | `6fb3d3636177311b7e8f…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496551 |
| 58 | 6 | Revoked agent | `48e1bdb735645e4834e4…` | `2950696a1a3ab5005a1e…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496553 |
| 59 | 6 | Revoked agent | `472171dc320b27cc7ca7…` | `f70462f846b1b3d963e6…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496555 |
| 60 | 6 | Revoked agent | `9ef3309f3b99398fa780…` | `46cd727e7655cb151676…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496557 |
| 61 | 7 | Replay of an already-authorized intent_hash | `b5a124f23f18c3d97c1d…` | `37ba5f064522e0978dbc…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496439 |
| 62 | 7 | Replay of an already-authorized intent_hash | `557f826307a9e07169b8…` | `40a865d180b7a5e56741…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496447 |
| 63 | 7 | Replay of an already-authorized intent_hash | `44aea3a844b3623a1eea…` | `f4f74405eb37881a3b2b…` | Approved / 0 `Ok` | Approved / 0 `Ok` | 4496457 |
| 64 | 7 | Replay of an already-authorized intent_hash | `149d02c47dc0da138f04…` | `408cf2f0935d36818b07…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496459 |
| 65 | 7 | Replay of an already-authorized intent_hash | `c1c4b4d44e3446c6da13…` | `a5aaa7fc511435b76b42…` | Rejected / 1 `CapExceeded` | Rejected / 1 `CapExceeded` | 4496477 |
| 66 | 7 | Replay of an already-authorized intent_hash | `c8a6be71bbd8aaded899…` | `9c128f273e4aee00ed91…` | Rejected / 2 `ServiceNotAllowed` | Rejected / 2 `ServiceNotAllowed` | 4496493 |
| 67 | 7 | Replay of an already-authorized intent_hash | `6843e81d3e83cb162488…` | `aabb98be43cc73ad4821…` | Rejected / 3 `AssetMismatch` | Rejected / 3 `AssetMismatch` | 4496515 |
| 68 | 7 | Replay of an already-authorized intent_hash | `9ceb56e2964b7837d1c9…` | `1d651d4112893b0a700a…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496519 |
| 69 | 7 | Replay of an already-authorized intent_hash | `69fd9db9436a48fb6f12…` | `f4c5185e93d1a53d5c0d…` | RequiresApproval / 6 `PendingApproval` | RequiresApproval / 6 `PendingApproval` | 4496537 |
| 70 | 7 | Replay of an already-authorized intent_hash | `48e1bdb735645e4834e4…` | `2950696a1a3ab5005a1e…` | Rejected / 4 `AgentRevoked` | Rejected / 4 `AgentRevoked` | 4496553 |

Distinct `decision_id` values across the 70 runs: **60**.

Full-length hashes for every row — plus the exact canonical preimage that was hashed — are in
`d1-authorize/runs.ndjson`, and the same data as a spreadsheet is in
`d1-authorize/decision-export.csv`.

### Where each scenario lives in the table

| §5.2 scenario | Runs | Expected verdict / reason |
| --- | --- | --- |
| 1 — Compliant intent | 1–10 | Approved / 0 `Ok` |
| 2 — Amount over per_intent_cap | 11–20 | Rejected / 1 `CapExceeded` |
| 3 — Service not whitelisted | 21–30 | Rejected / 2 `ServiceNotAllowed` |
| 4 — Asset not the policy asset | 31–40 | Rejected / 3 `AssetMismatch` |
| 5 — Above approval_threshold, at or under per_intent_cap | 41–50 | RequiresApproval / 6 `PendingApproval` |
| 6 — Revoked agent | 51–60 | Rejected / 4 `AgentRevoked` |
| 7 — Replay of an already-authorized intent_hash | 61–70 | the original decision, returned unchanged (six different codes across the ten) |

---

## Totals

| | Count |
| --- | --: |
| D1 authorization decisions | 70 runs, 60 distinct `decision_id` |
| D2 gateway submissions | 20 submissions, 18 distinct `intent_hash` |
| D3 settlements with a live tx link | 10 |

Every value in this file was read out of the evidence files listed at the top. If a reference
here does not resolve on chain, the evidence is wrong and should be reported as such — the
chain is the authority, not this table.
