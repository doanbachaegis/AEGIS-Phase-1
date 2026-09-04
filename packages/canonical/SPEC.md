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

- `agent_id`, `service_id`, `asset`, `client_ref`: at most **255 bytes** once NFC-normalized and
  UTF-8 encoded. Bytes, not characters — 255 Vietnamese or CJK characters are well over the limit.
- `purpose`: at most **65535 bytes**, measured the same way.
- `amount`: an integer number of **stroops** (Stellar uses 7 decimal places,
  `1 USDC = 10_000_000 stroop`). It MUST be `> 0`. It MUST **never** be a float at any layer.
- `asset` uses the canonical form `CODE:ISSUER`. Phase 1 has exactly one value for it, and it is
  pinned in §5 along with the SAC it maps to.

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

## 3. `decision_id`

**Settled 2026-09-04** — `DECISIONS.md` #4, decided along with #1-#3 and now deployed. The
derivation is **deterministic**:

```
decision_id = sha256( "AEGIS-DECISION-v1" || intent_hash[32] || policy_version_be_u32[4] )
```

Benefit: a reviewer can recompute `decision_id` from public data without having to trust AEGIS.
Trade-off: `decision_id` carries no entropy of its own — which is fine, because `intent_hash` is
already the unique key.

## 4. Test vectors

`vectors/canonical-vectors.json` is the **shared fixture**. Both the Rust implementation
(`contracts/authorization`) and the TypeScript one (`packages/canonical`) **assert against it** —
neither side generates it at CI time. A generator cannot check itself.

A single byte of divergence between Rust and TS turns CI red immediately, rather than waiting
until Week 4.

## 5. `asset` — the two forms, and how they line up

`asset` exists in two shapes that are **not interchangeable**:

| Where | Form | What it is for |
|---|---|---|
| `canonical_intent` field 4 (§1) | `"CODE:ISSUER"` UTF-8 string | hashed into `intent_hash`; never parsed by anything |
| contract `Policy.allowed_asset`, `Decision.asset` | Soroban `Address` — the asset's SAC | compared `Address` to `Address` on `authorize()` |

### The Phase 1 value

Phase 1 is **testnet USDC only**, so there is exactly one pair. These are *the* values, not an
example of the shape:

| | |
|---|---|
| network | Testnet — passphrase `Test SDF Network ; September 2015` |
| issuer | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet USDC) |
| `asset` string, hashed into field 4 | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| SAC `Address`, held on-chain | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

The string is hashed **verbatim** — no trimming, no case folding, no re-encoding of the issuer.
A reviewer who wants to recompute `intent_hash` copies it exactly as written above.

### The derivation, not just the result

```bash
stellar contract id asset \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet
# CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

A SAC address is a **deterministic function of exactly three inputs** — the network passphrase, the
asset code, and the issuer account — with no AEGIS-controlled input anywhere in it: no AEGIS key
signs it, no AEGIS deployment creates it, and running the command on any machine yields the same
address. That is what makes the row above *checkable* rather than asserted (§6.1), and it is why
the command matters more than the value it prints.

### The limitation, stated plainly

**Nothing on-chain links the SAC to the `CODE:ISSUER` string.** `authorize()` takes `intent_hash`
and `asset: Address` as *separate arguments*: the contract compares the `Address`, and the string
lives only inside the `intent_hash` preimage, where it is hashed and never inspected. So no
decision, on its own, proves that the `USDC:GBBD47IF...` a reviewer hashed is the same asset as the
`CBIELTK6...` the contract checked.

That binding is supplied by this section plus the reviewer's own run of the command above — it is a
**specification** guarantee, not a protocol one. A gateway that hashed one asset string while
passing a different SAC would produce a decision whose `intent_hash` still verifies; the mismatch
would only show up by reading this table. Phase 1 accepts that: with a single allowed asset the
mapping is one pinned pair rather than a lookup table (the gateway takes the SAC side from
`USDC_SAC_ADDRESS`, see `.env.example`), and D3 requires the verifier to check the settlement's
asset against the on-chain `Decision` independently (`DECISIONS.md` #6). A protocol-level fix
would mean hashing the SAC bytes into the canonical intent instead of the string, which changes
field 4 and therefore the ABI — out of scope after the Day 7 freeze.
