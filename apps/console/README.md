# Reviewer Verification Console (D4)

## 🔑 Architectural invariant

Acceptance criteria §6.3:
> *"Every decision can be read on-chain by contract ID, **independently of the AEGIS database**."*

So the console **calls Soroban RPC directly** for everything that is authoritative:

| Data | Source | Label in the UI |
|---|---|---|
| verdict, reason_code, original_reason_code, policy_version, resolved_policy_version, decision_id, intent_hash, agent, service_id, amount, asset, ledger_seq, resolved, settled | `get_decision()` / `decision_by_intent()` via Soroban RPC | **"read from chain"** |
| memo_hash | `memo_hash()` — computed by the contract itself | **"read from chain"** |
| approval_threshold, per_intent_cap, cumulative_window_cap, allowed_services, status | `get_policy()` / `get_window()` via Soroban RPC — but the **current** policy, see below | **"read from chain"**, with a caveat |
| purpose, client_ref, settlement transaction hash | AEGIS API | "display only" |

**No** `fetch('/api/intents/:id')` for the first group — doing that destroys the single
strongest piece of evidence the whole project has. `src/chain.ts` contains no `fetch` to
AEGIS at all; the non-authoritative fields live in `src/aegisApi.ts` and are rendered in
their own section under their own tag.

## No signer, by design

The `Client` is built with **no `publicKey` and no `signTransaction`**. The SDK
substitutes a null source account and every call stops at `simulateTransaction`;
`signAndSend()` is never called anywhere in this app. That is not a limitation being
worked around — it is the property that makes the page evidence. A reviewer with no key,
no account and no relationship to AEGIS can reproduce every number on it, and the
"Reproduce this without the console" card prints the `stellar contract invoke` commands
that do exactly that.

## Display requirements (§4.1 D4)

- agent + owner, policy version, **which rule made the decision**, verdict + reason code
- `decision_id` + Stellar Expert link to the contract
- if approved: amount, asset, `MEMO_HASH`, Stellar Expert link to the transaction
- **rejected intents show their reason code; do not hide them**
- clear labels: **"Testnet"** and **"no real funds"**

Rejections are rendered in the same box, at the same type scale, with the same amount of
space as an approval — only the hue differs. Refusing correctly is the product.

## Two things the contract does not store, and how the console handles them

**1. The rule that fired.** The contract stores the *outcome* and the *reason code*, not
the predicate. `src/derive.ts` reconstructs the predicate from `reason_code` (on-chain)
plus the agent's policy, and every operand is tagged with where it came from. The map is
`satisfies Record<ReasonCode, RuleFn>`, so a regenerated ABI with a ninth reason code is
a **compile error**, not a decision page with an unexplained verdict.

**2. Which policy version actually applied.** `get_policy` returns the policy in force
**now**. `policy_version` on the decision is frozen for life — it is bound into
`decision_id` and `memo_hash` (DECISIONS.md #4, #9) — so the contract *cannot* be asked
what v1's threshold was. When the versions differ the console says so in a warning rather
than presenting today's threshold as the rule that fired, and it flags separately when
`resolved_policy_version` shows a re-judgement ran under a third version.

**Escalation is derived, not invented.** `resolved == true` implies the decision was
escalated: `evaluate()` reaches `RequiresApproval` by exactly one path, always paired
with `PendingApproval`, and `resolve()` refuses any other verdict (`NotPendingApproval`).
Since DECISIONS.md #8 the contract also records `original_reason_code` explicitly, so the
console shows the stored field and states the derivation beside it.

## ⚠️ Do not read "not found" out of `result.unwrapErr().message`

`stellar-sdk` 16 builds its contract-error table from the ABI as
`{ [case.value()]: { message: case.doc().toString() } }` — the case's **doc comment**,
not its name. `DecisionNotFound` carries no doc comment in the contract, so that
`message` is the **empty string**, and every undocumented error looks identical.

`src/chain.ts` reads the numeric discriminant out of the simulation's host error
(`Error(Contract, #6)`) and maps it through `Errors` from `@aegis/bindings`, which *is*
keyed by identifier. A renumbered error then moves with the committed ABI instead of
silently changing what this console claims. `test/chain.test.ts` pins this.

A miss is therefore a **status**, not an exception: `fetchEvidence` returns
`found | absent | archived`, so TanStack's `retry` only fires on genuine transport
failures. `archived` is a separate case on purpose — an entry Soroban expired is not the
same claim as an entry that never existed.

## Money

`amount` is `i128` → `bigint`, in stroops. Formatting goes through `formatAmount` from
`@aegis/canonical/amount` and nowhere else (README invariant #3). No `Number()`, no
`parseFloat`, no `.toLocaleString()`, and no bigint is ever passed to React as a child.
There is deliberately **no TanStack persister**: `JSON.stringify` throws on bigint.

`@aegis/canonical`'s root entry pulls in `node:crypto` through `intent.ts` and `memo.ts`,
which a browser cannot load — hence the `./amount` subpath, which is the money module
alone. The root entry re-exports it, so every existing importer is untouched.

## Routing and deployment

`/intent/:ref` and `/decision/:ref` are real URLs — §6.1 D4 makes the evidence "a public
link to the console" plus a list of intent references, so a shared link has to resolve in
a cold tab. `public/_redirects` gives Cloudflare Pages the SPA fallback. Either
identifier works in the lookup box: the console tries `decision_by_intent` first and
falls back to `get_decision`.

Configuration is `import.meta.env.VITE_*`, typed in `src/vite-env.d.ts` and validated by
`requireEnv` in `src/env.ts`, which **throws at module load**. `main.tsx` imports the app
dynamically so that failure renders a configuration error instead of a blank evidence
page — a deploy that lost its contract ID must not look like a decision that does not
exist. See `.env.example`.

The mandatory testnet label is mounted by `main.tsx` as a sibling of the whole app:
above the router, above the error boundary, above the configuration check. No route, no
render crash and no misconfiguration can produce a page without it.
`test/testnet-banner.test.tsx` asserts the required strings against the rendered **text**
with markup stripped, so a restyling cannot quietly drop them.

If Week 3 slips: cut **styling**, not the number of test runs (§5.1).

## Running it

```bash
cp apps/console/.env.example apps/console/.env   # VITE_CONTRACT_ID must match the live deploy
pnpm --filter @aegis/console dev
pnpm --filter @aegis/console test
```
