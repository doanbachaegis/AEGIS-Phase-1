# D3 — Decision-gated settlement: 10 testnet settlements

Generated 2026-09-04T07:26:14Z · contract [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA) · Stellar **testnet**

Ten real payments on Stellar testnet, each gated on an on-chain decision and each carrying a
MEMO_HASH that commits to it. Every one was then re-attempted (10 replays) and independently
verified by `tools/verifier`, which shares no code with the executor.

## Result table

| # | Case | Decision id | Amount (USDC) | Service | tx | Ledger | Verifier |
|--:|---|---|--:|---|---|--:|---|
| 1 | `s01` | `b62b0ce89c7e3f09…` | 1.5000000 | `openai-api` | [`fb025c010c5a7064…`](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) | 4496500 | **VERIFIED** |
| 2 | `s02` | `94d56d8ca36958d3…` | 2.2500000 | `anthropic-api` | [`432c0d7de523dea1…`](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) | 4496503 | **VERIFIED** |
| 3 | `s03` | `c4d77369099a58ef…` | 3.0000000 | `openai-api` | [`face6424cc52cb29…`](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) | 4496506 | **VERIFIED** |
| 4 | `s04` | `7ae3e83b024a3813…` | 4.5000000 | `anthropic-api` | [`a8a991c42226f1dd…`](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) | 4496509 | **VERIFIED** |
| 5 | `s05` | `60dcb6be99ae41da…` | 5.0000000 | `openai-api` | [`3112ecec2dd2a715…`](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) | 4496512 | **VERIFIED** |
| 6 | `s06` | `f188da8765686e2a…` | 6.2500000 | `anthropic-api` | [`87c09c1f4db564f3…`](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) | 4496515 | **VERIFIED** |
| 10 | `s10` | `17594051cc98c12d…` | 30.0000000 | `openai-api` | [`c9242c10dd5fe72d…`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) | 4496518 | **VERIFIED** |
| 18 | `s18` | `37c793a5e1e79f41…` | 0.0000001 | `openai-api` | [`bc3cf80bbb1a7708…`](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) | 4496521 | **VERIFIED** |
| 19 | `s19` | `3c605cc0e1fe58e2…` | 12.3456789 | `anthropic-api` | [`6d7bd29941280801…`](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) | 4496524 | **VERIFIED** |
| 20 | `s20` | `c1e498ed8b8797e8…` | 1.0000000 | `openai-api` | [`92638827bb8c7a99…`](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) | 4496527 | **VERIFIED** |

**10/10 settled · 10/10 VERIFIED · 65.8456790 USDC moved.**

Every settlement succeeded on its first attempt: no `recover` call was needed anywhere in the run.

## Stellar Expert links

| Case | Transaction |
|---|---|
| `s01` | https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9 |
| `s02` | https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db |
| `s03` | https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32 |
| `s04` | https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a |
| `s05` | https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e |
| `s06` | https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef |
| `s10` | https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127 |
| `s18` | https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e |
| `s19` | https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c |
| `s20` | https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb |

Executor account: https://stellar.expert/explorer/testnet/account/GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3
Merchant account: https://stellar.expert/explorer/testnet/account/GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY

## MEMO_HASH and receipt preimage

The §6.3 acceptance criterion:

```
MEMO_HASH == sha256( intent_hash || policy_version_be_u32 || decision_id )
```

68 bytes in, 32 bytes out. The memo is fixed when the transaction is signed and cannot be edited
afterwards, which is what turns a payment on a public ledger into a payment that provably refers to
one specific governance decision.

| # | Case | MEMO_HASH (on the ledger) | 68-byte preimage |
|--:|---|---|---|
| 1 | `s01` | `0510ea1a70eb38b5b142436b05a12fb9953dc091d617a9b5f11f929d6de43cfe` | `1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c00000001b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec` |
| 2 | `s02` | `a855d1721b7e653d55556a801a0e9fc6ce6c82e825d1c52671b6564f14c45a7f` | `819b379ac72cbd8157d6dbedc652d642becdfd0c3f91c8812742a3cf91ff1d290000000194d56d8ca36958d3d2132b7b634c2d7e5283ac30498a1ef1df59765effae3c69` |
| 3 | `s03` | `562edf4e1ef6c5998162651d278af97deef247256b2871f3ddf51e55c140990d` | `91234faf84770fe725a7fb8e98f6260b0b244190dba4a019e942157b0eff381100000001c4d77369099a58ef55c8479bc9789f5cf41e4337b8e9c43e55aa29b128730dce` |
| 4 | `s04` | `316a44ea58646ede9f526f2427b7af31d84288d0f12d853aa5628dc4691c8671` | `c3273bbfadd8dd116b70ea82d10bfc0c1d22d6c6df9f9b2b56689b16719b3f53000000017ae3e83b024a38133e98ba8be04993672313de78b8751215aa71740ec731b2bc` |
| 5 | `s05` | `91362ba4b1e85efb5b9b4dbc30279097401f762969758d5c3a9ee800ec7d8e73` | `c1c754806a9554259b663e256c11df7c06bae1f9089b1481416e2c2b78e7364f0000000160dcb6be99ae41da14b0e0f6df425ee89e53b6f5d120c148f9c18683c725f3f1` |
| 6 | `s06` | `40a5fbf70cf5e3d0092b5b3b71878de5f94c0cc949a0aa366d976d8cfc0d5ecd` | `c7e802f5f59fccd8774a83d346a1cb7c80a9d9b54f8435e6d6877209b6d838c300000001f188da8765686e2a626ce864b71eae97f9a2d6c3400b215ac6f8b59c1ff89ae6` |
| 10 | `s10` | `c758fe0e46058e02a68b68565f0158f582cef5aa880509d6a08a4d2bb19c764a` | `9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a0000000117594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0` |
| 18 | `s18` | `0499cbe3de42d35e2ea39b1ada4a24f529086bd9150cf9345a6d69c30ce8678f` | `d7fb8673d3e5253dfaf29d779ff3360bf1cc88d9f60ef87afb5a815415592ffd0000000137c793a5e1e79f4143e42c36b9ffd2c6c4d1a5a1efdab7ebd03fe6610a9d8d45` |
| 19 | `s19` | `b7581cc4a8075dd5322f2aac11211ae4cc28f86350a81832b185d85a6719b573` | `b6a0f02f484c798ecdc44f4f0182098342bd7d11bbe58e6e360e60726e9d9898000000013c605cc0e1fe58e2e4583d94388d4013605f2ad75b2244083893b575f1a23147` |
| 20 | `s20` | `3691fe0b87e78e56f4eb99e57d5b7b2ac338ae2afa28dd2890af259d305679b2` | `ef66d07610cad3d1ed169264ae2e3bf937d7508acc4a75bb81c66f66b3ff2a0100000001c1e498ed8b8797e83014d60a68238b70eb244ace22c01676671ad21e94dce04d` |

Check any row with standard tools only:

```bash
echo -n <memo_preimage> | xxd -r -p | shasum -a 256   # == memo_hash
```

The verifier checks it three independent ways per settlement — recomputed locally by
`@aegis/canonical`, recomputed **on chain** by the contract's own `memo_hash()` view (Rust, not
TypeScript), and hashed from the receipt's own preimage. A bug in one implementation cannot make a
settlement verify; all three would have to be wrong in the same way.

Full receipts: `evidence/d3-receipts/`. Each is an `aegis-receipt/1` document — a **claim**, never
evidence: every field in it is something the verifier re-derives from Horizon or Soroban RPC and
then compares.

## Replay attempts — no second payment

Each of the 10 settled decisions was handed back to `aegis-settle settle` after settlement.

| # | Case | Decision id | Result | Second payment |
|--:|---|---|---|---|
| 1 | `s01` | `b62b0ce89c7e3f09…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 2 | `s02` | `94d56d8ca36958d3…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 3 | `s03` | `c4d77369099a58ef…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 4 | `s04` | `7ae3e83b024a3813…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 5 | `s05` | `60dcb6be99ae41da…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 6 | `s06` | `f188da8765686e2a…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 10 | `s10` | `17594051cc98c12d…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 18 | `s18` | `37c793a5e1e79f41…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 19 | `s19` | `3c605cc0e1fe58e2…` | exit 1 · **`ALREADY_SETTLED`** | none |
| 20 | `s20` | `c1e498ed8b8797e8…` | exit 1 · **`ALREADY_SETTLED`** | none |

**10 attempts, 10 refusals, 0 payments.** The refusal comes from the chain, not from the executor's
local journal: `mark_settled` set `settled = true` on the decision, and the contract raises
`AlreadySettled` (`Error #9`) for any second attempt. That guard holds even if the executor's
journal is deleted.

Proven three ways:

1. **Balances.** Merchant USDC before the run **12.5000000**, after the ten settlements
   **78.3456790** (+65.8456790), after the ten replays **78.3456790**
   (**+0.0000000**). The settlement delta equals the sum of the ten decisions,
   65.8456790 USDC, to the stroop.
2. **The executor's own gate**, per row above.
3. **The verifier's memo scan**, run *after* the replay phase on purpose: for every settlement it
   walks the full history of both accounts a double-settle would have to appear on and reports
   *"exactly one, and it is this one"*.

## Verifier output

`tools/verifier` reads Horizon and Soroban RPC only. It never calls the AEGIS API and never imports
`@aegis/bindings` — it fetches the contract ABI from the chain, so even the `Verdict` enum's case
names come from the on-chain spec. It was written by someone who did not write the executor.

| # | Case | Verdict | Exit | Checks | Report |
|--:|---|---|--:|---|---|
| 1 | `s01` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `01-s01-b62b0ce89c7e3f09.txt` |
| 2 | `s02` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `02-s02-94d56d8ca36958d3.txt` |
| 3 | `s03` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `03-s03-c4d77369099a58ef.txt` |
| 4 | `s04` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `04-s04-7ae3e83b024a3813.txt` |
| 5 | `s05` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `05-s05-60dcb6be99ae41da.txt` |
| 6 | `s06` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `06-s06-f188da8765686e2a.txt` |
| 10 | `s10` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `10-s10-17594051cc98c12d.txt` |
| 18 | `s18` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `18-s18-37c793a5e1e79f41.txt` |
| 19 | `s19` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `19-s19-3c605cc0e1fe58e2.txt` |
| 20 | `s20` | **VERIFIED** | 0 | 21 passed / 0 failed / 0 unavailable | `20-s20-c1e498ed8b8797e8.txt` |

**10/10 VERIFIED**, every one in `--strict` mode, which adds the `decision_id` derivation and the
check that `mark_settled` was written at or before the payment's ledger. Exit code 0 means every
property was *checked* and holds — the verifier reports a check it could not run as `unavailable`
and exits 3, and none did.

Full reports in `evidence/d3-verifier/` (`.txt` human-readable, `.json` machine-readable). The
executor and the verifier agreed on every field of all ten settlements; there is no disagreement
to report.
