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
| D1 | On-Chain Authorization Contract | 🟢 contract + test suite done, **deployed on testnet** (see below) |
| D2 | Intent Gateway & Decision Binding | 🔴 skeleton — bindings and a live contract are now available |
| D3 | Decision-Gated Settlement | 🔴 skeleton — bindings and a live contract are now available |
| D4 | Reviewer Console & Evidence Pack | 🔴 skeleton |

### D1 on testnet

The contract is live and has ruled on a real intent: an **Approved** decision for **125000000
stroops** (12.5 USDC) at **ledger 4493376**, whose on-chain `memo_hash()` view returns exactly the
value `@aegis/canonical` computes off-chain. That is the Rust ↔ TS parity CI asserts against
`vectors/`, now confirmed against the chain rather than against a fixture.

```
decision_id  2fecca8477b306042f3206daffd12e1c40c8b33c0d75f811a647ff98b8bf761e
```

The instance that produced it is `CC5Z6O353YCXNX3TP2SKRZHBHHR3MFP4Y3VW7S57O3NYLU7ET5RRXOS4` —
recorded so the decision above can be looked up, **not pinned as final**. A redeploy is expected
shortly, and a dead address in the first file a reviewer opens is worse than no address. The
authoritative value is `CONTRACT_ID` in the environment (`.env.example`), which the gateway, the
executor and the console all read anyway; `packages/bindings` embeds no contract address either,
so a redeploy is a config change and not a code change.

## Before writing any more code

`DECISIONS.md` — `#1`–`#4` (the ABI questions) and `#5` (asset representation) are **settled as of
2026-09-04**, and the `⚠️ NOT YET FINALIZED` markers are gone from the code. The reasoning stays on
the page: a reviewer needs to see *why* the ABI looks the way it does, not just what it froze into.
`#6` (executor trust boundary) is open **by design** — it is a Phase 1 trust boundary, not an
undecided question.

`#7`–`#9` are **three ABI changes taken deliberately before the Week-1 freeze**, on the same date:
`caller: Address` as the first parameter of `authorize` / `mark_settled` (#7), and
`original_reason_code` (#8) and `resolved_policy_version` (#9) on `Decision`. They are being
implemented in `contracts/authorization/**` now. `#10` records the Phase 1 agent-key trust boundary
described under **Phase 1 boundaries** above.

Three things still need correcting in **the SOW itself**, not in the code:

- §4.1 D1 calls `intent_hash` **single-use**, while §5.2 scenario 7 and §6.3 both require it to be
  **idempotent**. The contract is idempotent, because that is the part being scored — the D1
  wording needs to be corrected to match (`DECISIONS.md` #1).
- §5.2 includes an adversarial test for cumulative-window boundaries, but its reason-code enum
  never names the code. The contract uses `WindowCapExceeded`; §5.2 needs it added
  (`DECISIONS.md` #3).
- 🚨 **NEW — the seventh SOW correction overall, and the one with the shortest fuse.** §4.1 D1
  prints the `authorize` signature verbatim, and the `caller` parameter (#7) makes that text
  **wrong**. It must land before submission:

  | | Text |
  |---|---|
  | **Before** | `authorize(intent_hash, agent_id, service_id, asset, amount) -> Decision` |
  | **After** | `authorize(caller, intent_hash, agent_id, service_id, asset, amount) -> Decision` |

  `mark_settled` takes `caller` first on the same terms, but the SOW never prints its signature, so
  that one needs no edit (`DECISIONS.md` #7).
