#!/usr/bin/env bash
#
# d2-verify-preimages.sh -- recompute every intent_hash from the transcript,
# with no AEGIS code anywhere in the loop.
#
# SOW 6.1 D2 asks that a reviewer be able to derive intent_hash from a submitted
# intent. The gateway logs the exact bytes it hashed as `canonical_hex` on the
# `intent.received` record, so the whole check is two standard tools:
#
#     echo -n <canonical_hex> | xxd -r -p | shasum -a 256
#
# This script runs that line for every submission in evidence/d2-gateway.ndjson
# and compares the result to the intent_hash the same record carries. It imports
# nothing from this repository -- python3 is used only to pull two strings out of
# each JSON line, never to hash anything.
#
# Usage: ./scripts/d2-verify-preimages.sh [ndjson-path]
# Exit:  0 all recomputed hashes match, 1 otherwise.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NDJSON="${1:-$REPO_ROOT/evidence/d2-gateway.ndjson}"
OUT="${2:-$REPO_ROOT/evidence/d2-preimage-recompute.txt}"

command -v xxd >/dev/null || { echo "xxd not found" >&2; exit 2; }
command -v shasum >/dev/null || { echo "shasum not found" >&2; exit 2; }

{
  echo "intent_hash recomputation from the gateway transcript"
  echo "source     : $NDJSON"
  echo "method     : echo -n <canonical_hex> | xxd -r -p | shasum -a 256"
  echo "AEGIS code : none -- xxd and shasum only"
  echo "generated  : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  printf '%-4s %-64s %-9s %s\n' "#" "intent_hash (as logged)" "recompute" "preimage bytes"
  printf '%-4s %-64s %-9s %s\n' "----" "----------------------------------------------------------------" "---------" "--------------"
} >"$OUT"

pass=0
fail=0
n=0

while IFS=$'\t' read -r logged canonical; do
  n=$((n + 1))
  recomputed="$(printf '%s' "$canonical" | xxd -r -p | shasum -a 256 | awk '{print $1}')"
  if [[ "$recomputed" == "$logged" ]]; then
    status="MATCH"
    pass=$((pass + 1))
  else
    status="MISMATCH"
    fail=$((fail + 1))
  fi
  printf '%-4s %-64s %-9s %s\n' "$n" "$logged" "$status" "$((${#canonical} / 2))" >>"$OUT"
  if [[ "$status" == "MISMATCH" ]]; then
    printf '     recomputed: %s\n' "$recomputed" >>"$OUT"
  fi
done < <(python3 - "$NDJSON" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    for line in fh:
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if rec.get("event") == "intent.received":
            print(f"{rec['intent_hash']}\t{rec['canonical_hex']}")
PY
)

{
  echo
  echo "records checked : $n"
  echo "match           : $pass"
  echo "mismatch        : $fail"
} >>"$OUT"

cat "$OUT"
[[ "$fail" -eq 0 ]]
