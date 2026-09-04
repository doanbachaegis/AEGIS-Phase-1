# D4 — result table: decisions viewable, transaction links live

SOW §6.1 D4 asks for a *“result table showing 70/70 decisions viewable and 10/10
transaction links live”*, where a run counts as successful if the page shows the
**correct verdict and reason code** for the decision, and for settled intents the
Stellar Expert link opens the **correct** testnet transaction. This is that table.

- **Console:** <https://aegis-production-2216.up.railway.app>
- **Contract:** [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA) (testnet)
- **Run:** `2026-09-04T10:52:31.026Z` → `2026-09-04T10:58:30.680Z`
- **Browser:** Chrome/152.0.7977.82
- **Console root returned:** HTTP 200

| | Result |
| --- | --- |
| Decisions viewable with the correct verdict **and** reason code | **70 / 70** |
| Transaction links live and bound to the right decision | **10 / 10** |
| … of which the console page itself renders as a link | **10 / 10** — see [§B](#one-thing-this-table-does-not-say) |
| Settled intents whose console page renders correctly | **10 / 10** |
| Controls that had to find nothing, and found nothing | **3 / 3** |
| Total real page loads | **82** |

---

## How this was checked, and what it does not prove

**Method: real browser page loads.** Every reference below was loaded in a headless Chrome over the DevTools Protocol. The verdict and reason code recorded are the ones read back out of the rendered DOM (document.body.innerText) after React finished, not values fetched from RPC by this script. No pixels are inspected: this proves the page renders the right text, not that the text is visible or legibly styled.

This matters because the console is a React app. Querying Soroban RPC from a shell
and comparing the answer to the expected verdict would prove that the *data*
resolves; it would not prove that the *page* renders it. Every row below is a page
that was actually loaded, rendered, and read back.

**The limits, stated so they are not read past:**

- No pixels are inspected. The check reads `document.body.innerText`, so it proves
  the page renders the right *text*. It cannot prove the text was visible, legible,
  or laid out correctly. That is what the screenshots in `d4-screenshots/` are for,
  and they were taken by the same browser in the same run.
- The comparison is against the values recorded at run time in
  `d1-authorize/decision-export.json` and `d3-receipts/*.json`. Those are AEGIS
  artifacts. What makes the loop closed rather than circular is that the console
  never reads them: it reads the contract over Soroban RPC
  (`https://soroban-testnet.stellar.org`) with no AEGIS API in the authoritative path.
  The two sides agreeing is therefore a chain read agreeing with a chain write.
- The screenshots are one browser at one viewport. No cross-browser or mobile
  rendering claim is made anywhere in this pack.

**No writes.** The console holds no key and every contract call stops at
`simulateTransaction`; Horizon and Stellar Expert are read with `GET`. Nothing in
this check can move a lumen, and none of it touches the AEGIS write path.

Reproduce it:

```bash
node scripts/d4-console-verify.mjs      # 80 page loads + controls + screenshots
python3 scripts/d4-report.py            # regenerates this file from the run
```

---

## A. 70 / 70 decisions viewable

**70 run rows over 60 distinct decisions.** The
10 scenario-7 rows are replays: the contract returns the *original*
decision for a repeated `intent_hash` — that idempotence is the behaviour SOW §5.2
scenario 7 tests — so those rows deliberately re-resolve a reference an earlier row
already loaded. Reported here as run rows, never as distinct decisions.

Each row is one load of `https://aegis-production-2216.up.railway.app/decision/<decision_id>`.

| # | Scenario | Expected verdict / reason | Rows | Rendered correctly |
| --- | --- | --- | ---: | ---: |
| 1 | Compliant intent | Approved / Ok | 10 | 10 / 10 |
| 2 | Amount over `per_intent_cap` | Rejected / CapExceeded | 10 | 10 / 10 |
| 3 | Service not whitelisted | Rejected / ServiceNotAllowed | 10 | 10 / 10 |
| 4 | Asset not the policy asset | Rejected / AssetMismatch | 10 | 10 / 10 |
| 5 | Above `approval_threshold`, at or under `per_intent_cap` | RequiresApproval / PendingApproval | 10 | 10 / 10 |
| 6 | Revoked agent | Rejected / AgentRevoked | 10 | 10 / 10 |
| 7 | Replay of an already-authorized `intent_hash` | Approved / Ok, Rejected / AgentRevoked, Rejected / AssetMismatch, Rejected / CapExceeded, Rejected / ServiceNotAllowed, RequiresApproval / PendingApproval | 10 | 10 / 10 |

### Every run

`ledger_seq` and `policy_version` are checked too: a page that showed the right
verdict against the wrong ledger would not be the same decision.

| # | Scn | Expected verdict / reason | Rendered verdict | Rendered reason_code | policy_v | ledger_seq | decision_id | Replay | Load ms | Pass |
| ---: | ---: | --- | --- | --- | ---: | ---: | --- | :---: | ---: | :---: |
| 1 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496439 | `37ba5f064522…` | — | 4128 | PASS |
| 2 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496441 | `c177db1ad47a…` | — | 2649 | PASS |
| 3 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496443 | `510dfd9c5002…` | — | 2916 | PASS |
| 4 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496445 | `b5b819ebd909…` | — | 2899 | PASS |
| 5 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496447 | `40a865d180b7…` | — | 4150 | PASS |
| 6 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496449 | `55ae5ac7c7ea…` | — | 2148 | PASS |
| 7 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496451 | `6d68b160c443…` | — | 2818 | PASS |
| 8 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496453 | `63e95f08b307…` | — | 2151 | PASS |
| 9 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496455 | `8fae4f435efb…` | — | 2914 | PASS |
| 10 | 1 | Approved / Ok | Approved | `Ok` | v1 | 4496457 | `f4f74405eb37…` | — | 2681 | PASS |
| 11 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496459 | `408cf2f0935d…` | — | 2432 | PASS |
| 12 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496461 | `f8e0e1e63754…` | — | 2151 | PASS |
| 13 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496463 | `d15fa65d8283…` | — | 2942 | PASS |
| 14 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496465 | `bcce910b3f52…` | — | 2413 | PASS |
| 15 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496467 | `066a6a9cb511…` | — | 2896 | PASS |
| 16 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496469 | `57e923505f64…` | — | 3414 | PASS |
| 17 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496471 | `e69f9826e6f2…` | — | 2655 | PASS |
| 18 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496473 | `ec88a1d62bef…` | — | 2236 | PASS |
| 19 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496475 | `7d2306e48974…` | — | 8943 | PASS |
| 20 | 2 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496477 | `a5aaa7fc5114…` | — | 4678 | PASS |
| 21 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496479 | `d832df75af0d…` | — | 2147 | PASS |
| 22 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496481 | `ab9005b7c3a1…` | — | 2910 | PASS |
| 23 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496483 | `6f1ad0a952de…` | — | 2415 | PASS |
| 24 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496485 | `ac627fa8d21f…` | — | 2909 | PASS |
| 25 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496487 | `f4f3f233c42f…` | — | 2910 | PASS |
| 26 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496489 | `5fe15f5568aa…` | — | 2924 | PASS |
| 27 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496491 | `c70e6f5513cb…` | — | 2909 | PASS |
| 28 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496493 | `9c128f273e4a…` | — | 3169 | PASS |
| 29 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496495 | `fb1ddecc6553…` | — | 2921 | PASS |
| 30 | 3 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496497 | `b8bcd6b6383f…` | — | 2662 | PASS |
| 31 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496499 | `c3ed7752f076…` | — | 2973 | PASS |
| 32 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496501 | `ef6bd07564a1…` | — | 2758 | PASS |
| 33 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496503 | `1e90628c4348…` | — | 2203 | PASS |
| 34 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496505 | `ff6f915a9b59…` | — | 3032 | PASS |
| 35 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496507 | `09618457eac4…` | — | 2712 | PASS |
| 36 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496509 | `331dc90eadac…` | — | 2779 | PASS |
| 37 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496511 | `4dcf053efe16…` | — | 2827 | PASS |
| 38 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496513 | `4e6c02a63bc7…` | — | 2725 | PASS |
| 39 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496515 | `aabb98be43cc…` | — | 2157 | PASS |
| 40 | 4 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496517 | `ce4efb19a102…` | — | 2413 | PASS |
| 41 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496519 | `1d651d411289…` | — | 2967 | PASS |
| 42 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496521 | `5994dc08b3be…` | — | 4632 | PASS |
| 43 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496523 | `2a3be4669e88…` | — | 2423 | PASS |
| 44 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496525 | `f97d0c24ee73…` | — | 4049 | PASS |
| 45 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496527 | `cc85a311394a…` | — | 4010 | PASS |
| 46 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496529 | `bca4ee8ef5db…` | — | 3684 | PASS |
| 47 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496531 | `e6626156dec0…` | — | 3759 | PASS |
| 48 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496533 | `bfd69205d214…` | — | 2923 | PASS |
| 49 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496535 | `9959dd830f76…` | — | 2916 | PASS |
| 50 | 5 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496537 | `f4c5185e93d1…` | — | 3287 | PASS |
| 51 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496539 | `d55798d442c6…` | — | 2923 | PASS |
| 52 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496541 | `0a88a05e1063…` | — | 3130 | PASS |
| 53 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496543 | `6576903a68ea…` | — | 2965 | PASS |
| 54 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496545 | `3f2a21e39d8b…` | — | 2916 | PASS |
| 55 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496547 | `e59dfab14b43…` | — | 2663 | PASS |
| 56 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496549 | `9edf6429a9d2…` | — | 4441 | PASS |
| 57 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496551 | `6fb3d3636177…` | — | 2923 | PASS |
| 58 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496553 | `2950696a1a3a…` | — | 2771 | PASS |
| 59 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496555 | `f70462f846b1…` | — | 4473 | PASS |
| 60 | 6 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496557 | `46cd727e7655…` | — | 3415 | PASS |
| 61 | 7 | Approved / Ok | Approved | `Ok` | v1 | 4496439 | `37ba5f064522…` | yes | 2924 | PASS |
| 62 | 7 | Approved / Ok | Approved | `Ok` | v1 | 4496447 | `40a865d180b7…` | yes | 3414 | PASS |
| 63 | 7 | Approved / Ok | Approved | `Ok` | v1 | 4496457 | `f4f74405eb37…` | yes | 2430 | PASS |
| 64 | 7 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496459 | `408cf2f0935d…` | yes | 3223 | PASS |
| 65 | 7 | Rejected / CapExceeded | Rejected | `CapExceeded` | v1 | 4496477 | `a5aaa7fc5114…` | yes | 2728 | PASS |
| 66 | 7 | Rejected / ServiceNotAllowed | Rejected | `ServiceNotAllowed` | v1 | 4496493 | `9c128f273e4a…` | yes | 2673 | PASS |
| 67 | 7 | Rejected / AssetMismatch | Rejected | `AssetMismatch` | v1 | 4496515 | `aabb98be43cc…` | yes | 2770 | PASS |
| 68 | 7 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496519 | `1d651d411289…` | yes | 3412 | PASS |
| 69 | 7 | RequiresApproval / PendingApproval | RequiresApproval | `PendingApproval` | v1 | 4496537 | `f4c5185e93d1…` | yes | 3932 | PASS |
| 70 | 7 | Rejected / AgentRevoked | Rejected | `AgentRevoked` | v1 | 4496553 | `2950696a1a3a…` | yes | 3048 | PASS |

**70 / 70.** Every row rendered the verdict and reason code the chain recorded at run time, with the matching `policy_version` and `ledger_seq`.

---

## B. 10 / 10 transaction links live

A link is counted live only if **all four** hold:

1. Horizon returns the transaction and reports `successful: true`;
2. the Stellar Expert **API** returns the same hash (its *page* is a single-page app
   and answers HTTP 200 for a hash that has never existed — see the control below);
3. the transaction carries a `MEMO_HASH`; and
4. that memo equals the `memo_hash()` **the console rendered from the contract** for
   this decision. This is the step that makes it the *correct* transaction rather
   than merely a transaction that exists.

| # | Case | decision_id | Console page | settled | memo_hash() ≡ tx MEMO_HASH | Horizon | Expert API | Transaction | Pass |
| ---: | --- | --- | :---: | :---: | :---: | ---: | ---: | --- | :---: |
| 1 | `s01` | `b62b0ce89c7e…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [fb025c010c5a…](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) | PASS |
| 2 | `s02` | `94d56d8ca369…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [432c0d7de523…](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) | PASS |
| 3 | `s03` | `c4d77369099a…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [face6424cc52…](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) | PASS |
| 4 | `s04` | `7ae3e83b024a…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [a8a991c42226…](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) | PASS |
| 5 | `s05` | `60dcb6be99ae…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [3112ecec2dd2…](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) | PASS |
| 6 | `s06` | `f188da876568…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [87c09c1f4db5…](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) | PASS |
| 7 | `s10` | `17594051cc98…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [c9242c10dd5f…](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) | PASS |
| 8 | `s18` | `37c793a5e1e7…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [bc3cf80bbb1a…](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) | PASS |
| 9 | `s19` | `3c605cc0e1fe…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [6d7bd2994128…](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) | PASS |
| 10 | `s20` | `c1e498ed8b87…` | Approved / `Ok` | true | yes | 200 `successful: true` | 200 | [92638827bb8c…](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) | PASS |

**10 / 10.** Every link resolves on Horizon, is reported by the Stellar Expert API under the same hash, and carries a `MEMO_HASH` identical to the `memo_hash()` the console read from the contract on the page above it.

### How the console gets to that link

The contract records **that** a decision was settled. It never records **which**
Stellar transaction did it, so there is no `settlement_tx_hash` to read on-chain.

The console does **not** solve that by asking the AEGIS API to name the
transaction — that would ask a reviewer to trust the party under review to name its
own receipt. `memo_hash()` is computed **by the contract** over
`intent_hash ‖ policy_version ‖ decision_id`, and the settle transaction has to
carry exactly those 32 bytes as its `MEMO_HASH`. So the page **searches** the
published settlement accounts on Horizon for a transaction carrying that memo, and
tags what it finds *derived from ledger* — a third provenance tier, distinct from
both *read from chain* and *display only*.

The link is therefore a **consequence of public data**, not a claim. Horizon is
Stellar infrastructure, not an AEGIS service, so §6.3's *“independently of the AEGIS
database”* survives intact — this deployment in fact runs with
`/health` reporting `database: degraded`, and the
links below still render.

**The console rendered 10 of 10.** Each rendered hash
below was read back out of the page text and compared against the settlement
receipt — the browser and the receipt agree, having reached the answer by
different routes.

| # | Rendered by the console | Tagged | Matches the receipt |
| --- | --- | --- | :---: |
| 1 | [`fb025c010c5a7064…`](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) | *derived from ledger* | ✅ |
| 2 | [`432c0d7de523dea1…`](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) | *derived from ledger* | ✅ |
| 3 | [`face6424cc52cb29…`](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) | *derived from ledger* | ✅ |
| 4 | [`a8a991c42226f1dd…`](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) | *derived from ledger* | ✅ |
| 5 | [`3112ecec2dd2a715…`](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) | *derived from ledger* | ✅ |
| 6 | [`87c09c1f4db564f3…`](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) | *derived from ledger* | ✅ |
| 7 | [`c9242c10dd5fe72d…`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) | *derived from ledger* | ✅ |
| 8 | [`bc3cf80bbb1a7708…`](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) | *derived from ledger* | ✅ |
| 9 | [`6d7bd29941280801…`](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) | *derived from ledger* | ✅ |
| 10 | [`92638827bb8c7a99…`](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) | *derived from ledger* | ✅ |

Reproduce it without the console: fetch
`/accounts/<executor>/transactions` from Horizon and look for the transaction whose
base64 `memo` decodes to the `memo_hash()` printed on the page. That is the same
scan `tools/verifier` runs for check X3.

---

## C. Controls — the checks that had to fail

A console that renders a verdict for anything you paste into it proves nothing.
These ran in the same session as the rows above.

| Control | Expected | Observed | Pass |
| --- | --- | --- | :---: |
| well-formed reference that was never issued | `not-found`, no verdict | `not-found`, verdict none | PASS |
| malformed reference (48 hex characters, not 64) | `invalid-reference`, no verdict | `invalid-reference`, verdict none | PASS |
| a transaction hash that is not on the ledger | Horizon 404, Expert API 404 | Horizon 404, Expert API 404, Expert **page** 200 | PASS |

The last row is the reason the Stellar Expert *page* status is not used as
evidence anywhere in this pack:

> The Stellar Expert PAGE answers 200 for a non-existent hash because it is a single-page app that resolves the hash client-side. Horizon and the Stellar Expert API answer 404. Only the latter two, plus the MEMO_HASH match, support the claim that a link opens the correct transaction.

---

## D. Screenshots

Captured by the same browser, in the same run, from the live console.
`d4-screenshots/README.md` says what each one is for.

| File | Shows | Rendered verdict | Reason code | Page |
| --- | --- | --- | --- | --- |
| [`approved-full-chain.png`](d4-screenshots/approved-full-chain.png) | D2 case s10 — approved after the owner's on-chain resolve(), then settled | Approved | `Ok` | <https://aegis-production-2216.up.railway.app/intent/9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a> |
| [`refused-owner-rejected.png`](d4-screenshots/refused-owner-rejected.png) | D2 case s15 — escalated by policy, then declined by hand: OwnerRejected | Rejected | `OwnerRejected` | <https://aegis-production-2216.up.railway.app/decision/03defcb77539553dac3b4d96ed2b6e6c31aa57b999da307dc2b67c62d125cee7> |
| [`refused-agent-revoked.png`](d4-screenshots/refused-agent-revoked.png) | D1 run 58 — a revoked agent asking for 9999.9999999 EURC from an unlisted service: every other rule is broken too, and the contract still answers AgentRevoked | Rejected | `AgentRevoked` | <https://aegis-production-2216.up.railway.app/decision/2950696a1a3ab5005a1e378d45ed1e64e4f773152208450d78724fa6547a72f8> |
| [`refused-cap-exceeded.png`](d4-screenshots/refused-cap-exceeded.png) | D2 case s11 — above the per-intent cap | Rejected | `CapExceeded` | <https://aegis-production-2216.up.railway.app/decision/c942b69f7af06b0172aa39f81e3e42412a9b83c4b8fbfdebe0b9411d314b9db2> |
| [`home.png`](d4-screenshots/home.png) | the lookup form a reviewer lands on | — | — | <https://aegis-production-2216.up.railway.app/> |

---

Raw per-check records, including the SHA-256 of the rendered text of every page:
`d4-console-verification.json`.
