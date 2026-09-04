#!/usr/bin/env bash
#
# bootstrap-settlement.sh -- make settlement physically possible on testnet.
#
# Brings a clean machine to the point where the executor can actually send USDC
# to a merchant: identities exist, accounts are funded with XLM, both ends hold a
# USDC trustline, and the executor holds a USDC balance.
#
# Idempotent by construction. Every step inspects live network state first and
# skips work that is already done, so re-running is a no-op that prints a status
# report. Nothing here touches the deployed authorization contract.
#
# Usage:
#   ./scripts/bootstrap-settlement.sh          # ensure everything, then report
#   ./scripts/bootstrap-settlement.sh --status # report only, change nothing
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# The Homebrew prefix is where `stellar` lands on macOS and is not always on a
# non-interactive PATH. Appending is harmless when it is already there.
export PATH="/opt/homebrew/bin:$PATH"

# ---------------------------------------------------------------------------
# Configuration -- Phase 1 testnet constants.
# ---------------------------------------------------------------------------
NETWORK="testnet"
HORIZON="https://horizon-testnet.stellar.org"
FRIENDBOT="https://friendbot.stellar.org"

USDC_CODE="USDC"
USDC_ISSUER="GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
USDC_LINE="${USDC_CODE}:${USDC_ISSUER}"

EXECUTOR_ALIAS="aegis-executor"
MERCHANT_ALIAS="aegis-merchant-1"

# Enough for the 10 demo settlements plus retries, with headroom.
MIN_EXECUTOR_USDC="100"

STATUS_ONLY=0
[[ "${1:-}" == "--status" ]] && STATUS_ONLY=1

# ---------------------------------------------------------------------------
# Output helpers.
# ---------------------------------------------------------------------------
info() { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
ok()   { printf '  [ok]   %s\n' "$*"; }
did()  { printf '  [did]  %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*" >&2; }
die()  { printf '  [fail] %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight.
# ---------------------------------------------------------------------------
step "Preflight"

command -v stellar >/dev/null || die "stellar CLI not found on PATH (expected /opt/homebrew/bin/stellar)"
command -v curl    >/dev/null || die "curl not found on PATH"
command -v python3 >/dev/null || die "python3 not found on PATH (used to parse Horizon JSON)"
ok "stellar $(stellar --version | head -1 | awk '{print $2}'), curl, python3 present"

# The stellar CLI auto-loads ./.env from the working directory. Because .env sets
# STELLAR_RPC_URL it must also set STELLAR_NETWORK_PASSPHRASE, and that value has
# to be QUOTED -- it contains a ';' which .env parsers read as a comment marker.
# An unquoted passphrase truncates to "Test SDF Network " and every signature
# fails with a confusing bad-auth error, so refuse to run rather than debug that.
if [[ -f .env ]]; then
  if grep -q '^STELLAR_RPC_URL=' .env && ! grep -q '^STELLAR_NETWORK_PASSPHRASE=' .env; then
    die ".env sets STELLAR_RPC_URL but not STELLAR_NETWORK_PASSPHRASE -- the CLI needs both"
  fi
  if grep -q '^STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015' .env; then
    die "STELLAR_NETWORK_PASSPHRASE in .env is unquoted -- wrap the value in double quotes"
  fi
  ok ".env present and passphrase correctly quoted"
else
  warn ".env not found -- relying on the CLI's configured network '$NETWORK'"
fi

# ---------------------------------------------------------------------------
# Horizon helpers.
# ---------------------------------------------------------------------------

# account_exists <G...> -- 0 if the account is funded and on-ledger.
account_exists() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$HORIZON/accounts/$1")
  [[ "$code" == "200" ]]
}

# balance_of <G...> <asset_code|native> -- prints the balance, or "" if no such line.
balance_of() {
  curl -s "$HORIZON/accounts/$1" | python3 -c '
import sys, json
want = sys.argv[1]
try:
    balances = json.load(sys.stdin)["balances"]
except Exception:
    sys.exit(0)
for b in balances:
    if want == "native":
        if b.get("asset_type") == "native":
            print(b["balance"]); break
    elif b.get("asset_code") == want and b.get("asset_issuer") == sys.argv[2]:
        print(b["balance"]); break
' "$2" "${3:-}"
}

# has_trustline <G...> -- 0 if a USDC trustline to the pinned issuer exists.
has_trustline() {
  [[ -n "$(balance_of "$1" "$USDC_CODE" "$USDC_ISSUER")" ]]
}

# address_of <alias> -- prints the G... address, or "" if the identity is absent.
address_of() {
  stellar keys address "$1" 2>/dev/null || true
}

# upsert_env <KEY> <VALUE> -- set KEY in .env, replacing any existing line.
# Only ever adds or updates the keys this script owns; nothing is removed.
upsert_env() {
  local key="$1" value="$2"
  [[ -f .env ]] || return 0
  if grep -q "^${key}=" .env; then
    local current
    current=$(grep "^${key}=" .env | head -1 | cut -d= -f2-)
    [[ "$current" == "$value" ]] && return 0
    python3 - "$key" "$value" <<'PY'
import sys, io
key, value = sys.argv[1], sys.argv[2]
with io.open(".env", encoding="utf-8") as fh:
    lines = fh.readlines()
with io.open(".env", "w", encoding="utf-8") as fh:
    for line in lines:
        fh.write(f"{key}={value}\n" if line.startswith(key + "=") else line)
PY
    did "updated $key in .env"
  else
    printf '%s=%s\n' "$key" "$value" >> .env
    did "added $key to .env"
  fi
}

# ---------------------------------------------------------------------------
# 1. Identities.
# ---------------------------------------------------------------------------
step "Identities"

EXECUTOR=$(address_of "$EXECUTOR_ALIAS")
[[ -n "$EXECUTOR" ]] || die "identity '$EXECUTOR_ALIAS' is missing -- it holds deployed state and must not be regenerated here"
ok "$EXECUTOR_ALIAS = $EXECUTOR"

MERCHANT=$(address_of "$MERCHANT_ALIAS")
if [[ -z "$MERCHANT" ]]; then
  if (( STATUS_ONLY )); then
    warn "$MERCHANT_ALIAS does not exist (--status: not creating it)"
  else
    stellar keys generate "$MERCHANT_ALIAS" --network "$NETWORK" --fund >/dev/null 2>&1
    MERCHANT=$(address_of "$MERCHANT_ALIAS")
    [[ -n "$MERCHANT" ]] || die "failed to create identity $MERCHANT_ALIAS"
    did "created and funded $MERCHANT_ALIAS = $MERCHANT"
  fi
else
  ok "$MERCHANT_ALIAS = $MERCHANT"
fi

# ---------------------------------------------------------------------------
# 2. XLM funding -- every account needs a reserve before it can hold a trustline.
# ---------------------------------------------------------------------------
step "XLM funding"

for pair in "$EXECUTOR_ALIAS:$EXECUTOR" "$MERCHANT_ALIAS:$MERCHANT"; do
  alias="${pair%%:*}"; addr="${pair#*:}"
  [[ -n "$addr" ]] || continue
  if account_exists "$addr"; then
    ok "$alias funded ($(balance_of "$addr" native) XLM)"
  elif (( STATUS_ONLY )); then
    warn "$alias is NOT funded (--status: not funding it)"
  else
    curl -s "$FRIENDBOT/?addr=$addr" >/dev/null
    account_exists "$addr" || die "friendbot did not fund $alias ($addr)"
    did "friendbot funded $alias ($(balance_of "$addr" native) XLM)"
  fi
done

# ---------------------------------------------------------------------------
# 3. USDC trustlines.
# ---------------------------------------------------------------------------
# The Circle testnet issuer has auth_required=false, so changeTrust alone is
# sufficient: the line comes back authorized with no allowTrust round trip.
# (auth_revocable=true, which lets the issuer freeze a line later, but that does
# not affect establishing one.)
step "USDC trustlines"

for pair in "$EXECUTOR_ALIAS:$EXECUTOR" "$MERCHANT_ALIAS:$MERCHANT"; do
  alias="${pair%%:*}"; addr="${pair#*:}"
  [[ -n "$addr" ]] || continue
  if has_trustline "$addr"; then
    ok "$alias already trusts $USDC_CODE"
  elif (( STATUS_ONLY )); then
    warn "$alias has NO $USDC_CODE trustline (--status: not creating it)"
  else
    stellar tx new change-trust --source-account "$alias" --line "$USDC_LINE" >/dev/null 2>&1
    has_trustline "$addr" || die "changeTrust did not take effect for $alias"
    did "$alias now trusts $USDC_CODE"
  fi
done

# ---------------------------------------------------------------------------
# 4. Executor USDC balance.
# ---------------------------------------------------------------------------
step "Executor USDC balance"

EXEC_USDC=$(balance_of "$EXECUTOR" "$USDC_CODE" "$USDC_ISSUER")
EXEC_USDC="${EXEC_USDC:-0}"

if python3 -c "import sys; sys.exit(0 if float('$EXEC_USDC') >= float('$MIN_EXECUTOR_USDC') else 1)"; then
  ok "executor holds $EXEC_USDC $USDC_CODE (>= $MIN_EXECUTOR_USDC required)"
else
  warn "executor holds $EXEC_USDC $USDC_CODE, below the $MIN_EXECUTOR_USDC needed for 10 settlements plus retries"
  cat >&2 <<EOF

  Testnet USDC for this issuer cannot be obtained from a shell. Circle's faucet
  at https://faucet.circle.com is the only dispenser for
  ${USDC_ISSUER}
  and it is browser-gated (see the FAUCET section in this script's header notes).

  Manual step, once, per executor account:
    1. Open https://faucet.circle.com in a browser.
    2. Select network "Stellar" and testnet.
    3. Paste the executor address:
       ${EXECUTOR}
    4. Request. The trustline already exists, so delivery succeeds immediately.
    5. Re-run this script to confirm.

  Do NOT substitute a self-issued test asset. SOW out-of-scope #9 pins Phase 1 to
  testnet USDC, and a substitute would silently invalidate the settlement claim.
EOF
fi

# ---------------------------------------------------------------------------
# 5. Record results in .env.
# ---------------------------------------------------------------------------
if (( ! STATUS_ONLY )); then
  step "Recording addresses in .env"
  upsert_env MERCHANT_ACCOUNT "$MERCHANT"
  upsert_env EXECUTOR_ACCOUNT "$EXECUTOR"
  upsert_env USDC_ISSUER "$USDC_ISSUER"
  upsert_env SERVICE_REGISTRY_PATH "./services.json"
fi

# ---------------------------------------------------------------------------
# 6. Registry cross-check -- the committed registry must agree with the network.
# ---------------------------------------------------------------------------
step "Service registry"

if [[ -f services.json ]]; then
  python3 - "$EXECUTOR" "$MERCHANT" "$USDC_ISSUER" <<'PY'
import json, sys, hashlib, io

executor, merchant, issuer = sys.argv[1], sys.argv[2], sys.argv[3]
raw = io.open("services.json", "rb").read()
reg = json.loads(raw.decode("utf-8"))

problems = []
if reg["executor"]["account_id"] != executor:
    problems.append("registry executor %s != live executor %s"
                    % (reg["executor"]["account_id"], executor))
if reg["asset"]["issuer"] != issuer:
    problems.append("registry issuer %s != pinned issuer %s"
                    % (reg["asset"]["issuer"], issuer))
for svc in reg["services"]:
    if merchant and svc["destination"] != merchant:
        problems.append("service %s -> %s, but live merchant is %s"
                        % (svc["service_id"], svc["destination"], merchant))

for p in problems:
    print("  [warn] %s" % p, file=sys.stderr)
if not problems:
    print("  [ok]   services.json agrees with live accounts")

print("  registry_version %s, %d service(s): %s"
      % (reg["registry_version"], len(reg["services"]),
         ", ".join(s["service_id"] for s in reg["services"])))
print("  registry_hash sha256 = %s" % hashlib.sha256(raw).hexdigest())
PY
else
  warn "services.json not found at repo root -- the verifier has no destination binding to check against"
fi

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------
step "Summary"
printf '  %-16s %s\n' "executor"  "$EXECUTOR"
printf '  %-16s %s XLM / %s USDC\n' ""  "$(balance_of "$EXECUTOR" native)" "$(balance_of "$EXECUTOR" "$USDC_CODE" "$USDC_ISSUER")"
if [[ -n "$MERCHANT" ]]; then
  printf '  %-16s %s\n' "merchant" "$MERCHANT"
  printf '  %-16s %s XLM / %s USDC\n' "" "$(balance_of "$MERCHANT" native)" "$(balance_of "$MERCHANT" "$USDC_CODE" "$USDC_ISSUER")"
fi
printf '\n'
