# AEGIS — Governed Agentic Payments on Stellar

> **Phase 1 MVP · Stellar Testnet · no real money**
>
> A governance layer for AI-driven payments. AEGIS **does not hold funds** and is **not a wallet
> for agents** — it sits between an agent's request and the actual movement of money.
>
> *Core principle: agents create intents; governance decides settlement.*

A payment cannot reach the ledger unless an authorization decision already exists **on-chain**,
and that payment carries a reference back to the decision.

## Phase 1 boundaries

- Runs on **Stellar Testnet**. No mainnet, no real money, no live service.
- Settlement runs between **AEGIS test accounts** — no payouts to real providers.
- **Testnet USDC only**. The console is publicly readable; **intent submission is not**.
- ⚠️ **Phase 1 trusts the executor key.** The memo commitment makes misuse *detectable*,
  not *impossible*. Phase 2 moves settlement into the contract — see `DECISIONS.md` #6.
- ⚠️ **Phase 1 puts the operator key and the agent keys in one process.** `authorize` needs two
  signatures — the caller (owner or operator) and the agent itself — and §4.1 D2 specifies
  `POST /v1/intents` as a *single synchronous request*, leaving no round trip in which an external
  agent could sign. So the gateway holds the agents' secret keys. The contract's *"a leaked
  operator key cannot impersonate another agent"* check still runs, but both signatures now come
  from **one trust domain**, so in deployment that property is **detectable, not impossible** —
  the same shape as the executor key above. Phase 2 restores it with a prepare/sign/submit round
  trip the SDK already supports (`signAuthEntries` on the agent's own machine), which changes
  D2's API surface and is therefore out of Phase 1 — see `DECISIONS.md` #10.

## Layout

```
contracts/authorization/   D1 · Soroban contract that issues authorization decisions
crates/canonical/          spec hash, Rust implementation
packages/canonical/        spec hash, TypeScript implementation  ⭐ single source of truth
packages/bindings/         generated from the local wasm — committed, CI checks for drift
apps/gateway/              D2 · POST /v1/intents, canonical hashing
apps/executor/             D3 · decision-gated settlement
apps/console/              D4 · reviewer verification console
tools/verifier/            D3 · independent verifier
vectors/                   shared test fixtures for Rust ↔ TS
```

## Three invariants that must not be violated

These are *acceptance criteria*, not coding preferences.

**1. The hash is computed in exactly one place.** `packages/canonical` (TS) and `crates/canonical` (Rust)
implement the same `SPEC.md`, and **both assert against** `vectors/canonical-vectors.json`.
Neither side generates the fixtures at CI time — a generator cannot check itself.

**2. The console reads Soroban RPC directly.** §6.3 requires a decision to be readable by contract ID
*"independently of the AEGIS database"*. Verdict / reason code / policy version come from the
chain; `purpose` and `client_ref` come from the AEGIS API and **must be labeled as secondary data**.

**3. Money is `bigint` / `i128`, denominated in stroops.** Stellar uses 7 decimal places.
No `number` anywhere along the path of `amount`. A single accidental float silently corrupts
`per_intent_cap` — precisely the *"Budget drift"* failure mode this project is selling
a solution for.

## Getting started

```bash
pnpm install
cargo test                    # 7 scenarios from §5.2 + adversarial suite
pnpm test                     # Rust ↔ TS parity
```

Toolchain: Node ≥ 24 (`.nvmrc`), Rust stable plus the `wasm32v1-none` target
(`rust-toolchain.toml` installs it automatically), and the [`stellar` CLI](https://developers.stellar.org/docs/tools/cli).

### Deploy + bindings

```bash
cargo build --target wasm32v1-none --release
stellar contract deploy --wasm target/wasm32v1-none/release/aegis_authorization.wasm --network testnet
stellar contract invoke --id C... --network testnet -- init --owner G...   # SEPARATE call — see below
pnpm bindings
```

**`stellar contract deploy … -- init --owner …` does not run `init`.** CLI 28 only invokes
`__constructor` as part of a deploy, and this contract exposes `init` as an ordinary function.
The deploy succeeds, reports a contract ID, and initializes nothing — after which **every** call
answers `Error(Contract, #1)` / `NotInitialized` until `init` is invoked as its own
`stellar contract invoke`. Budget the extra step; the failure looks like a broken contract.

**`AgentStatus` is `#[repr(u32)]` — pass `0`, not `"Active"`.** `soroban-spec-tools` 28 *panics*
on the string form instead of reporting a type error, so the CLI stack trace points nowhere near
the actual mistake. `0` = `Active`, `1` = `Revoked`.

`packages/bindings` is generated from the **local wasm** — no RPC, no deployed contract, no
`CONTRACT_ID` — and the output is **committed**, so a fresh clone builds without a Rust toolchain
or the `stellar` CLI. Do not hand-write it: re-run `pnpm bindings` whenever the contract changes,
and the `bindings-drift` CI job fails on any diff, so ABI drift shows up as a compile error
instead of a runtime failure.

## Status

| | Deliverable | Status |
|---|---|---|
| D1 | On-Chain Authorization Contract | 🟢 **done** — deployed on testnet, **70/70** across the seven §5.2 scenarios |
| D2 | Intent Gateway & Decision Binding | 🟢 **done** — **20/20** submissions, hashes reproducible, 0 bypasses |
| D3 | Decision-Gated Settlement | 🟢 **done** — **10/10** settled and verified, **10/10** replays refused |
| D4 | Reviewer Console & Evidence Pack | 🟡 **evidence pack done; console implemented but not deployed** |

The evidence for all four lives in [`evidence/`](evidence/). Start at
[`evidence/README.md`](evidence/README.md) — it explains how to verify each claim without trusting
us, and [`evidence/INDEX.md`](evidence/INDEX.md) maps every SOW §6.1 artifact to the file that
satisfies it, including the ones still outstanding.

**The one gap:** `apps/console` is implemented but has no public URL, so the three §6.1 D4 artifacts
that need a live page — the public link, the two screenshots, and the "70/70 viewable" half of the
results table — do not exist yet. Everything they would show is in `evidence/` and readable on
chain today; what is missing is the no-setup way to see it.

### On testnet

Contract [`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA)
holds the decisions from both evidence runs — **60 distinct** from D1's 70 authorization calls and
**18 distinct** from D2's 20 submissions (the differences are the replays, which return the original
decision rather than writing a new one) — and has marked 10 of them settled against real testnet
USDC payments. Read any of them back with nothing but the contract ID:

```bash
stellar contract invoke \
  --id CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA \
  --network testnet --send=no --source-account <any-funded-testnet-account> \
  -- get_decision --decision_id b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec
```

`--send=no` makes that a simulation: it reads, costs nothing, and writes nothing. Reference values
for every decision are in [`evidence/d4-intent-references.md`](evidence/d4-intent-references.md).

The contract ID is **not pinned in code**. The authoritative value is `CONTRACT_ID` in the
environment (`.env.example`), which the gateway, the executor and the console all read;
`packages/bindings` embeds no contract address either, so a redeploy is a config change rather than
a code change.

> An earlier instance, `CC5Z6O353YCXNX3TP2SKRZHBHHR3MFP4Y3VW7S57O3NYLU7ET5RRXOS4`, carries the
> first decision this project ever recorded — 125000000 stroops at ledger 4493376, `decision_id`
> `2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e`. It is still readable, but it
> predates the `#7`–`#9` ABI changes below, so its `Decision` has no `original_reason_code` and no
> `resolved_policy_version`. **It is history, not the current deployment** — no evidence in
> `evidence/` refers to it.

## Design decisions, and what the SOW still gets wrong

`DECISIONS.md` — `#1`–`#4` (the ABI questions) and `#5` (asset representation) are **settled as of
2026-09-04**, and the `⚠️ NOT YET FINALIZED` markers are gone from the code. The reasoning stays on
the page: a reviewer needs to see *why* the ABI looks the way it does, not just what it froze into.
`#6` (executor trust boundary) is open **by design** — it is a Phase 1 trust boundary, not an
undecided question.

`#7`–`#9` are **three ABI changes taken deliberately before the Week-1 freeze**, on the same date:
`caller: Address` as the first parameter of `authorize` / `mark_settled` (#7), and
`original_reason_code` (#8) and `resolved_policy_version` (#9) on `Decision`. All three are
**implemented and live** — the deployed contract returns both new fields, and every decision in
`evidence/` was judged by that ABI. `#10` records the Phase 1 agent-key trust boundary described
under **Phase 1 boundaries** above.

Three things still need correcting in **the SOW itself**, not in the code:

- §4.1 D1 calls `intent_hash` **single-use**, while §5.2 scenario 7 and §6.3 both require it to be
  **idempotent**. The contract is idempotent, because that is the part being scored — the D1
  wording needs to be corrected to match (`DECISIONS.md` #1).
- §5.2 includes an adversarial test for cumulative-window boundaries, but its reason-code enum
  never names the code. The contract uses `WindowCapExceeded`; §5.2 needs it added
  (`DECISIONS.md` #3).
- §4.1 D1 prints the `authorize` signature verbatim, and the `caller` parameter (#7) makes that
  text **wrong**. This is the seventh SOW correction overall and the one with the shortest fuse —
  it must land before submission:

  | | Text |
  |---|---|
  | **Before** | `authorize(intent_hash, agent_id, service_id, asset, amount) -> Decision` |
  | **After** | `authorize(caller, intent_hash, agent_id, service_id, asset, amount) -> Decision` |

  `mark_settled` takes `caller` first on the same terms, but the SOW never prints its signature, so
  that one needs no edit (`DECISIONS.md` #7).
