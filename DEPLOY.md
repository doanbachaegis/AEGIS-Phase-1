# Deploying AEGIS

**TESTNET ONLY.** Every key, contract and asset referred to here is a Stellar
testnet artifact. Nothing in this document should be pointed at mainnet.

---

## 1. Topology

**One provider, one service, one URL.** Everything the reviewer and the agents
touch is served by a single Railway container built from the repo-root
`Dockerfile`:

| Path | What answers it |
|---|---|
| `/` | the reviewer console (D4), static, from `apps/console/dist` |
| `/intent/<ref>`, `/decision/<ref>` | the console again — SPA deep links |
| `/v1/*` | the gateway API (D2) |
| `/health` | the Railway health check |

| Piece | Where | What it is | Built by |
|---|---|---|---|
| Gateway (D2) + Executor (D3) + Console (D4) | Railway | one container: one long-running server, one operator CLI, one static bundle | `Dockerfile` |
| Evidence store | Neon | Postgres, optional (see §4) | — |

```
  browser ──────────────► Railway  (one service, one domain)
     │                       │  /            console bundle
     │                       │  /v1/*        gateway API      ── Neon Postgres
     │                       │  executor CLI (no port)        ── Stellar / Horizon
     │                       │
     └── chain reads ───► Soroban RPC        (authoritative evidence)
```

**The two arrows out of the browser are not equally important**, and §7 explains
why — it is the thing that keeps an API problem from becoming a blank page.

The gateway, the executor and the console share an image on purpose:

- The executor is not a service. It is a CLI an operator runs against the same
  registry and the same keys the gateway is already using. It has no port and no
  request path.
- The console is not a server. It is a directory of static files, and the
  gateway serves them from `apps/console/dist` — see
  `apps/gateway/src/staticConsole.ts`. Same origin, so the console's calls to
  `/v1/...` are same-origin: no CORS to configure (§6), no second provider to
  keep in step, and no second URL to publish.

⚠️ The consequence worth naming: **this process holds `OPERATOR_SECRET`,
`OWNER_SECRET` and `AGENT_SECRETS` and also serves files.** The served root is
exactly `apps/console/dist`; nothing above it is reachable, dotfiles are refused,
and a symlink out of `dist` is refused on its resolved path.
`apps/gateway/test/staticConsole.test.ts` asserts each of those.

### Why the repo can build this without a Rust toolchain

`packages/bindings` is generated from the contract wasm **offline** and
committed. Railway needs no `cargo`, no `wasm32v1-none` target and no `stellar`
CLI. The `bindings-drift` CI job is what keeps the committed output honest.

---

## 2. Before you start

Have these ready:

- The deployed authorization contract ID (`C…`, 56 chars).
- Three testnet secret keys — **owner**, **operator**, **executor** — funded via
  Friendbot as needed. They are three distinct roles; see `.env.example`.
- The agent keypairs, as a single-line JSON object for `AGENT_SECRETS`.
- Accounts on Railway and Neon.

There is no ordering problem to solve any more. One service produces one domain,
and nothing has to be wired back to a second provider.

---

## 3. Railway — the whole deployment

### 3.1 Create the service

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. Railway reads `railway.json` at the repo root and uses the `DOCKERFILE`
   builder. No Nixpacks configuration and no build command are needed — if
   Railway offers to autodetect a Node app, decline.
3. **Settings → Networking → Generate Domain.** Note the
   `https://<name>.up.railway.app` URL. That single URL is the console, the API
   and the health check.

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

### 3.3 Runtime environment variables

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
| `DATABASE_URL` | Neon pooled URL — see §4 |

**Optional, sensible defaults**

| Variable | Default | Note |
|---|---|---|
| `LOG_LEVEL` | `info` | the request log **is** the §6.1 D2 evidence; do not raise this above `info` |
| `CORS_ORIGIN` | unset | **not needed for the console** — it is same-origin now. §6 |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | executor only |
| `TX_TIMEOUT_SECONDS` | `45` | gateway: wait for a contract tx to close |
| `SETTLEMENT_TIMEOUT_SECONDS` | `180` | executor: payment envelope `maxTime`. Integer in `[30, 3600]`; outside it the executor refuses to start |
| `SERVICE_REGISTRY_PATH` | repo-root `services.json` | resolved from the app's own location, so it is correct from any working directory |
| `GATEWAY_REGISTRY_PATH` | `apps/gateway/registry.json` | same |
| `EXECUTOR_DB_PATH` | `apps/executor/.data/settlements.db` | see §3.5 |

**Deliberately NOT needed here**

- `USDC_SAC_ADDRESS` — the executor reads the asset from `services.json` and the
  chain, never from the environment. Setting it changes nothing.
- `STELLAR_NETWORK` — used only by local evidence scripts.
- `PORT` — Railway injects it.
- Any path or root for the console — it is found relative to the gateway's own
  location inside the image, and is deliberately not configurable.

### 3.4 ⚠️ Console variables are BUILD-time, and that is a different mechanism

The console's configuration is **compiled into the JavaScript bundle**. It is not
read at startup and it is not read from the variables in §3.3.

| Variable | Required | Note |
|---|---|---|
| `VITE_STELLAR_RPC_URL` | ✅ | `https://soroban-testnet.stellar.org` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | ✅ | `Test SDF Network ; September 2015` — **no quotes**, same rule as §3.3 |
| `VITE_CONTRACT_ID` | ✅ | must match `CONTRACT_ID` above |
| `VITE_USDC_SAC_ADDRESS` | | lets the console print "USDC (testnet)" beside the raw SAC address |
| `VITE_STELLAR_EXPERT_NETWORK` | | defaults to `testnet` |
| `VITE_SAMPLE_INTENTS` | | comma-separated intent references for the home page deep links |
| `VITE_AEGIS_API_URL` | | **leave unset.** See §6 |

The three required ones are validated when the bundle loads: a build missing any
of them renders an explicit configuration screen — still carrying the testnet
banner — rather than an empty evidence page.

**How they reach the build.** Railway exposes the service's variables to the
Docker build as build arguments, and the `Dockerfile` declares each name as an
`ARG` for exactly that reason. Set them as ordinary service variables alongside
§3.3. Two consequences:

1. **A `VITE_*` name the `Dockerfile` does not declare as `ARG` is invisible to
   the build.** Adding a console variable means editing the `Dockerfile` too.
   There is no way around this and it is not a Railway quirk — an undeclared
   build arg simply does not exist inside the build.
2. **Changing one requires a REBUILD, not a redeploy** — and in a single-image
   deploy, a rebuild means a **fresh image**. Editing the variable in the Railway
   UI and restarting the service serves the old bundle. Trigger a redeploy that
   rebuilds, or push a commit.

This matters most for `VITE_CONTRACT_ID`: redeploying the contract and updating
only `CONTRACT_ID` leaves a console rendering evidence from the **previous**
contract, which looks like working software.

**Anything not prefixed `VITE_` is invisible to the bundle.** That is not a
convention — it is the mechanism keeping `EXECUTOR_SECRET`, `OPERATOR_SECRET`,
`OWNER_SECRET` and `AGENT_SECRETS` out of a world-readable JavaScript file now
that the same process serves both. Never add a `VITE_` prefix to a secret to
"make it available to the frontend". The console has no signer and never submits
a transaction; if it appears to need a key, something else is wrong.

### 3.5 ⚠️ The executor's journal is ephemeral by default

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

### 3.6 Health check

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

The boot log also carries a `serving the reviewer console` line with the root it
resolved. Its absence — replaced by `no console build found` — means the image
was built without the console and every page request will be a JSON 404.

### 3.7 Running a settlement

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

## 5. The console

Nothing to deploy. The image builds `apps/console/dist`
(`--filter "@aegis/console..."` in the `Dockerfile` — the **trailing** dots
select the package *and its dependencies*; leading dots would select its
dependents and build the wrong set) and the gateway serves it.

**Deep links work without configuration.** §6.1 D4 makes the evidence "a public
link to the console" plus a list of intent references, so `/intent/<hash>` has to
resolve in a cold tab. The gateway's not-found handler returns `index.html` for
it, with status 200.

**It does not do that for the API.** A miss under `/v1` — including a decision
that does not exist — stays a JSON 404. This is the one thing to be careful about
if that handler is ever touched: a fallback that answers everything would turn
every API miss into an HTML page with status 200, and a client parsing JSON gets
an error that names nothing useful. `apps/gateway/test/staticConsole.test.ts`
pins the behaviour in both directions.

**Assets are gzipped on the way out** — text, CSS, JavaScript and SVG, for a
client that asks; images and fonts are already compressed and are sent as-is. A
CDN did this for free under the old topology and this server does it itself, so
the bundle crosses the wire at roughly a third of its size.

**There is no `_redirects` file any more.** `apps/console/public/_redirects` was
Cloudflare/Netlify syntax for the SPA fallback. Fastify does not read it, so it
has been deleted rather than left looking load-bearing.

Verify after a deploy:

```bash
curl -si https://<name>.up.railway.app/ | head -1                  # 200, text/html
curl -si https://<name>.up.railway.app/intent/<known-hash> | head -1  # 200, text/html
curl -si https://<name>.up.railway.app/v1/nope | head -1           # 404, application/json
curl -si https://<name>.up.railway.app/.env | head -1              # 404, application/json
```

---

## 6. CORS: not needed for the console, kept for everything else

The console is served from the same origin as the API, so its calls to `/v1/...`
are same-origin. A browser sends no `Origin` header and there is nothing to
allow. **Leave `CORS_ORIGIN` unset. The console works.** `VITE_AEGIS_API_URL`
likewise stays unset: the console calls the API with a relative path, which
follows the deployment to a new domain without a rebuild.

`@fastify/cors` and its allowlist are still in the gateway, because "the console"
is not the same thing as "a browser". Anything else that calls this API from a
page on another origin — a reviewer's own scratch page, a second front end — is
cross-origin and needs an entry:

```
CORS_ORIGIN=https://tools.example.org,https://*.up.railway.app
```

Comma-separated. A leading `*.` label stands for **exactly one label** and never
matches a dot, so it cannot be widened by an attacker-controlled subdomain.
Unset means no CORS headers at all — the default, and the correct setting for a
normal deployment.

Verify (only if you set it):

```bash
curl -si -H "Origin: https://tools.example.org" \
  https://<name>.up.railway.app/health | grep -i access-control-allow-origin
```

An allowed origin is echoed back. A rejected one gets **no header at all** and a
`200` — that is normal: CORS is enforced by the browser, not the server, so
`curl` always sees the body. Judge by the header's presence.

---

## 7. Why an API problem degrades the console instead of breaking it

Worth understanding before debugging a blank page, because it narrows the search
considerably.

The console reads the **authoritative** evidence — the decision, its verdict and
reason, the settlement — directly from **Soroban RPC**, which serves
`access-control-allow-origin: *` to everyone. That path does not touch the
gateway API at all.

The gateway supplies only the **non-authoritative** display fields: `purpose`,
`client_ref`, and the settlement transaction hash — each already tagged
"display only" in the UI.

So a gateway that is up but degraded — no database, say — costs the console
`purpose` and `client_ref`. **The evidence chain still renders.** That asymmetry
is the §6.3 invariant — *the chain is the evidence, the API is a convenience* —
paying rent at deploy time.

The practical inference: **if the evidence itself fails to render, the problem is
not the API.** Look at `VITE_CONTRACT_ID` or `VITE_STELLAR_RPC_URL` instead.

---

## 8. Operational note: the evidence link now depends on this container

SOW §6.1 D4 requires a public link to the console as evidence. In this topology
that link is served by the Railway container, so its availability is the
container's availability: if the service is stopped, crash-looping, or out of
Railway credit, the evidence link is down along with the API. A static host would
not sleep or run out of credit, and the previous two-provider topology kept the
console reachable independently of the gateway.

The client chose the single service knowingly, for one provider, one URL and one
deploy. Recorded here so it is a known property of the deployment rather than a
surprise: keep the service funded and running for as long as the link is expected
to work, and note that `/health` and the console share a fate.

---

## 9. Post-deploy checklist

- [ ] `GET /health` returns `"ok": true`.
- [ ] `network_passphrase` in that response has **no quote characters**.
- [ ] `caller_role` is `operator`.
- [ ] `owner_configured` is `true`.
- [ ] `database` is `postgres`, not `degraded`.
- [ ] Railway boot log line `gateway ready` shows a non-zero `agents` count.
- [ ] Railway boot log line `serving the reviewer console`.
- [ ] Railway replicas = **1**.
- [ ] Volume mounted at `/app/apps/executor/.data`, if settling from the container.
- [ ] `GET /` returns the console with the testnet banner, and renders a known intent.
- [ ] `GET /intent/<hash>` resolves in a fresh tab rather than 404ing.
- [ ] `GET /v1/nope` returns **JSON**, not HTML.
- [ ] The contract ID shown in the console matches `CONTRACT_ID` on Railway.

---

## 10. Troubleshooting

| Symptom | Cause |
|---|---|
| Boot fails: `missing required environment variable …` | that variable is unset on Railway. The gateway resolves all config at startup precisely so this names the variable instead of failing mid-request |
| Boot fails: `… is not a valid Stellar secret key (S…)` | a truncated or public (`G…`) key in a `*_SECRET` |
| Boot fails: `AGENT_SECRETS key mismatch` | a secret filed under an address it does not belong to. Deliberate: signing as the wrong agent must not be a silent outcome |
| Boot fails: `route … is outside API_PREFIXES` | an API route was added outside `/v1` and `/health`. Deliberate: that route's 404s would otherwise be answered with the console's HTML. Add the prefix in `apps/gateway/src/staticConsole.ts` |
| Boot fails: `SETTLEMENT_TIMEOUT_SECONDS must be an integer in [30, 3600]` | out of range |
| Every submission is rejected on chain, config looks right | quotes typed into `STELLAR_NETWORK_PASSPHRASE`. Check `/health` |
| `"database": "degraded"` | missing `?sslmode=require`, a suspended Neon branch, or a wrong password. Check the boot log's `reason` |
| `caller_role: "owner"` unexpectedly | `OPERATOR_SECRET` empty; the gateway fell back to `OWNER_SECRET` |
| `GET /` returns a JSON 404 | the image was built without the console. Look for `no console build found` in the boot log; check the `Dockerfile`'s `--filter "@aegis/console..."` |
| Console shows a configuration screen | one of the three required `VITE_*` is unset **at build time**. Set it and **rebuild** — §3.4 |
| Console renders evidence but `purpose` / `client_ref` are missing | the gateway's database. §4.4, §7 |
| Console renders nothing at all | `VITE_CONTRACT_ID` or `VITE_STELLAR_RPC_URL`. §7 |
| Console still shows the old contract after a redeploy | `VITE_*` is inlined at build time. Rebuild the image. §3.4 |
| A deep link 404s | the request reached something other than this gateway, or the path collides with an API prefix. §5 |
| An API call returns HTML | the not-found handler was changed. §5, and the test that pins it |
| Duplicate payments | replicas > 1. §3.2 |

---

## 11. What is public, and what must never be

**Public by construction** — and intentionally so, since §6.3 asks a reviewer to
verify a decision independently: the contract ID, the RPC endpoint, the network
passphrase, the USDC SAC address, and everything in the console bundle.

**Never public:** `EXECUTOR_SECRET`, `OPERATOR_SECRET`, `OWNER_SECRET`,
`AGENT_SECRETS`, `DATABASE_URL`. These are set as Railway variables only. Four
mechanisms keep them out of a distributable artifact, and the fourth is new with
this topology:

- Vite ignores anything without a `VITE_` prefix (§3.4), so no secret reaches the
  bundle even though the same process serves it.
- The gateway serves files from `apps/console/dist` and nowhere else. Paths
  cannot climb above it, dotfiles are refused, and a symlink pointing out of it
  is refused on its resolved path — so `.env`, the registry files and the
  executor's journal are all unreachable over HTTP.
  `apps/gateway/test/staticConsole.test.ts` asserts this.
- `.dockerignore` excludes every `.env` at every depth from the **build
  context**, so no image layer ever contains one. It also stops a stray `.env`
  from silently overriding the variables Railway injects — both services call
  `process.loadEnvFile()` on a `.env` sitting next to them.
- `.gitignore` keeps `.env` and `docs/*.pdf` out of the repository.

⚠️ Phase 1 keeps the agents' secret keys in the gateway process
(DECISIONS.md #10) and trusts `EXECUTOR_SECRET` (DECISIONS.md #6). These are
recorded limitations of a **testnet** deliverable, not oversights. Rotate any
key that has been exposed, and never reuse one of these on mainnet.
