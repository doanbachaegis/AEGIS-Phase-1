# AEGIS Canonical Serialization Spec

> Deliverable D2 evidence: *"Published canonical serialization spec"* (SOW §6.1).
> Reviewers use this document together with `vectors/canonical-vectors.json` to recompute
> `intent_hash` themselves and confirm it matches the hash the contract ruled on.

All integers are **big-endian**. All strings are **UTF-8, NFC-normalized**, and carry a length
prefix. JSON is not used — its key ordering and number encoding are unspecified.

## 1. `canonical_intent` — byte layout

Domain: `AEGIS-INTENT-v1`

| # | Field | Encoding | Bytes |
|---|---|---|---|
| 1 | magic | ASCII `AEGIS-INTENT-v1` | 15 |
| 2 | `agent_id` | `u8` length prefix + UTF-8 | 1 + n |
| 3 | `service_id` | `u8` length prefix + UTF-8 | 1 + n |
| 4 | `asset` | `u8` length prefix + UTF-8 | 1 + n |
| 5 | `amount` | `i128` BE, two's complement, **denominated in stroops** | 16 |
| 6 | `purpose` | `u16` BE length prefix + UTF-8 | 2 + n |
| 7 | `client_ref` | `u8` length prefix + UTF-8 | 1 + n |

```
intent_hash = sha256(canonical_intent)      // 32 bytes
```

### Constraints

- `agent_id`, `service_id`, `asset`, `client_ref`: at most **255 bytes** once UTF-8 encoded.
- `purpose`: at most **65535 bytes**.
- `amount`: an integer number of **stroops** (Stellar uses 7 decimal places,
  `1 USDC = 10_000_000 stroop`). It MUST be `> 0`. It MUST **never** be a float at any layer.
- `asset` uses the canonical form `CODE:ISSUER`, for example `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

> The length prefix is what guards against **ambiguity**: without it,
> `agent_id="ab", service_id="c"` and `agent_id="a", service_id="bc"` yield the same byte string.

## 2. `memo_hash` — the commitment attached to the transaction

```
memo_hash = sha256( intent_hash[32] || policy_version_be_u32[4] || decision_id[32] )
```

The preimage totals **68 bytes**. The result fits exactly into Stellar's 32-byte `MEMO_HASH` field.

Matches the §6.3 acceptance criteria **verbatim**:
`sha256(intent_hash || policy_version || decision_id)`.

No domain separator is added here — all three fields are **fixed-width**, so the concatenation is
already unambiguous. The genuine ambiguity in the original formula is *how `policy_version` is
encoded*, and this spec pins it to a 4-byte big-endian `u32`.

## 3. `decision_id` — ⚠️ ABI NOT YET FINALIZED

The scaffold currently assumes a **deterministic derivation**:

```
decision_id = sha256( "AEGIS-DECISION-v1" || intent_hash[32] || policy_version_be_u32[4] )
```

Benefit: a reviewer can recompute `decision_id` from public data without having to trust AEGIS.
See `DECISIONS.md` at the repository root — this is 1 of the 4 questions that must be settled
before the ABI freeze (Day 7).

## 4. Test vectors

`vectors/canonical-vectors.json` is the **shared fixture**. Both the Rust implementation
(`contracts/authorization`) and the TypeScript one (`packages/canonical`) **assert against it** —
neither side generates it at CI time. A generator cannot check itself.

A single byte of divergence between Rust and TS turns CI red immediately, rather than waiting
until Week 4.
