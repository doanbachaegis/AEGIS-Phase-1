# `aegis-verify` — standalone settlement verifier

> Deliverable **D3** evidence (SOW §4.1, §6.1, §6.3): *"an independent verifier that
> confirms the settlement matches the on-chain decision."*

Given one transaction hash and one receipt, `aegis-verify` answers a single question:

> **Is this payment the payment the contract authorized?**

It answers it from **public data only** — Horizon and Soroban RPC — and it says which
source every individual answer came from.

## The two invariants

These are not implementation preferences. They are what the tool is *for*, and weakening
either one leaves a program that proves nothing.

1. **It never calls the AEGIS API.** Every fact is read from Horizon, from Soroban RPC,
   from the committed service registry, or derived locally from those.
2. **It never imports `@aegis/bindings`.** The contract ABI is fetched from the chain with
   `contract.Client.from({ contractId, rpcUrl, networkPassphrase })`, so a reviewer can run
   the tool against a contract ID with no AEGIS workspace built and no generated artefact
   to trust. Even the `Verdict` enum's case names are read from the on-chain spec rather
   than hardcoded.

The dependency surface is deliberately three packages: `@stellar/stellar-sdk`,
`@aegis/canonical` and `@aegis/receipt`.

## Usage

```bash
aegis-verify --tx <hash> --receipt receipt.json [options]
```

| Option | Default |
|---|---|
| `--horizon <url>` | `receipt.network.horizon` |
| `--rpc <url>` | `receipt.network.rpc` |
| `--contract <C…>` | `receipt.network.contract_id` |
| `--network <passphrase>` | `receipt.network.passphrase` |
| `--registry <path>` | `services.json` beside the receipt, then `./services.json` |
| `--strict` | off — adds the `decision_id` derivation and the settle-ordering check |
| `--json` | off — machine-readable output |

Defaults come from the receipt itself and every one of them can be overridden, so a
reviewer who does not trust the receipt's own URLs can point the tool at their own
infrastructure. There are **no environment variables and no secrets**: the tool only ever
reads.

## Exit codes

| Code | Verdict | Meaning |
|---|---|---|
| `0` | VERIFIED | every property was checked and holds |
| `1` | FAILED | at least one property is contradicted by the chain |
| `2` | USAGE | bad arguments |
| `3` | UNAVAILABLE | nothing was contradicted, but at least one property **could not be checked** |

`3` is the one that matters. *"Could not check"* and *"checked and fine"* are different
statements, and a verifier that collapses them is worse than no verifier: a network blip
would read as a clean settlement. A check that cannot run is printed as `????` and moves
the exit code to 3. A detected mismatch outranks it — a real finding does not become less
true because some other source was unreachable.

## What is checked

Each line of the report carries the **source** of its evidence. Read that column down the
page and the independence claim checks itself.

| Source | Property |
|---|---|
| `receipt` | the receipt parses as `aegis-receipt/1`; `--tx` is the transaction it describes |
| `registry` | the contract queried is the one `services.json` publishes |
| `horizon` | the transaction exists and `successful == true` |
| `horizon` | exactly **one** operation, and it is a `payment` |
| `horizon` | `memo_type == "hash"`, decoding to exactly 32 bytes |
| `soroban-rpc` | `get_decision` succeeds **from the contract ID alone** |
| `soroban-rpc` | `verdict == Approved` |
| `soroban-rpc` | `settled == true` |
| `soroban-rpc` | all seven fields of the receipt's `chain` block match the decision |
| `receipt` | the `memo_hash` the receipt states is the one on the ledger |
| **`derived`** | **`memoHash(intent_hash, policy_version, decision_id)` == the on-ledger memo** |
| `soroban-rpc` | the contract's own `memo_hash()` view == the on-ledger memo |
| `receipt` | the receipt's 68-byte preimage hashes to the on-ledger memo |
| `horizon` | `parseAmount(op.amount) == decision.amount` |
| `derived` | `new Asset(code, issuer).contractId(passphrase) == decision.asset` |
| `registry` | the payee is the published destination for the decision's `service_id` |
| `registry` | the source is the published executor account |
| `derived` | *(strict)* `decision_id == sha256("AEGIS-DECISION-v1" ‖ intent_hash ‖ policy_version)` |
| `soroban-rpc` | *(strict)* `mark_settled` was written at or before the payment's ledger |
| `horizon` | exactly one successful transaction carries this memo |

### The one that matters

```
MEMO_HASH == sha256( intent_hash || policy_version_be_u32 || decision_id )
```

This is the §6.3 acceptance criterion, and it is what turns a payment on a public ledger
into a payment that provably refers to one specific governance decision: the memo was
fixed when the transaction was signed and cannot be edited afterwards.

It is checked **three independent ways** — recomputed locally by `@aegis/canonical`,
recomputed *on chain* by the contract's own `memo_hash()` view (Rust, not TypeScript), and
hashed from the receipt's own 68-byte preimage. A bug in `@aegis/canonical` cannot make a
settlement verify: all three would have to be wrong in the same way.

### Why the amount and the asset are checked *twice over*

The memo commits to `intent_hash`, `policy_version` and `decision_id` — and nothing else.
`amount`, `asset`, `service_id` and `agent` are **outside** the preimage, so a receipt
could restate them freely. They are therefore compared field by field against the decision
the contract actually holds, and the **chain**, never the receipt, is then the authority
for the amount and asset comparisons against Horizon.

The asset is *derived*, not trusted: Horizon reports the payment's code and issuer, and
`Asset(code, issuer).contractId(passphrase)` is a pure function of the network passphrase,
the code and the issuer with no AEGIS input anywhere in it (see `packages/canonical/SPEC.md`
§5). Recomputing it is what binds the `CODE:ISSUER` string to the SAC address the contract
compared.

### Why the registry is needed at all

`Decision` carries `service_id`, but **not a destination account** — the contract cannot and
does not constrain where the executor sends funds (DECISIONS.md #6, and the `trust_model`
block in `services.json`). Without a published mapping, any destination would satisfy any
decision. So a verified destination proves *"the payment went where the published registry
said"*, not *"where the contract required"*. Those are different claims and Phase 1 only
supports the weaker one. If no registry is found, those checks are `unavailable` — never a
pass.

### Scope of the replay scan

Horizon has no global memo index, so *"exactly one transaction on the network carries this
memo"* is approximated by walking the full history of the accounts the settlement touched:
the submitter and the payee. That is exactly where a double-settle would have to appear.
The accounts scanned are printed with the result, and if the history is longer than the
page cap the check reports `unavailable` rather than overstating what it saw.

## The receipt

A receipt is a **claim, never evidence**. Every field is something the verifier re-derives
from Horizon or Soroban RPC and then compares; nothing is believed because the receipt said
it. The schema lives in `packages/receipt`, shared so that the executor which *writes* the
claim and the verifier which *refutes* it cannot drift apart — the same discipline
`@aegis/canonical` applies to the hash preimages.

The blocks are split by **where the verifier goes to check them**:

| Block | Checked against |
|---|---|
| `network` | — how to reach the two public sources, plus the contract ID |
| `chain` | Soroban RPC — `get_decision(decision_id)` |
| `settlement` | Horizon — the transaction and its single payment operation |

All hashes are lowercase unprefixed hex. All amounts are **decimal strings of stroops**:
a JSON number cannot hold an `i128`, and the validator rejects one outright rather than
silently losing precision. See `examples/receipt.example.json` for a complete document.

```json
{
  "version": "aegis-receipt/1",
  "network": {
    "passphrase": "Test SDF Network ; September 2015",
    "contract_id": "CAAD6727VZDKH77IVZJ526B3YENMMU26DGHUEU3B4D6KK3JS5YTNTRPP",
    "horizon": "https://horizon-testnet.stellar.org",
    "rpc": "https://soroban-testnet.stellar.org"
  },
  "chain": {
    "decision_id": "<64 hex>",
    "intent_hash": "<64 hex>",
    "policy_version": 1,
    "agent": "G… or C…",
    "service_id": "openai-api",
    "asset": "C… (the SAC address held on chain)",
    "amount": "125000000",
    "//": "stroops, decimal string, > 0"
  },
  "settlement": {
    "tx_hash": "<64 hex>",
    "memo_hash": "<64 hex>",
    "memo_preimage": "<136 hex — intent_hash[32] || policy_version_be[4] || decision_id[32]>",
    "source": "G… (the executor)",
    "destination": "G… (the payee)",
    "asset": "USDC:GBBD47IF…"
  },
  "issued_at": "2026-09-04T10:00:00Z"
}
```

`issued_at` is optional and **non-authoritative** — nothing is checked against it.

`memo_preimage` is redundant with `chain` on purpose: it lets a reviewer hash one field of
the receipt and land on the on-ledger memo without re-implementing the byte layout. The
verifier checks both that it hashes correctly *and* that it spells out the receipt's own
`chain` fields, so a preimage cannot be consistent with the ledger while describing
something else.

The validator is hand-rolled with no schema library. The receipt is the one input that may
have been handed to a reviewer by the party under scrutiny, so parsing it is a trust
boundary, and that boundary stays readable in full in one file. It is **strict about
unknown fields** — a typo'd key would otherwise be silently ignored, and a field nobody
reads is a field nobody checks — and it reports *every* problem in one pass.

## Status

The contract-side checks run against the live testnet deployment today. The Horizon-side
checks have no live subject yet — Phase 1 has an approved decision on chain but no
settlement transaction, because the executor (`apps/executor`) is still a skeleton. They
are fully implemented and covered by fixture tests, including an end-to-end run of the
complete VERIFIED path with both sources stubbed; the first live settlement is what turns
those fixtures into a real run.
