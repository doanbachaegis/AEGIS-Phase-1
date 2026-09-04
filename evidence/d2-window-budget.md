# D2/D3 — cumulative window arithmetic

Generated 2026-09-04T07:26:14Z

`agent-1` has a tumbling window of **2 000 000 000 stroops (200.0000000 USDC) per
86400 seconds**. The contract charges the window **only when a verdict is
actually `Approved`** (`authorize`, and again inside `resolve` when the owner approves) — rejected
and still-pending intents cost nothing. The run was planned against that rule before it started.

| # | Case | Amount (stroops) | Verdict | Charged to window |
|--:|---|--:|---|---|
| 1 | `s01` | 15 000 000 | Approved | yes |
| 2 | `s02` | 22 500 000 | Approved | yes |
| 3 | `s03` | 30 000 000 | Approved | yes |
| 4 | `s04` | 45 000 000 | Approved | yes |
| 5 | `s05` | 50 000 000 | Approved | yes |
| 6 | `s06` | 62 500 000 | Approved | yes |
| 7 | `s07` | 75 000 000 | Approved | yes |
| 8 | `s08` | 80 000 000 | Approved | yes |
| 9 | `s09` | 97 500 000 | Approved | yes |
| 10 | `s10` | 300 000 000 | Approved | yes |
| 11 | `s11` | 750 000 000 | Rejected | no |
| 12 | `s12` | 50 000 000 | Rejected | no |
| 13 | `s13` | 50 000 000 | Rejected | no |
| 14 | `s14` | 260 000 000 | RequiresApproval | no |
| 15 | `s15` | 275 000 000 | Rejected | no |
| 16 | `s16` | 15 000 000 | Approved | no — idempotent replay, the contract returned the existing decision |
| 17 | `s17` | 750 000 000 | Rejected | no — idempotent replay, the contract returned the existing decision |
| 18 | `s18` | 1 | Approved | yes |
| 19 | `s19` | 123 456 789 | Approved | yes |
| 20 | `s20` | 10 000 000 | Approved | yes |

**Charged: 910 956 790 stroops = 91.0956790 USDC** of 200.0000000 available (45.5 % of the window).

On-chain window state after the run: `spent` = **910 956 790** stroops — matches the arithmetic above.

Two consequences worth stating:

- `s16`/`s17` are byte-identical replays. The contract is idempotent on `intent_hash`, so it returns
  the original decision and charges nothing. A replay that re-charged the window would let anyone
  exhaust an agent's budget by resubmitting its own traffic.
- Ten settlements moved 65.8456790 USDC,
  less than the 91.0956790 charged: `s07`, `s08` and `s09` are Approved and still unsettled.
  The window is a *spending authorization* budget, not a settlement ledger.

No `set_policy` call was made at any point, so the cap, the threshold and the policy version a
reviewer reads today are the ones every decision above was judged against.
