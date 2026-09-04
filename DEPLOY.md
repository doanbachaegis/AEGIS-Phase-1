# Deploying AEGIS

**TESTNET ONLY.** Every key, contract and asset referred to here is a Stellar
testnet artifact. Nothing in this document should be pointed at mainnet.

---

## 1. Topology

Three pieces, deployed to two providers and one database host:

| Piece | Where | What it is | Built by |
|---|---|---|---|
| Gateway (D2) + Executor (D3) | Railway | one container, one long-running server plus an operator CLI | `Dockerfile` |
| Console (D4) | Cloudflare Pages | static bundle, no server | `pnpm --filter "@aegis/console..." build` |
| Evidence store | Neon | Postgres, optional (see §4) | — |

The gateway and the executor share an image on purpose: the executor is not a
service, it is a CLI an operator runs against the same registry and the same
keys the gateway is already using. It has no port and no request path.

```
  browser ──────────────► Cloudflare Pages   (static console bundle)
     │
     ├── chain reads ───► Soroban RPC        (authoritative evidence)
     │                       ▲
     └── display only ──► Railway ───────────┘
                            │  gateway (:PORT)  ── Neon Postgres
                            └  executor CLI     ── Stellar / Horizon
```

**The two arrows out of the browser are not equally important**, and §7 explains
why that is the thing keeping a CORS mistake from becoming an outage.

### Why the repo can build this without a Rust toolchain

`packages/bindings` is generated from the contract wasm **offline** and
committed. Neither Railway nor Cloudflare needs `cargo`, the `wasm32v1-none`
target, or the `stellar` CLI. The `bindings-drift` CI job is what keeps the
committed output honest.

---

## 2. Before you start

Have these ready:

- The deployed authorization contract ID (`C…`, 56 chars).
- Three testnet secret keys — **owner**, **operator**, **executor** — funded via
  Friendbot as needed. They are three distinct roles; see `.env.example`.
- The agent keypairs, as a single-line JSON object for `AGENT_SECRETS`.
- Accounts on Railway, Cloudflare and Neon.

Deploy in this order. Steps 3–5 each produce a URL the next step needs, and §6
closes the one loop that cannot be avoided.

---

## 3. Railway — gateway + executor

### 3.1 Create the service

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. Railway reads `railway.json` at the repo root and uses the `DOCKERFILE`
   builder. No Nixpacks configuration and no build command are needed — if
   Railway offers to autodetect a Node app, decline.
3. **Settings → Networking → Generate Domain.** Note the
   `https://<name>.up.railway.app` URL; §5 and §6 both need it.

### 3.2 ⚠️ Replicas: leave this at 1, permanently

`railway.json` pins `"numReplicas": 1`. **This is correctness, not cost
control.**

The executor holds a **single** Stellar account and precomputes payment
envelopes against that account's sequence number. Two replicas would both be
entitled to build an envelope for the same `decision_id` against the same
sequence number, and both submissions can be valid. That is a **duplicate
payment** — precisely the failure D3 is scored on.

Scaling this service horizontally is not a performance change; it is a
correctness regression. If throughput ever becomes the problem, the fix is a
queue in front of one executor, not a second executor.

*(JSON has no comments, so this warning lives here and in the `Dockerfile`
header rather than in `railway.json` itself.)*

### 3.3 Environment variables

Set these under **Variables**. Railway injects `PORT` itself; the server binds
`0.0.0.0` on whatever it is given.

> **Do not quote anything in the Railway UI.** The
> `STELLAR_NETWORK_PASSPHRASE=".. ; .."` quoting rule in `.env.example` exists
> because *dotenv-style parsers* treat `;` as a comment. Railway stores the
> literal string you type. Typing the quotes here makes them **part of the
> passphrase**, and every signature the gateway produces will then be rejected
> by the network with an error that does not mention quoting.

**Required**

| Variable | Value / note |
|---|---|
| `CONTRACT_ID` | the deployed contract, `C…` |
| `STELLAR_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `STELLAR_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` — **no quotes**, see above |
| `OPERATOR_SECRET` | `S…`, the `caller` for `authorize` / `mark_settled` |
| `EXECUTOR_SECRET` | `S…`, sources and signs the USDC payment |
| `AGENT_SECRETS` | one-line JSON, `{"G…":"S…"}`. Empty means every submission fails — the gateway warns loudly at boot |

**Required in practice**

| Variable | Value / note |
|---|---|
| `OWNER_SECRET` | `S…`. Without it `POST /v1/decisions/:id/resolve` cannot work — `resolve` is owner-only on chain |
| `CORS_ORIGIN` | the console's origins — see §6 |
| `DATABASE_URL` | Neon pooled URL — see §4 |

**Optional, sensible defaults**

| Variable | Default | Note |
|---|---|---|
| `LOG_LEVEL` | `info` | the request log **is** the §6.1 D2 evidence; do not raise this above `info` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | executor only |
| `TX_TIMEOUT_SECONDS` | `45` | gateway: wait for a contract tx to close |
| `SETTLEMENT_TIMEOUT_SECONDS` | `180` | executor: payment envelope `maxTime`. Integer in `[30, 3600]`; outside it the executor refuses to start |
| `SERVICE_REGISTRY_PATH` | repo-root `services.json` | resolved from the app's own location, so it is correct from any working directory |
| `GATEWAY_REGISTRY_PATH` | `apps/gateway/registry.json` | same |
| `EXECUTOR_DB_PATH` | `apps/executor/.data/settlements.db` | see §3.4 |

**Deliberately NOT needed here**

- `USDC_SAC_ADDRESS` — the executor reads the asset from `services.json` and the
  chain, never from the environment. Setting it changes nothing.
- `STELLAR_NETWORK` — used only by local evidence scripts.
- `PORT` — Railway injects it.

### 3.4 ⚠️ The executor's journal is ephemeral by default

`apps/executor/.data/settlements.db` lives on the container filesystem, which
Railway discards on every restart and redeploy.

That journal is the executor's entire crash-recovery story: it is what lets
`aegis-settle recover` compare a stored transaction hash against Horizon's
latest closed ledger and turn *"unknown"* into *"proven absent"*. Lose it while a
payment is in flight and that settlement cannot be reconciled — you are left
unable to prove whether it happened.

**If you will run settlements from the container**, attach a volume:

1. **Service → Settings → Volumes → Add Volume**, mount path
   `/app/apps/executor/.data`.
2. Redeploy.

Skip this only if you run `aegis-settle` from a workstation instead, in which
case the journal lives there.

### 3.5 Health check

`railway.json` sets `healthcheckPath: "/health"` with a 60 s timeout and
`ON_FAILURE` restarts (max 10). A healthy response looks like:

```bash
curl -s https://<name>.up.railway.app/health
```

```json
{
  "ok": true,
  "contract_id": "C…",
  "network_passphrase": "Test SDF Network ; September 2015",
  "caller": "G…",
  "caller_role": "operator",
  "owner_configured": true,
  "registry_version": 1,
  "database": "postgres"
}
```

Read three fields every time:

- **`network_passphrase`** — if it has quote characters in it, you typed quotes
  into Railway. See §3.3.
- **`caller_role`** — `owner` means `OPERATOR_SECRET` was not picked up.
- **`database`** — `degraded` means Postgres is unreachable. §4.3.

### 3.6 Running a settlement

The executor CLI ships in the same image. From **Railway → service → Shell**:

```bash
node apps/executor/dist/cli.js pending
node apps/executor/dist/cli.js settle --decision <64-hex> --dry-run
node apps/executor/dist/cli.js settle --decision <64-hex>
node apps/executor/dist/cli.js status  --decision <64-hex>
```

`--dry-run` gates, preflights, builds and commits the envelope, then stops
before `mark_settled` and before submitting. Use it first.

A `decision_id` is the only accepted input. There is no path from a raw agent
request to a payment.

---

## 4. Neon — Postgres

### 4.1 Provision

Create a project and a database. Copy the **pooled** connection string from the
Neon dashboard (the host contains `-pooler`).

### 4.2 Connection string caveats

- **`?sslmode=require` is mandatory.** Neon refuses unencrypted connections. The
  gateway passes the URL straight to `postgres.js`, which reads `sslmode` out of
  the URL — there is no separate SSL setting to configure.
- **Use the pooled string for `DATABASE_URL`.** The gateway keeps a pool of up
  to 8 connections; Neon's direct endpoint has a much lower ceiling.
- **Use the DIRECT (non-pooled) string for migrations.** Drizzle's migrator runs
  DDL in a session that the pooler can interrupt. Substitute it for that one
  command only.
- A Neon free-tier branch **suspends when idle**. The first request after a
  suspension can exceed the gateway's 5 s connect timeout, which shows up as
  `"database": "degraded"` on `/health` and clears on a restart.

```
postgres://<user>:<pass>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require
```

### 4.3 Migrate

Migrations are **generated and committed**, never applied at boot — the gateway
has to be able to start with no database at all, and a process that migrates on
boot cannot also boot without one. So this is an explicit operator step.

From the Railway shell (or locally with `DATABASE_URL` exported):

```bash
DATABASE_URL='<DIRECT non-pooled URL>' pnpm --filter @aegis/gateway db:migrate
```

`pnpm` and `drizzle-kit` are both present in the runtime image for exactly this.

### 4.4 Postgres is optional, and the degraded mode is real

With no reachable database the gateway **still serves the chain path** and
reports `"database": "degraded"`. It is a legitimate deployment, not a broken
one: the authoritative evidence is on chain either way. What is lost is the
stored `purpose` / `client_ref` and the escalation queue — display-only fields.

The gateway says so at boot, once and loudly. It does not fail closed, so
**check `/health` rather than assuming a green deploy means a connected
database.**

---

## 5. Cloudflare Pages — console

### 5.1 Settings

**Workers & Pages → Create → Pages → Connect to Git**, then:

| Setting | Value |
|---|---|
| Framework preset | **None** |
| Root directory | *(leave empty — the repo root)* |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter "@aegis/console..." build` |
| Build output directory | `apps/console/dist` |

The root directory must stay the repo root: this is a pnpm workspace, and the
console imports `@aegis/canonical` and `@aegis/bindings` through the workspace
link. Pointing Cloudflare at `apps/console` breaks resolution before the build
starts.

**The trailing dots in the filter are load-bearing.** `--filter "<pkg>..."`
selects the package *and everything it depends on*; leading dots (`"...<pkg>"`)
select its *dependents*. Backwards, the console builds against a missing
`packages/canonical/dist`.

### 5.2 Build-environment variables

| Variable | Value |
|---|---|
| `NODE_VERSION` | `24` |
| `PNPM_VERSION` | `10.18.2` |

Both must match the repo (`.nvmrc`, and `packageManager` in `package.json`).

### 5.3 Console variables — all build-time

| Variable | Required | Note |
|---|---|---|
| `VITE_STELLAR_RPC_URL` | ✅ | `https://soroban-testnet.stellar.org` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | ✅ | `Test SDF Network ; September 2015` — **no quotes** in the Cloudflare UI, same rule as §3.3 |
| `VITE_CONTRACT_ID` | ✅ | must match Railway's `CONTRACT_ID` |
| `VITE_AEGIS_API_URL` | | the Railway URL, no trailing slash — see §6 |
| `VITE_USDC_SAC_ADDRESS` | | lets the console print "USDC (testnet)" beside the raw SAC address |
| `VITE_STELLAR_EXPERT_NETWORK` | | defaults to `testnet` |
| `VITE_SAMPLE_INTENTS` | | comma-separated intent references for the home page deep links |

The three required ones are validated at module load: a deploy missing any of
them renders an explicit configuration screen (still carrying the testnet
banner) rather than an empty evidence page.

### 5.4 ⚠️ `VITE_*` is inlined at BUILD time

Vite substitutes static `import.meta.env.VITE_*` accesses into the bundle when
it compiles. Two consequences, and both bite:

1. **Changing a `VITE_*` variable requires a REBUILD, not a redeploy.** After
   editing one in the Cloudflare dashboard you must trigger *Retry deployment*
   or push a commit. A plain redeploy of an existing build serves the old
   values. This matters most for `VITE_CONTRACT_ID`: redeploying the contract
   without rebuilding the console leaves a page rendering evidence from the
   **previous** contract, which looks like working software.
2. **Anything not prefixed `VITE_` is invisible to the bundle.** This is not a
   convention — it is what keeps `EXECUTOR_SECRET`, `OPERATOR_SECRET`,
   `OWNER_SECRET` and `AGENT_SECRETS` out of a world-readable JavaScript file
   even though they sit in the same repo. Never add a `VITE_` prefix to a secret
   to "make it available to the frontend". The console has no signer and never
   submits a transaction; if it appears to need a key, something else is wrong.

### 5.5 SPA routing

`apps/console/public/_redirects` already contains `/*  /index.html  200`, so
deep links like `/intent/<hash>` resolve. Nothing to configure — but if a shared
evidence link 404s, confirm that file survived into `apps/console/dist`.

---

## 6. Wiring the two URLs together

Railway needs the console's origin and the console needs Railway's URL, so do
this after both exist:

1. On **Railway**, set:
   ```
   CORS_ORIGIN=https://<project>.pages.dev,https://*.<project>.pages.dev
   ```
   Comma-separated. The second entry covers Cloudflare's per-commit preview
   deployments, which each get their own `<hash>.<project>.pages.dev` origin. The
   `*` stands for **exactly one label** and never matches a dot, so it cannot be
   widened by an attacker-controlled subdomain. Redeploy.
2. On **Cloudflare**, set `VITE_AEGIS_API_URL=https://<name>.up.railway.app`
   (no trailing slash) and **rebuild** — §5.4.

Leaving `CORS_ORIGIN` unset disables CORS entirely, which is the correct setting
if nothing calls the API from a browser.

Verify:

```bash
curl -si -H "Origin: https://<project>.pages.dev" \
  https://<name>.up.railway.app/health | grep -i access-control-allow-origin
```

An allowed origin is echoed back. A rejected one gets **no header at all** and a
`200` — that is normal: CORS is enforced by the browser, not the server, so
`curl` always sees the body. Judge by the header's presence.

---

## 7. Why a CORS mistake degrades the console instead of breaking it

Worth understanding before debugging a blank page, because it narrows the search
considerably.

The console reads the **authoritative** evidence — the decision, its verdict and
reason, the settlement — directly from **Soroban RPC**, which serves
`access-control-allow-origin: *` to everyone. That path does not touch the
gateway and cannot be affected by `CORS_ORIGIN`.

The gateway supplies only the **non-authoritative** display fields: `purpose`,
`client_ref`, and the settlement transaction hash — each already tagged
"display only" in the UI.

So a misconfigured `CORS_ORIGIN` costs the console `purpose` and `client_ref`.
**The evidence chain still renders.** That asymmetry is the §6.3 invariant — *the
chain is the evidence, the API is a convenience* — paying rent at deploy time.

The practical inference: **if the evidence itself fails to render, the problem is
not CORS.** Look at `VITE_CONTRACT_ID` or `VITE_STELLAR_RPC_URL` instead.

---

## 8. Post-deploy checklist

- [ ] `GET /health` returns `"ok": true`.
- [ ] `network_passphrase` in that response has **no quote characters**.
- [ ] `caller_role` is `operator`.
- [ ] `owner_configured` is `true`.
- [ ] `database` is `postgres`, not `degraded`.
- [ ] Railway boot log line `gateway ready` shows a non-zero `agents` count and
      the expected `cors` allowlist.
- [ ] Railway replicas = **1**.
- [ ] Volume mounted at `/app/apps/executor/.data`, if settling from the container.
- [ ] Console loads, shows the testnet banner, and renders a known intent.
- [ ] `VITE_CONTRACT_ID` in the built console matches `CONTRACT_ID` on Railway.
- [ ] A deep link to `/intent/<hash>` resolves rather than 404s.

---

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| Boot fails: `missing required environment variable …` | that variable is unset on Railway. The gateway resolves all config at startup precisely so this names the variable instead of failing mid-request |
| Boot fails: `… is not a valid Stellar secret key (S…)` | a truncated or public (`G…`) key in a `*_SECRET` |
| Boot fails: `AGENT_SECRETS key mismatch` | a secret filed under an address it does not belong to. Deliberate: signing as the wrong agent must not be a silent outcome |
| Boot fails: `SETTLEMENT_TIMEOUT_SECONDS must be an integer in [30, 3600]` | out of range |
| Every submission is rejected on chain, config looks right | quotes typed into `STELLAR_NETWORK_PASSPHRASE`. Check `/health` |
| `"database": "degraded"` | missing `?sslmode=require`, a suspended Neon branch, or a wrong password. Check the boot log's `reason` |
| `caller_role: "owner"` unexpectedly | `OPERATOR_SECRET` empty; the gateway fell back to `OWNER_SECRET` |
| Console shows a configuration screen | one of the three required `VITE_*` is unset. Set it and **rebuild** — §5.4 |
| Console renders evidence but `purpose` / `client_ref` are missing | `CORS_ORIGIN` or `VITE_AEGIS_API_URL`. §7 |
| Console renders nothing at all | not CORS. `VITE_CONTRACT_ID` or `VITE_STELLAR_RPC_URL`. §7 |
| Console still shows the old contract after a redeploy | `VITE_*` is inlined at build time. Rebuild. §5.4 |
| Duplicate payments | replicas > 1. §3.2 |

---

## 10. What is public, and what must never be

**Public by construction** — and intentionally so, since §6.3 asks a reviewer to
verify a decision independently: the contract ID, the RPC endpoint, the network
passphrase, the USDC SAC address, and everything in the console bundle.

**Never public:** `EXECUTOR_SECRET`, `OPERATOR_SECRET`, `OWNER_SECRET`,
`AGENT_SECRETS`, `DATABASE_URL`. These are set as provider variables only. Three
mechanisms keep them out of a distributable artifact:

- Vite ignores anything without a `VITE_` prefix (§5.4).
- `.dockerignore` excludes `.env` from the **build context**, so no image layer
  ever contains one. It also stops a stray `.env` from silently overriding the
  variables Railway injects — both services call `process.loadEnvFile()` on a
  `.env` sitting next to them.
- `.gitignore` keeps `.env` and `docs/*.pdf` out of the repository.

⚠️ Phase 1 keeps the agents' secret keys in the gateway process
(DECISIONS.md #10) and trusts `EXECUTOR_SECRET` (DECISIONS.md #6). These are
recorded limitations of a **testnet** deliverable, not oversights. Rotate any
key that has been exposed, and never reuse one of these on mainnet.
