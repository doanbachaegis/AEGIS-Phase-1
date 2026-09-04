# AEGIS gateway + executor — TESTNET ONLY.
#
# One image, two entry points. The gateway (D2) is the long-running server and
# is what the container starts. The executor (D3) is an operator-driven CLI that
# ships in the same image so a settlement can be run against the same code, the
# same registry and the same keys the gateway is using:
#
#   node apps/executor/dist/cli.js settle --decision <64-hex>
#
# The console (D4) is NOT here. It is a static bundle built by Cloudflare Pages;
# see DEPLOY.md.
#
# ⚠️ SCALING: this image must run at exactly one replica. The reason is in
# railway.json's `numReplicas` and spelled out in DEPLOY.md — the executor holds
# a single Stellar account and precomputes payment envelopes against its
# sequence number, so a second replica is a duplicate-payment bug, not extra
# capacity.

# ---------------------------------------------------------------- build stage

FROM node:24-alpine AS build

# Pinned to the `packageManager` field in package.json. Pinning it here as well
# means the image cannot drift onto a different pnpm than the lockfile was
# resolved with, even if that field is edited without a rebuild.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate

WORKDIR /app

# Manifests and the lockfile FIRST, so the install layer is reused on every
# build that does not change a dependency — which is most of them.
#
# Every workspace member's manifest has to be present before `pnpm install`, not
# just the two that get built: `--frozen-lockfile` verifies the lockfile against
# the whole workspace, and a missing member makes it fail as out of date.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/console/package.json      apps/console/
COPY apps/executor/package.json     apps/executor/
COPY apps/gateway/package.json      apps/gateway/
COPY packages/bindings/package.json packages/bindings/
COPY packages/canonical/package.json packages/canonical/
COPY packages/receipt/package.json  packages/receipt/
COPY tools/verifier/package.json    tools/verifier/

# `--frozen-lockfile` is the point of the exercise: the build fails rather than
# silently resolving a different dependency graph than CI tested.
RUN pnpm install --frozen-lockfile

COPY . .

# Build the two services and THEIR DEPENDENCIES — the console is excluded.
#
# The TRAILING dots are load-bearing. `--filter "<pkg>..."` selects the package
# plus everything it depends on; leading dots ("...<pkg>") would select its
# dependents instead. Getting this backwards still produces a green build and a
# container that dies at boot on a missing `packages/canonical/dist`.
#
# The closure this selects, verified against `pnpm list`:
#   @aegis/gateway, @aegis/executor, @aegis/bindings, @aegis/canonical, @aegis/receipt
#
# `packages/bindings` is committed and generated offline from the contract wasm,
# so nothing in this build needs a Rust toolchain or the `stellar` CLI.
#
# Not `pnpm deploy`: pnpm 10 changed it to require `inject-workspace-packages`
# or `--legacy`, and the workspace is small enough that copying it whole is the
# cheaper correctness bet. Image size does not matter for this project.
RUN pnpm --filter "@aegis/gateway..." --filter "@aegis/executor..." build

# -------------------------------------------------------------- runtime stage

FROM node:24-alpine AS runtime

ENV NODE_ENV=production

# pnpm is kept in the runtime image on purpose. It is not needed to start the
# server — the CMD calls node directly — but it is what makes the one-off
# operator tasks possible from a Railway shell, notably the Drizzle migration:
#   pnpm --filter @aegis/gateway db:migrate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# COREPACK_HOME is set explicitly, and that is not incidental. Corepack caches
# the pnpm tarball under the HOME of whoever ran `prepare` — root, here — while
# the container runs as `node`. Left at the default, the cache would be
# invisible to the process that needs it and every `pnpm` invocation in a
# Railway shell would silently re-download pnpm from the network, which fails
# outright if egress to the npm registry is closed. Pinning the cache to a
# shared path and handing it to `node` makes the runtime image genuinely
# self-contained.
ENV COREPACK_HOME=/opt/corepack
RUN mkdir -p /pnpm /opt/corepack \
  && corepack enable \
  && corepack prepare pnpm@10.18.2 --activate \
  && chown -R node:node /pnpm /opt/corepack

WORKDIR /app

# The whole built workspace, including node_modules. pnpm's node_modules layout
# is relative symlinks into `/app/node_modules/.pnpm`, so it survives this copy
# intact only because the ENTIRE tree moves together and the path stays `/app`.
COPY --from=build --chown=node:node /app /app

# The executor's SQLite journal.
#
# ⚠️ This path is EPHEMERAL unless a volume is mounted here. The journal is the
# executor's whole crash-recovery story — it is what turns "unknown" into
# "proven absent" for a submitted-but-unconfirmed payment — so losing it across
# a restart loses the ability to reconcile an in-flight settlement. DEPLOY.md
# covers mounting a Railway volume at this path.
RUN mkdir -p /app/apps/executor/.data && chown -R node:node /app/apps/executor/.data

# Unprivileged. The image holds signing keys at runtime; nothing here needs root.
USER node

# Documentation only — Railway injects $PORT and the server binds it. The
# gateway already listens on 0.0.0.0, which is what makes it reachable from
# outside the container.
EXPOSE 8080

CMD ["node", "apps/gateway/dist/server.js"]
