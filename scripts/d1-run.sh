#!/usr/bin/env bash
#
# D1 evidence: 70 authorize runs (SOW 6.1 D1).
#
#   bash scripts/d1-run.sh            # the full 70 -> evidence/d1-authorize/
#   bash scripts/d1-run.sh --smoke    # 7 runs      -> evidence/d1-authorize-smoke/
#
# Reads .env from the repo root. STELLAR_NETWORK_PASSPHRASE contains a ';' and
# must stay quoted there.
#
# Prerequisite: `pnpm build` (the script imports the built dist/ of
# @aegis/bindings and @aegis/canonical directly - see the header of
# d1-authorize-runs.ts for why).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "scripts/d1-run.sh: no .env at $ROOT" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

for f in packages/bindings/dist/index.js packages/canonical/dist/index.js; do
  [[ -f "$f" ]] || { echo "scripts/d1-run.sh: missing $f - run 'pnpm build' first" >&2; exit 1; }
done

exec npx tsx scripts/d1-authorize-runs.ts "$@"
