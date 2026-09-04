# AEGIS — reviewer README

**How to verify every claim in this evidence pack, without trusting us.**

> **Stellar Testnet. No real money.** Every account, asset and transaction referenced here is on
> Stellar's test network. The USDC is testnet USDC and has no value. Nothing in this pack touches
> mainnet.

This is the front door to SOW §6.1's evidence pack. It is written for two readers at once:

- **If you are scoring the deliverables**, read [Part 1](#part-1--in-one-minute) and
  [Part 6](#part-6--the-claims-mapped-to-63). You need no tools and no setup.
- **If you want to check the cryptography yourself**, [Part 3](#part-3--verify-it-yourself) gives
  copy-pasteable commands. They use `curl`, `jq`, `base64`, `xxd` and `shasum` — **no AEGIS code**.
  Every command below was run before this file was written, and the outputs shown are real.

`INDEX.md` maps each §6.1 artifact to the file that satisfies it, and says plainly which ones are
still outstanding. `d4-intent-references.md` is the list of intent references to test with.

---

## Part 1 — In one minute

AEGIS is a governance layer for AI-agent payments. The claim it makes is narrow and checkable:

> **A payment cannot reach the ledger unless an authorization decision already exists on-chain, and
> the payment carries a cryptographic reference back to that decision.**

The evidence for that claim is three runs against one live testnet contract:

| | What was run | Result |
|---|---|---|
| **D1** | The 7 policy scenarios from SOW §5.2, ten times each | **70 / 70** correct verdict *and* reason code |
| **D2** | 20 intents submitted through the gateway API | **20 / 20** hashes reproducible, 0 bypasses |
| **D3** | 10 real USDC payments on testnet, each replayed once | **10 / 10** verified, **10 / 10** replays refused, 0 second payments |

The contract is
[`CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA`](https://stellar.expert/explorer/testnet/contract/CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA).

### The no-setup check

**Open the console: <https://aegis-production-2216.up.railway.app>**

No login, no install, no key. Paste any reference from `d4-intent-references.md` into the lookup
box — or open one directly, for example
[an approved and settled intent](https://aegis-production-2216.up.railway.app/intent/9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a)
and
[one the owner refused by hand](https://aegis-production-2216.up.railway.app/decision/03defcb77539553dac3b4d96ed2b6e6c31aa57b999da307dc2b67c62d125cee7).
Every authoritative field on those pages is read live from the contract over Soroban RPC, with no
AEGIS database in the path; the page prints the `stellar contract invoke` command that reproduces
each value without the console at all. Refusals are shown with the same weight as approvals.

All 70 decisions and all 10 settlements were loaded through that console in a real browser and
checked field by field — **70/70 and 10/10**, in `d4-results.md`, which also states what that method
does not prove.

Or check the ledger directly, with no AEGIS software of any kind. Open any of these ten links. Each
is a real payment on the public testnet ledger. Each carries a
`MEMO_HASH` — a 32-byte fingerprint fixed at signing time that cannot be edited afterwards —
committing that payment to one specific governance decision.

| Amount | Transaction |
|---|---|
| 1.5000000 USDC | [`fb025c01…`](https://stellar.expert/explorer/testnet/tx/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9) |
| 2.2500000 USDC | [`432c0d7d…`](https://stellar.expert/explorer/testnet/tx/432c0d7de523dea14688c5a30fe8651af6d6f1dc06aafac0835543ed2dbe47db) |
| 3.0000000 USDC | [`face6424…`](https://stellar.expert/explorer/testnet/tx/face6424cc52cb29fdf41d5467c65988dd68165ec5569a2b021e789d743b9e32) |
| 4.5000000 USDC | [`a8a991c4…`](https://stellar.expert/explorer/testnet/tx/a8a991c42226f1dda2cad690e252cb63ace3250d70be4df59976d07ea63d5a4a) |
| 5.0000000 USDC | [`3112ecec…`](https://stellar.expert/explorer/testnet/tx/3112ecec2dd2a715bcc92d06d22a62750d220e7f9854c74187a4824dc4d3e96e) |
| 6.2500000 USDC | [`87c09c1f…`](https://stellar.expert/explorer/testnet/tx/87c09c1f4db564f3e8706f7c517f91b4d1aba58e15b709e6fb0abe7bf10800ef) |
| 30.0000000 USDC | [`c9242c10…`](https://stellar.expert/explorer/testnet/tx/c9242c10dd5fe72d96031f883c2af6803568dda7359e3ede55ed53795b70b127) |
| 0.0000001 USDC | [`bc3cf80b…`](https://stellar.expert/explorer/testnet/tx/bc3cf80bbb1a7708d403b0231aa6eb438857a36e889a788a1ab77c0ad0ede92e) |
| 12.3456789 USDC | [`6d7bd299…`](https://stellar.expert/explorer/testnet/tx/6d7bd2994128080192012dc7899fec768e97fb48615b81ceb3576d1bce91f07c) |
| 1.0000000 USDC | [`92638827…`](https://stellar.expert/explorer/testnet/tx/92638827bb8c7a99374021ea56dc1ab24d1e31a5df8d8723491e89a070c861cb) |

**All ten were re-checked against Horizon on 2026-09-04 while writing this file: all ten resolve,
all ten report `successful: true`, and all ten carry `memo_type: hash`.**

The total moved is **65.8456790 USDC**, which equals the sum of the ten decisions to the stroop.
The smallest, `0.0000001`, is one stroop — the smallest amount Stellar can represent. It is in the
set deliberately: it shows the amount path carries no floating-point arithmetic anywhere.

---

## Part 2 — Reason codes are `u32` on the wire

**Read this before checking any verdict.** SOW §5.2 names the failure paths in SCREAMING_SNAKE
(`CAP_EXCEEDED`, `SERVICE_NOT_ALLOWED`, …). The contract does not store those names. It stores a
`u32`, and a `u32` is what the chain, the exports and the API return.

Without this table, the acceptance criterion *"the correct verdict and reason code"* cannot be
checked at all — you would be comparing a name against a bare integer.

| `reason_code` | Name | Meaning |
| ---: | --- | --- |
| **0** | `Ok` | the intent passed every rule |
| **1** | `CapExceeded` | amount above `per_intent_cap` (§5.2 `CAP_EXCEEDED`) |
| **2** | `ServiceNotAllowed` | `service_id` not in `allowed_services` (§5.2 `SERVICE_NOT_ALLOWED`) |
| **3** | `AssetMismatch` | asset is not the policy asset (§5.2 `ASSET_MISMATCH`) |
| **4** | `AgentRevoked` | the agent was revoked (§5.2 `AGENT_REVOKED`) |
| **5** | `WindowCapExceeded` | the cumulative spending window is exhausted |
| **6** | `PendingApproval` | above `approval_threshold` — escalated to the owner |
| **7** | `OwnerRejected` | the owner refused it at `resolve()` |

`verdict` is a `u32` too:

| `verdict` | Name |
| ---: | --- |
| **0** | `Approved` |
| **1** | `Rejected` |
| **2** | `RequiresApproval` |

Two notes a reviewer will otherwise trip on:

- **Code `5` and code `7` have no SCREAMING_SNAKE name in §5.2.** §5.2's enum never names the
  cumulative-window code, and never names the owner-rejection code. The contract needs both. This
  is a gap in the SOW text, not a drift in the contract — it is tracked in `DECISIONS.md` #3.
- **`reason_code` can be rewritten; `original_reason_code` cannot.** When an owner resolves an
  escalated decision, `reason_code` moves from `PendingApproval` to `Ok` or `OwnerRejected`, but
  `original_reason_code` keeps its first value forever. So the chain itself records *that a human
  was required*, not merely how it ended up. Case `s10` is the worked example — see
  `d2-approval-trail.md`.

---

## Part 3 — Verify it yourself

Nothing below needs the AEGIS repo built, and nothing needs our API. Requirements: `curl`, `jq`,
`base64`, `xxd`, `shasum`. Steps 3.1 and 3.5 additionally need the
[`stellar` CLI](https://developers.stellar.org/docs/tools/cli); step 3.6 needs Node.

Run these from the repository root.

### 3.1 — Read a decision off the chain, from the contract ID alone

This is SOW §6.3's second criterion: *every decision can be read on-chain by contract ID,
independently of the AEGIS database.*

```bash
stellar contract invoke \
  --id CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA \
  --network testnet --send=no --source-account <any-funded-testnet-account> \
  -- get_decision --decision_id b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec
```

`--send=no` makes this a simulation — a read. It costs nothing and writes nothing. The account you
pass is only there to satisfy the CLI; it is never charged and never signs anything.

Actual output, run 2026-09-04:

```json
{"agent":"GAUU26AEOPD2HOKHAU46YNNTFY327BNN5BPWRX2Q65SJFUP2MNGOK3MH","amount":"15000000",
 "asset":"CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
 "decision_id":"b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec",
 "intent_hash":"1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c",
 "ledger_seq":4496428,"original_reason_code":0,"policy_version":1,"reason_code":0,
 "resolved":false,"resolved_policy_version":null,"service_id":"openai-api",
 "settled":true,"verdict":0}
```

`verdict: 0` is `Approved`, `reason_code: 0` is `Ok`. Note `amount` is in **stroops**: 15000000
stroops = 1.5000000 USDC. Stellar uses 7 decimal places.

**Refused decisions are readable exactly the same way** — they are not hidden. Try
`408cf2f0935d36818b070ca17800ffa36df44656dd95a028b5ab18a10bf8543b`, a D1 run that broke the
per-intent cap; it returns `verdict: 1` (`Rejected`), `reason_code: 1` (`CapExceeded`),
`amount: 500000001` against a cap of `500000000` — one stroop over.

Reference values for every decision are in `d4-intent-references.md`.

### 3.2 — Recompute an `intent_hash`

`intent_hash = sha256(canonical_intent)`. The canonical byte layout is published in
`packages/canonical/SPEC.md`, but **you do not need to read it to check the hash** — the gateway
transcript records the exact bytes it hashed, as `canonical_hex`.

The point of this check: it proves the intent the contract judged is the intent that was submitted.

```bash
jq -r 'select(.event=="intent.received" and .intent_hash=="1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c") | .canonical_hex' \
  evidence/d2-gateway.ndjson | head -1 | xxd -r -p | shasum -a 256
```

Output:

```
1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c  -
```

The hash equals the `intent_hash` you selected on. That is the whole check.

**All twenty at once:**

```bash
jq -r 'select(.event=="intent.received") | "\(.intent_hash) \(.canonical_hex)"' evidence/d2-gateway.ndjson |
while read -r want hex; do
  got=$(printf '%s' "$hex" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)
  if [ "$got" = "$want" ]; then echo "MATCH"; else echo "MISMATCH $want"; fi
done | sort | uniq -c
```

Output: `20 MATCH`.

**All seventy D1 runs**, whose preimages live in a different file under a different key:

```bash
jq -r '"\(.intent_hash) \(.canonical_preimage_hex)"' evidence/d1-authorize/runs.ndjson |
while read -r want hex; do
  got=$(printf '%s' "$hex" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)
  if [ "$got" = "$want" ]; then echo "MATCH"; else echo "MISMATCH $want"; fi
done | sort | uniq -c
```

Output: `70 MATCH`.

> **Why the D1 and D2 preimages differ in shape.** In D2 the canonical `agentId` field holds the
> registry alias (`agent-1`); in D1 it holds the agent's raw Stellar address. `canonical_intent`
> treats that field as an opaque length-prefixed string, so both are valid canonical forms — but if
> you diff a D1 preimage against a D2 preimage, expect this field to differ in kind. It is not a
> defect and it does not affect either hash's reproducibility.

### 3.3 — Recompute a `decision_id`

```
decision_id = sha256( "AEGIS-DECISION-v1" || intent_hash[32] || policy_version_be_u32[4] )
```

That is a **53-byte preimage**: a 17-byte ASCII domain-separation tag, then 32 raw bytes of
`intent_hash`, then the policy version as a 4-byte big-endian unsigned integer. The tag is ASCII;
the other two parts are raw bytes, which is why they go through `xxd -r -p` and the tag does not.

The point of this check: the `decision_id` is not a database row id someone chose. It is a pure
function of *what was asked* and *which policy version judged it*, so a decision cannot be quietly
re-pointed at a different intent or a different policy.

For `intent_hash` `1a356a0c…442c` at policy version 1 (`00000001` big-endian):

```bash
{ printf 'AEGIS-DECISION-v1'
  printf '1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c' | xxd -r -p
  printf '00000001' | xxd -r -p
} | shasum -a 256
```

Output:

```
b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec  -
```

That is exactly the `decision_id` the chain returned in step 3.1. To confirm the preimage really is
53 bytes, replace `shasum -a 256` with `wc -c`; it prints `53`.

All 70 D1 decision ids and all 10 D3 receipts were re-derived this way while writing this file:
**70/70 and 10/10 match**.

### 3.4 — Recompute a `MEMO_HASH`, and close the loop against the public ledger

```
MEMO_HASH = sha256( intent_hash[32] || policy_version_be_u32[4] || decision_id[32] )
```

A **68-byte preimage**, hashing to exactly 32 bytes — which is precisely the size of Stellar's
`MEMO_HASH` field. (`MEMO_TEXT` holds only 28 bytes, which is why it could not be used.) This is
SOW §6.3's fifth acceptance criterion.

**First, take the memo off the public ledger.** No AEGIS file is involved in this step at all:

```bash
curl -s https://horizon-testnet.stellar.org/transactions/fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9 \
  | jq -r '.memo' | base64 -d | xxd -p -c 32
```

Output:

```
0510ea1a70eb38b5b142436b05a12fb9953dc091d617a9b5f11f929d6de43cfe
```

**Now rebuild that same value from the decision's own fields**, taken from step 3.1
(`intent_hash` = `1a356a0c…442c`, `policy_version` = 1, `decision_id` = `b62b0ce8…97ec`):

```bash
{ printf '1a356a0c8b9490ca81748d535abd146d8b274308fda932b6be51dc740912442c' | xxd -r -p
  printf '00000001' | xxd -r -p
  printf 'b62b0ce89c7e3f0938816b327dc3752b7df5b6ff4e50f50e01afb6a0a49a97ec' | xxd -r -p
} | shasum -a 256
```

Output:

```
0510ea1a70eb38b5b142436b05a12fb9953dc091d617a9b5f11f929d6de43cfe  -
```

**The two match, and that is the entire product in one screen.** A payment sitting on a public
ledger, whose memo was fixed at signing time and cannot be edited, provably refers to one specific
on-chain governance decision — and you just proved it with `curl`, `base64`, `xxd` and `shasum`,
having trusted nothing we wrote.

Each receipt also carries the preimage directly, so you can check it without retyping fields:

```bash
for f in evidence/d3-receipts/*.json; do
  want=$(jq -r '.settlement.memo_hash' "$f")
  got=$(jq -r '.settlement.memo_preimage' "$f" | xxd -r -p | shasum -a 256 | cut -d' ' -f1)
  if [ "$got" = "$want" ]; then echo "MATCH"; else echo "MISMATCH $f"; fi
done | sort | uniq -c
```

Output: `10 MATCH`.

> A receipt is a **claim, never evidence.** Every field in it is something the verifier re-derives
> from Horizon or Soroban RPC and then compares. Nothing is believed because the receipt said it.

### 3.5 — The asset mapping is a derivation, not an address we chose

This one deserves care, because it is the place where a reviewer is most entitled to be suspicious.

The canonical intent hashes the asset as the **string** `"USDC:GBBD47IF…"`. The contract stores the
policy's allowed asset as an **`Address`** — the asset's Stellar Asset Contract (SAC). Two different
representations of the same asset, and the honest question is: who chose the mapping between them?

**Nobody did.** A SAC address is a deterministic function of exactly three inputs — the network
passphrase, the asset code, and the issuer — with **no AEGIS-controlled input anywhere in it**.
Derive it yourself:

```bash
stellar contract id asset \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet
```

Output:

```
CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

That is the address the contract holds as `allowed_asset`, and the one every decision in step 3.1
reports. Pasting the address and asking you to accept it would have recorded a value without meeting
the requirement; recomputing it is the requirement.

**The limitation, stated plainly — because it is real and you should not have to find it yourself:**

> **Nothing on-chain links the SAC address to the `"CODE:ISSUER"` string that `intent_hash` commits
> to.** `authorize()` receives `intent_hash` and `asset: Address` as *separate arguments*. The
> contract compares Address to Address; it never sees the string. The string only ever exists inside
> the `intent_hash` preimage.

So the binding between the two forms is **the published spec (`packages/canonical/SPEC.md` §5) plus
your own recomputation above** — not an on-chain check. What this does buy you is real: because the
derivation has no AEGIS input, a wrong mapping is *detectable by anyone*, and the verifier performs
exactly this derivation on every settlement (`Asset(code, issuer).contractId(passphrase)` compared
against `decision.asset`). What it does not buy you is on-chain *enforcement*. Those are different
claims and Phase 1 only supports the weaker one.

### 3.6 — Run the independent verifier yourself

`tools/verifier` answers one question — *is this payment the payment the contract authorized?* — and
answers it from **public data only**: Horizon and Soroban RPC. It never calls the AEGIS API, and it
never imports the generated contract bindings; it fetches the ABI from the chain, so even the
`Verdict` enum's case names come from the on-chain spec rather than from anything we ship.

```bash
pnpm install && pnpm build

node tools/verifier/dist/cli.js \
  --tx fb025c010c5a7064f24035d9b6a94322525548233b6c0a661a297a9aab395be9 \
  --receipt evidence/d3-receipts/01-s01-b62b0ce89c7e3f09.json \
  --strict
```

Every default comes from the receipt and every one can be overridden — `--horizon`, `--rpc`,
`--contract`, `--network`, `--registry` — so if you do not trust the receipt's own URLs, point the
tool at infrastructure you choose. There are no environment variables and no secrets; it only reads.

This was re-run live on 2026-09-04, well after the settlement run, and still reports:

```
VERDICT: VERIFIED  —  21 passed, 0 failed, 0 unavailable  (exit 0)
```

Stored reports for all ten settlements are in `d3-verifier/` (`.txt` human-readable, `.json`
machine-readable). All ten are `VERIFIED`, 21/21 checks, exit 0.

#### The four exit codes — and why `3` is not a pass

| Code | Verdict | Meaning |
| ---: | --- | --- |
| **0** | `VERIFIED` | every property was checked, and holds |
| **1** | `FAILED` | at least one property is **contradicted** by the chain |
| **2** | `USAGE` | bad arguments — nothing was verified |
| **3** | `UNAVAILABLE` | nothing was contradicted, but at least one property **could not be checked** |

**Exit 3 is not a pass, and must never be read as one.** *"Could not check"* and *"checked and
fine"* are different statements, and a verifier that collapses them is worse than no verifier at
all — a network blip would read as a clean settlement. A check that cannot run prints as `????` and
moves the exit code to 3. A detected mismatch outranks it: a real finding does not become less true
because some other source was unreachable.

If you are scoring this deliverable, **`0` is the only passing code.** Treat `3` as "come back and
run it again", never as "verified".

---

## Part 4 — What the verifier can and cannot prove: the two trust boundaries

Phase 1 has two places where the guarantee is weaker than it first appears. Both are deliberate,
both are documented in `DECISIONS.md`, and both are stated here in the same words rather than left
for a reviewer to discover. A reviewer who works these out unaided has found something we concealed;
we would rather they found something we disclosed.

### 4.1 — Phase 1 trusts the executor key (`DECISIONS.md` #6)

The contract decides `service_id` and `amount`. **Nothing on-chain forces the executor to pay
exactly that.** The executor holds a key, builds the payment itself, and submits it.

> **The memo commitment makes misuse *detectable*, not *impossible*.**

A compromised executor could pay the wrong destination, or the wrong amount. What it *cannot* do is
make that payment look authorized: the memo commits to `intent_hash`, `policy_version` and
`decision_id`, and the verifier compares the payment's amount, asset and destination against the
decision the contract actually holds. The mismatch surfaces the moment anyone runs the verifier.

There is also a narrower gap inside this one, worth naming precisely. `Decision` carries
`service_id` but **not a destination account** — the contract does not constrain where funds go. The
verifier checks the destination against the published `services.json` registry. So a verified
destination proves *"the payment went where the published registry said"*, **not** *"where the
contract required"*. If no registry is found, those checks report `unavailable` — never a pass.

*Phase 2 closes this* by moving settlement into the contract: `settle(decision_id)` calls
`token::Client::transfer` through the SAC, making decision and settlement a single transaction with
no executor to trust.

### 4.2 — The gateway holds the agents' secret keys (`DECISIONS.md` #10)

`authorize` requires **two** signatures: the `caller` (owner or operator) and the agent itself. SOW
§4.1 D2 specifies `POST /v1/intents` as a **single synchronous request**, which leaves no round trip
in which an external agent could be handed an auth entry to sign. So in Phase 1 the gateway holds
the agents' secret keys and produces both signatures.

The contract's on-chain check — *a leaked operator key cannot impersonate another agent* — still
runs, unchanged, and it still passes. But when the operator key and every agent key live in **one
process**, both signatures come out of a **single trust domain**: compromising the gateway yields
both.

> **That property holds on chain, but not in this deployment.** As with the executor key above:
> misuse is **detectable, not impossible**.

*Phase 2 restores it* with a prepare/sign/submit round trip the Stellar SDK already supports — the
gateway returns an unsigned transaction, the agent runs `signAuthEntries` locally against a key the
gateway never sees, and sends it back. No contract change is needed. It is out of Phase 1 only
because it replaces the single synchronous endpoint that §4.1 D2 specifies, and changing a specified
API shape is a larger correction than the wording fixes already tracked.

### 4.3 — So what does the verifier actually prove?

**It can prove**, from public data alone:

- the transaction exists, succeeded, and carries exactly one payment operation;
- a decision exists under this `decision_id`, readable from the contract ID alone;
- that decision's verdict is `Approved` and it is marked `settled`;
- the on-ledger memo **is** `sha256(intent_hash ‖ policy_version ‖ decision_id)` — checked three
  independent ways: recomputed locally, recomputed *on chain* by the contract's own `memo_hash()`
  view (Rust, not TypeScript), and hashed from the receipt's preimage. A bug in one implementation
  cannot make a settlement verify; all three would have to be wrong identically;
- the amount and asset paid equal the amount and asset the contract authorized;
- `mark_settled` was written at or before the payment's ledger;
- no other successful transaction on either account carries this memo.

**It cannot prove:**

- that the executor *had* to pay this destination — the contract does not constrain destinations
  (4.1);
- that the two signatures on `authorize` came from two independent parties — in this deployment they
  did not (4.2);
- that the `"CODE:ISSUER"` string inside `intent_hash` is bound on-chain to the SAC address the
  contract compared — it is bound by the published spec and by your own recomputation (3.5);
- anything about a transaction it was not given. Horizon has no global memo index, so *"exactly one
  transaction carries this memo"* is established by walking the full history of the two accounts a
  double-settle would have to appear on. The accounts scanned are printed with the result.

---

## Part 5 — State archival: will this evidence still be readable later?

A reviewer of an audit-trail product should ask this, so here is the answer up front.

Soroban charges rent for stored data. A **persistent** entry that is not paid for is **archived** —
it stops being readable until someone restores it. If the decisions in this pack were archived, the
central claim *"every decision can be read on-chain by contract ID"* would quietly stop being true.

Three things are true about how this contract handles it:

1. **Every write extends the TTL.** All decision and policy writes go through one helper
   (`put_decision` → `extend`), so a write path cannot forget to bump. Constants:
   `BUMP_THRESHOLD = 518_400` ledgers (~30 days) and `BUMP_AMOUNT = 1_036_800` ledgers (~60 days) —
   `contracts/authorization/src/lib.rs`.
2. **Every entry point extends the instance TTL, reads included.** Instance storage holds `Owner`
   and `Operator`; if *that* entry were archived, **every** call would fail and the claim would
   break entirely. So it is bumped on reads as well as writes, not only on writes. There is a test
   pinning this — `every_entry_point_bumps_the_instance_ttl` in `contracts/authorization/src/test.rs`.
3. **Archived is not lost.** Soroban archival is recoverable: the entry's data still exists and a
   `RestoreFootprint` operation brings it back, after which reads succeed again exactly as before.
   Archival makes a decision temporarily *unreadable*, never *deleted*, and never *altered*.

**The honest caveat.** A ~60-day TTL that is refreshed only when something touches the entry means a
decision nobody reads or writes for two months *can* archive. For this evidence pack that is
survivable — the entries are restorable, and every hash in this pack is independently recomputable
offline from the preimages recorded here regardless of chain state. But an operator running AEGIS for
real should treat TTL refresh as an operational task, not assume it. It is not automated in Phase 1.

One consequence worth knowing while reading the evidence: `get_decision` returns the same error for
*"no such decision"* as for *"the entry is archived and not restored"*. If a lookup that should
succeed comes back empty, archival is the first thing to check, not the last.

---

## Part 6 — The claims, mapped to §6.3

SOW §6.3 lists the conditions for accepting Phase 1. Each row says where the evidence is and how to
check it yourself.

| §6.3 criterion | Status | Evidence | Check it |
|---|---|---|---|
| All 7 §5.2 scenarios return the expected verdict **and reason code** across 70 runs | **70/70** | `d1-authorize/results.md`, `runs.ndjson` | Part 2 for the code translation; §3.1 to read any of them off the chain |
| Every decision readable on-chain by contract ID, independently of the AEGIS database | **yes** | `d1-authorize/decision-export.json` | §3.1 — the CLI never touches an AEGIS service |
| Each decision records the `policy_version` it was judged against; a policy change bumps the version and leaves past decisions untouched | **yes** | `d1-authorize/runs.ndjson`; test `set_policy_bumps_version_and_leaves_existing_decisions_untouched` | §3.1 returns `policy_version`; `d1-adversarial-suite.txt` |
| The executor accepts a `decision_id` and refuses any verdict other than `Approved`, by re-reading the contract at submission time | **2/2 refused** | `d2-refusals.md` rows 3–4 | the refusal text names the verdict it actually read |
| The settled `MEMO_HASH` equals `sha256(intent_hash ‖ policy_version ‖ decision_id)` for all 10 settlements | **10/10** | `d3-results.md`, `d3-verifier/` | **§3.4** — closes against Horizon with no AEGIS code |
| A replayed `intent_hash` returns the original decision and produces no second payment | **10/10 + 10/10** | `d1-authorize/results.md` §7; `d3-results.md` | balances unchanged across the replay phase: +0.0000000 |
| A revoked agent's intent is rejected on the next `authorize()` | **10/10** | `d1-authorize/results.md` scenario 6 | reason code `4` `AgentRevoked` |
| `resolve()` is owner-only and terminal; a second call fails | **2/2 refused** | `d2-refusals.md` rows 1–2, `d2-approval-trail.md` | both second calls got `AlreadyResolved`; one deliberately asked for the opposite answer |
| The console lets a reviewer follow any intent from agent to settlement without technical setup | **yes** — <https://aegis-production-2216.up.railway.app> | `d4-results.md`, `d4-screenshots/` | open any reference from `d4-intent-references.md`; **70/70** decisions and **10/10** transaction links checked through the live page |

**The last row was the outstanding one and is now met, with one qualification.** The console is
deployed, and the three §6.1 D4 artifacts that depended on a live URL exist: the public link, the
screenshots (`d4-screenshots/`), and the result table (`d4-results.md`). Every one of the 70
decisions and 10 settlements was loaded through the live page in a real browser, and the verdict and
reason code were read back out of the rendered DOM.

The qualification: the **settlement transaction link is searched for, not stored.** The contract
records *that* a decision settled and never *which* transaction did it, so the page scans the
published settlement accounts on Horizon for a transaction carrying the `memo_hash()` the contract
returned. All ten render; the search is bounded, and its bounds are stated in `d4-results.md` §B and
`INDEX.md` gap 1.

---

## Part 7 — What did not come out clean

Nothing here was papered over to keep a table green.

**1. The console's settlement link comes from a bounded search, not from a stored field.** The
contract records **that** a decision was settled and never **which** transaction did it, so there is
no `settlement_tx_hash` to read on-chain. Rather than have the AEGIS API name the transaction — which
would ask a reviewer to trust the party under review to name its own receipt, and which this
deployment could not do anyway (`/health` reports `database: degraded`) — the page **searches**
Horizon for a transaction whose `MEMO_HASH` equals the contract's `memo_hash()`, and tags the result
*derived from ledger*.

*Consequence, precisely:* the link is a consequence of public data rather than a claim, and §6.3
survives because Horizon is Stellar infrastructure, not an AEGIS service. But the scan walks only the
**last 1000 transactions** of the accounts in `VITE_SETTLEMENT_ACCOUNTS` — Horizon has no global memo
index — so at higher volume it would need a cursor. When it stops at that cap the page says so, and
an absence found that way is not proof of absence. A miss never contradicts `settled`, which is read
from the contract. Bounds in full: `d4-results.md` §B.

**2. Two reason codes have no live demonstration through the gateway, and one has none anywhere.**
`AgentRevoked` (4) is on chain ten times in D1 but never on the gateway path; `OwnerRejected` (7) is
the reverse, exercised through `resolve()` on `s15`; `WindowCapExceeded` (5) appears in neither.

*Consequence, precisely:* closing `AgentRevoked` through the gateway means revoking `agent-1`, and
`revoke_agent` does **not** bump the policy version — only `set_policy` does. `Policy.status` would
flip to `Revoked` under an unchanged `version: 1`, which makes the console's own caveat — *"still v1
— the same version that produced this decision… the values below are therefore the ones that were
actually applied"* — false on all ten settlement pages, the exact pages §6.1 D4 sends a reviewer to.
There is no un-revoke, and restoring through `set_policy` bumps to v2 and puts a mismatch caveat on
every decision instead. The refusal happens in the contract regardless; the gateway's part is
relaying a code it already relays for five others across the twenty runs.

`WindowCapExceeded` is the one with no live decision at all: D2 spent 91.095679 of a 200.0000000
USDC window and never approached the cap. It has two contract unit tests and the SOW's §5.2 enum
never names it, but neither is a decision on the ledger and this pack does not count them as one.
That one would be cheap and reversible to close — the tumbling window clears itself — and it is left
open rather than closed quietly. Full reasoning in `INDEX.md` gap 2.

**3. The finality median exceeds §7.2's "< 2 sec" figure, and always will.** Median POST → verdict
is **713 ms**; median POST → finality is **5628 ms**. Stellar closes a ledger roughly every 5
seconds and no gateway tuning changes that. §7.2 scopes that figure as a roadmap target rather than
an acceptance criterion, and both numbers are reported rather than the flattering one. Nothing was
tuned to improve either.

---

### Found here, and fixed before delivery

Three more findings were open when these artifacts were produced and are closed in the code being
delivered. Their full write-ups stay where they were found — a pack that deletes its own findings is
worth less than one that carries them — so each is summarised here with the file that has the detail,
rather than left for a reviewer to reconcile against the repo.

**The executor's error classification.** Settling a non-existent `decision_id` was refused with no
payment but classified `SOURCE_UNAVAILABLE` (*retry later*) instead of `DECISION_NOT_FOUND` (*the
chain answered, and the answer is no*), so a recovery loop would have retried forever.
`apps/executor/src/chain.ts` now classifies on the error's **numeric discriminant**, which the ABI
owns, rather than on a string test against the variant name — which the SDK builds from a doc
comment, not from the name at all. Re-run against the live contract, the same attempt answers
`DECISION_NOT_FOUND`, exit 1, and says *"refused by the decision itself — re-running changes nothing
until the chain does"*. `apps/executor/test/settle.test.ts` pins it. Before and after:
`d2-refusals.md`.

**The stale contract ID.** `apps/gateway/registry.json` pinned the pre-redeploy contract in the
working tree during the D2/D3 run, which `scripts/d2-gateway.sh` worked around with a corrected copy
rather than editing `apps/**` mid-run. It was corrected before it was ever committed: `git log -S`
finds that ID in no revision of the file. Where it genuinely survived was
`apps/console/.env.example` — the file a developer copies — and that now names the current contract.

**`tools/verifier/README.md`.** Its "Status" section claimed the Horizon-side checks had no live
subject because the executor was still a skeleton. Ten settlements verify in `--strict` mode, and
the section says so.

## Where everything lives

`INDEX.md` is the full §6.1 artifact map, including what is outstanding. In brief:

| File | What it is |
|---|---|
| `INDEX.md` | every §6.1 artifact → the file that satisfies it, and what is missing |
| `d4-intent-references.md` | the list of intent references for testing (§6.1 D4) |
| `d1-authorize/` | D1: 70 runs — results, raw records, decision export (JSON + CSV), agent identities |
| `d1-adversarial-suite.txt` | D1: `cargo test` output — 59 tests, 0 failures |
| `d2-results.md` | D2: the 20-submission table and both medians |
| `d2-approval-trail.md` | D2: scenario 5 end to end, including the on-chain `resolve()` |
| `d2-refusals.md` | D2/D3: the four required refusals, plus the defect in Part 7 |
| `d2-window-budget.md` | D2: the cumulative-window arithmetic |
| `d2-gateway.ndjson` | D2: **the transcript** — the gateway's own log, raw and unedited |
| `d3-results.md` | D3: 10 settlements, memo preimages, replays, verifier output |
| `d3-audit-receipts.md` | D3: agent / owner / policy version / verdict / `decision_id` / `tx_hash` |
| `d3-receipts/`, `d3-verifier/` | D3: one receipt and one verifier report per settlement |
| `d2-d3-README.md` | D2/D3: how that run was produced and under what conditions |
| `d4-results.md` | D4: **70/70** decisions viewable, **10/10** transaction links live — and what the method does not prove |
| `d4-screenshots/` | D4: the approved and refused pages, captured from the live console |
| `d4-console-verification.json` | D4: all 82 page loads, machine-readable |

Repository root: `README.md` (project overview and Phase 1 boundaries), `DECISIONS.md` (why the ABI
looks the way it does — #6 and #10 are the two trust boundaries in Part 4),
`packages/canonical/SPEC.md` (the canonical serialization spec, §5 covers the asset mapping).
