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

## Layout

```
contracts/authorization/   D1 · Soroban contract that issues authorization decisions
crates/canonical/          spec hash, Rust implementation
packages/canonical/        spec hash, TypeScript implementation  ⭐ single source of truth
packages/bindings/         generated from the ABI — not committed
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
CONTRACT_ID=C... pnpm bindings
```

`packages/bindings` is generated — **do not hand-write it**. Re-run it whenever the contract is
bumped; any ABI drift then shows up as a compile error instead of a runtime failure.

## Status

| | Deliverable | Status |
|---|---|---|
| D1 | On-Chain Authorization Contract | 🟡 contract + test suite done, **not yet deployed** |
| D2 | Intent Gateway & Decision Binding | 🔴 skeleton, waiting on bindings |
| D3 | Decision-Gated Settlement | 🔴 skeleton, waiting on bindings |
| D4 | Reviewer Console & Evidence Pack | 🔴 skeleton |

## Before writing any more code

`DECISIONS.md` — **4 ABI questions that must be settled before Day 7** (`#1`–`#4`), plus two
decisions on the same page that sit outside that freeze: `#5` (asset representation — same
deadline, but outside the ABI proper) and `#6` (executor trust boundary — not a Day 7 blocker,
but it must be written down). The scaffold already implements a working default for each one,
marked `⚠️ NOT YET FINALIZED` in the code.

Worth noting: the SOW contradicts itself over whether `intent_hash` is single-use (§4.1 D1)
or idempotent (§5.2 scenario 7 + §6.3). The scaffold chooses **idempotent**, because that is
the part being scored — **and the D1 wording in the SOW needs to be corrected to match**.
