# D3 — audit receipts

Generated 2026-09-04T07:26:14Z

SOW §6.1 D3 asks for an audit receipt joining agent, owner, policy version, verdict, `decision_id`
and `tx_hash`. One row per settlement; every value is on chain or on the ledger, and the
`Source` column says which.

- **Contract** [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA) — Soroban RPC, testnet
- **Owner** [`GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I`](https://stellar.expert/explorer/testnet/account/GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I) — `get_policy(agent).owner`, the only account `resolve()` accepts
- **Agent** `agent-1` → [`GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH`](https://stellar.expert/explorer/testnet/account/GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH) — `Decision.agent`; the `agent-1` string is bound to the address by `apps/gateway/registry.json`, published but not enforced
- **Policy version** 1 for all ten — frozen into `decision_id` and into every MEMO_HASH below

| # | Case | Agent | Owner | Policy v | Verdict | decision_id | tx_hash | Settled |
|--:|---|---|---|--:|---|---|---|---|
| 1 | `s01` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec` | [`fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9`](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) | yes |
| 2 | `s02` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `94d56d8ca36958d3d2132b7b634c2d7e5283ac30498a1ef1df59765effae3c69` | [`432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db`](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) | yes |
| 3 | `s03` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `c4d77369099a58ef55c8479bc9789f5cf41e4337b8e9c43e55aa29b128730dce` | [`face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32`](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) | yes |
| 4 | `s04` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `7ae3e83b024a38133e98ba8be04993672313de78b8751215aa71740ec731b2bc` | [`a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a`](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) | yes |
| 5 | `s05` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `60dcb6be99ae41da14b0e0f6df425ee89e53b6f5d120c148f9c18683c725f3f1` | [`3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e`](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) | yes |
| 6 | `s06` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `f188da8765686e2a626ce864b71eae97f9a2d6c3400b215ac6f8b59c1ff89ae6` | [`87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef`](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) | yes |
| 10 | `s10` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0` | [`c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) | yes |
| 18 | `s18` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `37c793a5e1e79f4143e42c36b9ffd2c6c4d1a5a1efdab7ebd03fe6610a9d8d45` | [`bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e`](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) | yes |
| 19 | `s19` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `3c605cc0e1fe58e2e4583d94388d4013605f2ad75b2244083893b575f1a23147` | [`6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c`](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) | yes |
| 20 | `s20` | `GAUU26AE…K3MH` | `GCVPVDLZ…GJ3I` | 1 | Approved | `c1e498ed8b8797e83014d60a68238b70eb244ace22c01676671ad21e94dce04d` | [`92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb`](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) | yes |

## Per-settlement detail

### 1. `s01` — 1.5000000 USDC to `openai-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c` | `Decision.intent_hash` |
| `decision_id` | `b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec` | `Decision.decision_id` |
| amount | 15000000 stroops = 1.5000000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`71725b6fec10c2123b97749d0462c9062ef9bec8f64f88f26fac645611201b27`](https://stellar.expert/explorer/testnet/tx/71725b6fec10c2123b97749d0462c9062ef9bec8f64f88f26fac645611201b27) | ledger 4496428 |
| `mark_settled` | ledger 4496499 | Soroban RPC |
| payment tx | [`fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9`](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) | ledger 4496500, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `openai-api` in `services.json` |
| MEMO_HASH | `0510ea1a70eb38b5b142436b05a12fb9953dc091d617a9b5f11f929d6de43cfe` | Horizon, `memo_type: hash` |
| preimage | `1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c00000001b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `01-s01-b62b0ce89c7e3f09.txt` |

### 2. `s02` — 2.2500000 USDC to `anthropic-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `819b379ac72cbd8157d6dbedc652d642becdfd0c3f91c8812742a3cf91ff1d29` | `Decision.intent_hash` |
| `decision_id` | `94d56d8ca36958d3d2132b7b634c2d7e5283ac30498a1ef1df59765effae3c69` | `Decision.decision_id` |
| amount | 22500000 stroops = 2.2500000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`aa5ffcee9e704e80e6643ad6f252095aab2727662719b026797e6c6062320931`](https://stellar.expert/explorer/testnet/tx/aa5ffcee9e704e80e6643ad6f252095aab2727662719b026797e6c6062320931) | ledger 4496429 |
| `mark_settled` | ledger 4496502 | Soroban RPC |
| payment tx | [`432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db`](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) | ledger 4496503, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `anthropic-api` in `services.json` |
| MEMO_HASH | `a855d1721b7e653d55556a801a0e9fc6ce6c82e825d1c52671b6564f14c45a7f` | Horizon, `memo_type: hash` |
| preimage | `819b379ac72cbd8157d6dbedc652d642becdfd0c3f91c8812742a3cf91ff1d290000000194d56d8ca36958d3d2132b7b634c2d7e5283ac30498a1ef1df59765effae3c69` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `02-s02-94d56d8ca36958d3.txt` |

### 3. `s03` — 3.0000000 USDC to `openai-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `91234faf84770fe725a7fb8e98f6260b0b244190dba4a019e942157b0eff3811` | `Decision.intent_hash` |
| `decision_id` | `c4d77369099a58ef55c8479bc9789f5cf41e4337b8e9c43e55aa29b128730dce` | `Decision.decision_id` |
| amount | 30000000 stroops = 3.0000000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`599ce7f89ed71565f88e4026b161e7c9a9580deddea230c7ed4cdcb94844c8c0`](https://stellar.expert/explorer/testnet/tx/599ce7f89ed71565f88e4026b161e7c9a9580deddea230c7ed4cdcb94844c8c0) | ledger 4496430 |
| `mark_settled` | ledger 4496505 | Soroban RPC |
| payment tx | [`face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32`](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) | ledger 4496506, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `openai-api` in `services.json` |
| MEMO_HASH | `562edf4e1ef6c5998162651d278af97deef247256b2871f3ddf51e55c140990d` | Horizon, `memo_type: hash` |
| preimage | `91234faf84770fe725a7fb8e98f6260b0b244190dba4a019e942157b0eff381100000001c4d77369099a58ef55c8479bc9789f5cf41e4337b8e9c43e55aa29b128730dce` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `03-s03-c4d77369099a58ef.txt` |

### 4. `s04` — 4.5000000 USDC to `anthropic-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `c3273bbfadd8dd116b70ea82d10bfc0c1d22d6c6df9f9b2b56689b16719b3f53` | `Decision.intent_hash` |
| `decision_id` | `7ae3e83b024a38133e98ba8be04993672313de78b8751215aa71740ec731b2bc` | `Decision.decision_id` |
| amount | 45000000 stroops = 4.5000000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`083229cb8909a5f0870f94d0e1e9cf6389bfc78508acf5eb76ba69226b5eb510`](https://stellar.expert/explorer/testnet/tx/083229cb8909a5f0870f94d0e1e9cf6389bfc78508acf5eb76ba69226b5eb510) | ledger 4496431 |
| `mark_settled` | ledger 4496508 | Soroban RPC |
| payment tx | [`a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a`](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) | ledger 4496509, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `anthropic-api` in `services.json` |
| MEMO_HASH | `316a44ea58646ede9f526f2427b7af31d84288d0f12d853aa5628dc4691c8671` | Horizon, `memo_type: hash` |
| preimage | `c3273bbfadd8dd116b70ea82d10bfc0c1d22d6c6df9f9b2b56689b16719b3f53000000017ae3e83b024a38133e98ba8be04993672313de78b8751215aa71740ec731b2bc` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `04-s04-7ae3e83b024a3813.txt` |

### 5. `s05` — 5.0000000 USDC to `openai-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `c1c754806a9554259b663e256c11df7c06bae1f9089b1481416e2c2b78e7364f` | `Decision.intent_hash` |
| `decision_id` | `60dcb6be99ae41da14b0e0f6df425ee89e53b6f5d120c148f9c18683c725f3f1` | `Decision.decision_id` |
| amount | 50000000 stroops = 5.0000000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`971d80cc1fe4e25b1ef07f916889128790148026f19b0062a67355966d176d61`](https://stellar.expert/explorer/testnet/tx/971d80cc1fe4e25b1ef07f916889128790148026f19b0062a67355966d176d61) | ledger 4496432 |
| `mark_settled` | ledger 4496511 | Soroban RPC |
| payment tx | [`3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e`](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) | ledger 4496512, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `openai-api` in `services.json` |
| MEMO_HASH | `91362ba4b1e85efb5b9b4dbc30279097401f762969758d5c3a9ee800ec7d8e73` | Horizon, `memo_type: hash` |
| preimage | `c1c754806a9554259b663e256c11df7c06bae1f9089b1481416e2c2b78e7364f0000000160dcb6be99ae41da14b0e0f6df425ee89e53b6f5d120c148f9c18683c725f3f1` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `05-s05-60dcb6be99ae41da.txt` |

### 6. `s06` — 6.2500000 USDC to `anthropic-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `c7e802f5f59fccd8774a83d346a1cb7c80a9d9b54f8435e6d6877209b6d838c3` | `Decision.intent_hash` |
| `decision_id` | `f188da8765686e2a626ce864b71eae97f9a2d6c3400b215ac6f8b59c1ff89ae6` | `Decision.decision_id` |
| amount | 62500000 stroops = 6.2500000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`fe4cac338f7ae014864c1a1cf9ade8972db5f3b19391f5bc330ea3f1a7d68d69`](https://stellar.expert/explorer/testnet/tx/fe4cac338f7ae014864c1a1cf9ade8972db5f3b19391f5bc330ea3f1a7d68d69) | ledger 4496433 |
| `mark_settled` | ledger 4496514 | Soroban RPC |
| payment tx | [`87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef`](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) | ledger 4496515, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `anthropic-api` in `services.json` |
| MEMO_HASH | `40a5fbf70cf5e3d0092b5b3b71878de5f94c0cc949a0aa366d976d8cfc0d5ecd` | Horizon, `memo_type: hash` |
| preimage | `c7e802f5f59fccd8774a83d346a1cb7c80a9d9b54f8435e6d6877209b6d838c300000001f188da8765686e2a626ce864b71eae97f9a2d6c3400b215ac6f8b59c1ff89ae6` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `06-s06-f188da8765686e2a.txt` |

### 10. `s10` — 30.0000000 USDC to `openai-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a` | `Decision.intent_hash` |
| `decision_id` | `17594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0` | `Decision.decision_id` |
| amount | 300000000 stroops = 30.0000000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`8accce1c2632f7b75548d9ce027d14cf340ae0de87766576272826ba3eb6004c`](https://stellar.expert/explorer/testnet/tx/8accce1c2632f7b75548d9ce027d14cf340ae0de87766576272826ba3eb6004c) | ledger 4496437 |
| `mark_settled` | ledger 4496517 | Soroban RPC |
| payment tx | [`c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) | ledger 4496518, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `openai-api` in `services.json` |
| MEMO_HASH | `c758fe0e46058e02a68b68565f0158f582cef5aa880509d6a08a4d2bb19c764a` | Horizon, `memo_type: hash` |
| preimage | `9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a0000000117594051cc98c12d479e027a434dde7342d0f602f1711a916fa9659ec2e4ddd0` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `10-s10-17594051cc98c12d.txt` |
| escalation | verdict was **RequiresApproval**; approved on chain by the owner via `resolve()` ([tx](https://stellar.expert/explorer/testnet/tx/3a91bc4bd295797af946a5067eb9ddac5d03aa347b4d383f0ecddd1e1e52f0e5)). `original_reason_code` stays `PendingApproval`. |

### 18. `s18` — 0.0000001 USDC to `openai-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `d7fb8673d3e5253dfaf29d779ff3360bf1cc88d9f60ef87afb5a815415592ffd` | `Decision.intent_hash` |
| `decision_id` | `37c793a5e1e79f4143e42c36b9ffd2c6c4d1a5a1efdab7ebd03fe6610a9d8d45` | `Decision.decision_id` |
| amount | 1 stroops = 0.0000001 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`0c71c2d9dd43e17b40cf095c607e470e5f0de31501f4cf00b583dae6347c9983`](https://stellar.expert/explorer/testnet/tx/0c71c2d9dd43e17b40cf095c607e470e5f0de31501f4cf00b583dae6347c9983) | ledger 4496446 |
| `mark_settled` | ledger 4496520 | Soroban RPC |
| payment tx | [`bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e`](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) | ledger 4496521, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `openai-api` in `services.json` |
| MEMO_HASH | `0499cbe3de42d35e2ea39b1ada4a24f529086bd9150cf9345a6d69c30ce8678f` | Horizon, `memo_type: hash` |
| preimage | `d7fb8673d3e5253dfaf29d779ff3360bf1cc88d9f60ef87afb5a815415592ffd0000000137c793a5e1e79f4143e42c36b9ffd2c6c4d1a5a1efdab7ebd03fe6610a9d8d45` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `18-s18-37c793a5e1e79f41.txt` |

### 19. `s19` — 12.3456789 USDC to `anthropic-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `b6a0f02f484c798ecdc44f4f0182098342bd7d11bbe58e6e360e60726e9d9898` | `Decision.intent_hash` |
| `decision_id` | `3c605cc0e1fe58e2e4583d94388d4013605f2ad75b2244083893b575f1a23147` | `Decision.decision_id` |
| amount | 123456789 stroops = 12.3456789 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`75ee7a3c56f4ddbf5e1c712e35f5369566659d6e31e495409d5a0e20dbe36e3a`](https://stellar.expert/explorer/testnet/tx/75ee7a3c56f4ddbf5e1c712e35f5369566659d6e31e495409d5a0e20dbe36e3a) | ledger 4496447 |
| `mark_settled` | ledger 4496523 | Soroban RPC |
| payment tx | [`6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c`](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) | ledger 4496524, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `anthropic-api` in `services.json` |
| MEMO_HASH | `b7581cc4a8075dd5322f2aac11211ae4cc28f86350a81832b185d85a6719b573` | Horizon, `memo_type: hash` |
| preimage | `b6a0f02f484c798ecdc44f4f0182098342bd7d11bbe58e6e360e60726e9d9898000000013c605cc0e1fe58e2e4583d94388d4013605f2ad75b2244083893b575f1a23147` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `19-s19-3c605cc0e1fe58e2.txt` |

### 20. `s20` — 1.0000000 USDC to `openai-api`

| Field | Value | Source |
|---|---|---|
| `agent_id` | `agent-1` | submitted intent (hashed into `intent_hash`) |
| agent address | `GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH` | `Decision.agent`, Soroban RPC |
| owner | `GCVPVDLZNKKNKZUVVJSBH5YMLEO6SRL7PZO7U74SBRZMVUWANE4FGJ3I` | `get_policy().owner`, Soroban RPC |
| policy version | 1 | `Decision.policy_version` |
| verdict | Approved | `Decision.verdict` |
| `intent_hash` | `ef66d07610cad3d1ed169264ae2e3bf937d7508acc4a75bb81c66f66b3ff2a01` | `Decision.intent_hash` |
| `decision_id` | `c1e498ed8b8797e83014d60a68238b70eb244ace22c01676671ad21e94dce04d` | `Decision.decision_id` |
| amount | 10000000 stroops = 1.0000000 USDC | `Decision.amount` |
| asset | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | `Decision.asset` (SAC) |
| authorize tx | [`880cdf1f2153d3a4e642cae8d9e5db4b9c7c303c52f2ef17ff293856a3ef7461`](https://stellar.expert/explorer/testnet/tx/880cdf1f2153d3a4e642cae8d9e5db4b9c7c303c52f2ef17ff293856a3ef7461) | ledger 4496448 |
| `mark_settled` | ledger 4496526 | Soroban RPC |
| payment tx | [`92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb`](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) | ledger 4496527, Horizon |
| destination | `GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY` | Horizon; published for `openai-api` in `services.json` |
| MEMO_HASH | `3691fe0b87e78e56f4eb99e57d5b7b2ac338ae2afa28dd2890af259d305679b2` | Horizon, `memo_type: hash` |
| preimage | `ef66d07610cad3d1ed169264ae2e3bf937d7508acc4a75bb81c66f66b3ff2a0100000001c1e498ed8b8797e83014d60a68238b70eb244ace22c01676671ad21e94dce04d` | receipt; hashes to the memo above |
| verifier | **VERIFIED** | `20-s20-c1e498ed8b8797e8.txt` |

## The one claim this does not make

`Decision` carries `service_id` but **no destination account**, so the contract cannot and does not
constrain where the executor sends funds (`DECISIONS.md` #6, and the `trust_model` block in
`services.json`). A verified destination therefore proves *"the payment went where the published
registry said"*, not *"where the contract required"*. Phase 1 supports only the weaker claim; a
compromised executor key could pay elsewhere and the verifier would detect it **after the fact**,
not prevent it.
