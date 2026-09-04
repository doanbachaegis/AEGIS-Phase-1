#!/usr/bin/env python3
"""
d3-run.py -- produce the SOW 6.1 D3 evidence: 10 real testnet settlements,
10 replay attempts, and an independent verifier run over every one of them.

Phases, in the order they must happen:

  refusals  hand the executor decisions that authorize no payment. Two are
            required by 6.1 D2 ("two attempts to hand the executor an intent
            with no approved decision"); a third, a decision_id that does not
            exist at all, is included as a bonus. All must be refused BY THE
            EXECUTOR'S OWN GATE, before any transaction is built.
  settle    the 10 settlements. `mark_settled` is irreversible, so this phase
            runs only over decisions the plan marked `settle: true` AND that the
            chain currently reports as Approved. Nothing speculative.
  replay    re-run `settle` for each of the 10. Each must refuse with
            ALREADY_SETTLED and MUST NOT produce a second payment.
  verify    tools/verifier over each settlement, in --strict mode. The verifier
            shares no code with the executor; it reads Horizon and Soroban RPC
            only. Its "exactly one transaction carries this memo" scan runs
            AFTER the replay phase on purpose: that ordering is what turns "the
            replay was refused" into "no second payment exists".

Balances at both ends of the run are read straight from Horizon, so the total
that moved can be checked against the sum of the decisions without trusting any
AEGIS output.

Usage:
  python3 scripts/d3-run.py [--phase all|refusals|settle|replay|verify]
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXECUTOR_CLI = os.path.join(REPO_ROOT, "apps", "executor", "dist", "cli.js")
VERIFIER_CLI = os.path.join(REPO_ROOT, "tools", "verifier", "dist", "cli.js")
HORIZON = "https://horizon-testnet.stellar.org"
EXPERT_TX = "https://stellar.expert/explorer/testnet/tx/"

# Refusals that came from the decision itself. Re-running changes nothing, so a
# retry would only add noise to the transcript.
GATE_CODES = {
    "DECISION_NOT_FOUND", "NOT_APPROVED", "ALREADY_SETTLED", "ASSET_MISMATCH",
    "AMOUNT_OUT_OF_RANGE", "UNKNOWN_SERVICE", "MEMO_MISMATCH", "PREFLIGHT_FAILED",
}
# Refusals about the run rather than the decision. `recover` -- never a fresh
# `settle` -- is the correct response: it drives the STORED attempt forward and
# can never rebuild an envelope that may already be in flight.
RECOVERABLE_CODES = {
    "LOCK_HELD", "MARK_SETTLED_FAILED", "SUBMIT_FAILED", "INCLUSION_UNKNOWN", "SOURCE_UNAVAILABLE",
}
MAX_RECOVER_ATTEMPTS = 4
RECOVER_SLEEP_SECONDS = 8


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def run(cmd, timeout=600):
    started = time.perf_counter()
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=timeout)
    return {
        "command": " ".join(cmd[1:]) if cmd and cmd[0].endswith("node") else " ".join(cmd),
        "argv": cmd,
        "exit_code": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "wall_ms": round((time.perf_counter() - started) * 1000),
    }


def error_code(result) -> str | None:
    """The executor prints `CODE: message (expected X, got Y)` on stderr."""
    for line in (result["stderr"] or "").splitlines():
        head = line.split(":", 1)[0].strip()
        if head.isupper() and "_" in head or head in GATE_CODES:
            return head
    return None


def horizon_account(account_id):
    with urllib.request.urlopen(f"{HORIZON}/accounts/{account_id}", timeout=30) as resp:
        return json.load(resp)


def balances(account_id):
    out = {}
    for b in horizon_account(account_id)["balances"]:
        key = b.get("asset_code", "XLM") if b.get("asset_type") != "native" else "XLM"
        out[key] = b["balance"]
    return out


def settle_once(decision_id, receipt_path, verb="settle"):
    cmd = ["node", EXECUTOR_CLI, verb, "--decision", decision_id, "--json"]
    if receipt_path:
        cmd += ["--receipt", receipt_path]
    return run(cmd)


def settle_with_recovery(decision_id, receipt_path):
    """settle, then `recover` (never a second `settle`) if the run itself faltered."""
    attempts = []
    result = settle_once(decision_id, receipt_path)
    attempts.append({"verb": "settle", "exit_code": result["exit_code"], "code": error_code(result)})
    tries = 0
    while result["exit_code"] != 0 and error_code(result) in RECOVERABLE_CODES and tries < MAX_RECOVER_ATTEMPTS:
        tries += 1
        code = error_code(result)
        print(f"    {code} -- recovering the stored attempt ({tries}/{MAX_RECOVER_ATTEMPTS})", file=sys.stderr)
        time.sleep(RECOVER_SLEEP_SECONDS)
        result = settle_once(decision_id, receipt_path, verb="recover")
        attempts.append({"verb": "recover", "exit_code": result["exit_code"], "code": error_code(result)})
    result["attempt_trail"] = attempts
    return result


def load_index(evidence_dir):
    with open(os.path.join(evidence_dir, "d2-index.json"), encoding="utf-8") as fh:
        return json.load(fh)


def settle_targets(index):
    """Decisions the plan marked for settlement, in submission order."""
    targets = []
    for case_id, case in index["cases"].items():
        if not case.get("settle"):
            continue
        verdict = case.get("verdict_after_resolve") or case.get("verdict")
        if verdict != "Approved":
            print(f"  !! {case_id} is {verdict}, not Approved -- excluded from the settle set", file=sys.stderr)
            continue
        targets.append((case["n"], case_id, case))
    return [t for t in sorted(targets)]


def write_json(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", default="all",
                    choices=["all", "refusals", "settle", "replay", "verify"])
    ap.add_argument("--out-dir", default=os.path.join(REPO_ROOT, "evidence"))
    args = ap.parse_args()

    evidence = args.out_dir
    receipts_dir = os.path.join(evidence, "d3-receipts")
    verifier_dir = os.path.join(evidence, "d3-verifier")
    os.makedirs(receipts_dir, exist_ok=True)
    os.makedirs(verifier_dir, exist_ok=True)

    for path, what in ((EXECUTOR_CLI, "executor"), (VERIFIER_CLI, "verifier")):
        if not os.path.exists(path):
            print(f"{what} is not built: {path} is missing", file=sys.stderr)
            return 1

    index = load_index(evidence)
    targets = settle_targets(index)
    state_path = os.path.join(evidence, "d3-state.json")
    state = {}
    if os.path.exists(state_path):
        with open(state_path, encoding="utf-8") as fh:
            state = json.load(fh)
    state.setdefault("runs", {})
    state.setdefault("refusals", [])
    state.setdefault("replays", {})
    state.setdefault("verifier", {})

    def save_state():
        write_json(state_path, state)

    executor_account = "GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3"
    merchant_account = "GB4U7IJPAOXEANDUFEAJHXTBL4YJO7AMVM4Q57D6ABDUMCUXV2C7LLHY"

    # ------------------------------------------------------------- refusals
    if args.phase in ("all", "refusals"):
        print("== phase: executor refusals (no approved decision behind the intent)")
        cases = index["cases"]
        planned = [
            ("REFUSAL-3", cases["s14"]["decision_id"],
             "decision is RequiresApproval and still unresolved -- nobody has approved this spend"),
            ("REFUSAL-4", cases["s11"]["decision_id"],
             "decision is Rejected (CapExceeded) -- the contract refused this spend outright"),
            ("REFUSAL-5-bonus", "0" * 64,
             "no such decision on chain -- the executor has nothing to gate against"),
        ]
        state["refusals"] = []
        for case_id, decision_id, why in planned:
            print(f"  {case_id}  decision {decision_id[:16]}...")
            result = settle_once(decision_id, None)
            code = error_code(result)
            print(f"    -> exit {result['exit_code']}  {code}")
            state["refusals"].append({
                "case_id": case_id, "decision_id": decision_id, "why": why,
                "at": now_iso(), "exit_code": result["exit_code"], "gate_code": code,
                "is_gate_refusal": code in GATE_CODES,
                "stdout": result["stdout"], "stderr": result["stderr"],
            })
        save_state()

    # -------------------------------------------------------------- settle
    if args.phase in ("all", "settle"):
        print(f"== phase: settle ({len(targets)} decisions)")
        state["balances_before"] = {
            "at": now_iso(),
            "executor": balances(executor_account),
            "merchant": balances(merchant_account),
        }
        save_state()
        for n, case_id, case in targets:
            decision_id = case["decision_id"]
            if state["runs"].get(case_id, {}).get("exit_code") == 0:
                print(f"  [{n:>2}] {case_id} already settled in a previous run, skipping")
                continue
            receipt_path = os.path.join(receipts_dir, f"{n:02d}-{case_id}-{decision_id[:16]}.json")
            print(f"  [{n:>2}] {case_id}  {case['amount_stroops']} stroops  decision {decision_id[:16]}...")
            result = settle_with_recovery(decision_id, receipt_path)
            payload = {}
            if result["exit_code"] == 0:
                try:
                    payload = json.loads(result["stdout"])
                except json.JSONDecodeError:
                    payload = {}
            state["runs"][case_id] = {
                "n": n, "case_id": case_id, "decision_id": decision_id,
                "amount_stroops": case["amount_stroops"], "at": now_iso(),
                "exit_code": result["exit_code"], "gate_code": error_code(result),
                "wall_ms": result["wall_ms"], "attempt_trail": result["attempt_trail"],
                "receipt_path": os.path.relpath(receipt_path, REPO_ROOT),
                "tx_hash": payload.get("txHash"), "memo_hash": payload.get("memoHash"),
                "status": payload.get("status"), "ledger": payload.get("ledger"),
                "mark_settled_ledger": payload.get("markSettledLedger"),
                "destination": payload.get("destination"),
                "stellar_expert": EXPERT_TX + payload["txHash"] if payload.get("txHash") else None,
                "stdout": result["stdout"], "stderr": result["stderr"],
            }
            print(f"       -> exit {result['exit_code']}  {payload.get('status')}  tx {str(payload.get('txHash'))[:16]}")
            save_state()
        state["balances_after_settle"] = {
            "at": now_iso(),
            "executor": balances(executor_account),
            "merchant": balances(merchant_account),
        }
        save_state()

    # -------------------------------------------------------------- replay
    if args.phase in ("all", "replay"):
        settled = [(v["n"], k, v) for k, v in state["runs"].items() if v.get("exit_code") == 0]
        print(f"== phase: replay ({len(settled)} attempts, each must be refused)")
        for n, case_id, run_record in sorted(settled):
            decision_id = run_record["decision_id"]
            print(f"  [{n:>2}] {case_id}  replay settle --decision {decision_id[:16]}...")
            result = settle_once(decision_id, None)
            code = error_code(result)
            state["replays"][case_id] = {
                "n": n, "decision_id": decision_id, "at": now_iso(),
                "exit_code": result["exit_code"], "gate_code": code,
                "refused": result["exit_code"] != 0 and code == "ALREADY_SETTLED",
                "original_tx_hash": run_record.get("tx_hash"),
                "stdout": result["stdout"], "stderr": result["stderr"],
            }
            print(f"       -> exit {result['exit_code']}  {code}")
            save_state()
        state["balances_after_replay"] = {
            "at": now_iso(),
            "executor": balances(executor_account),
            "merchant": balances(merchant_account),
        }
        save_state()

    # -------------------------------------------------------------- verify
    if args.phase in ("all", "verify"):
        settled = [(v["n"], k, v) for k, v in state["runs"].items() if v.get("exit_code") == 0]
        print(f"== phase: verify ({len(settled)} settlements, --strict)")
        for n, case_id, run_record in sorted(settled):
            tx_hash = run_record["tx_hash"]
            receipt = os.path.join(REPO_ROOT, run_record["receipt_path"])
            base = f"{n:02d}-{case_id}-{run_record['decision_id'][:16]}"
            text = run(["node", VERIFIER_CLI, "--tx", tx_hash, "--receipt", receipt, "--strict"])
            js = run(["node", VERIFIER_CLI, "--tx", tx_hash, "--receipt", receipt, "--strict", "--json"])
            with open(os.path.join(verifier_dir, f"{base}.txt"), "w", encoding="utf-8") as fh:
                fh.write(text["stdout"])
                if text["stderr"].strip():
                    fh.write("\n--- stderr ---\n" + text["stderr"])
            verdicts = {0: "VERIFIED", 1: "FAILED", 2: "USAGE", 3: "UNAVAILABLE"}
            parsed = None
            try:
                parsed = json.loads(js["stdout"])
            except json.JSONDecodeError:
                pass
            if parsed is not None:
                write_json(os.path.join(verifier_dir, f"{base}.json"), parsed)
            state["verifier"][case_id] = {
                "n": n, "tx_hash": tx_hash, "exit_code": text["exit_code"],
                "verdict": verdicts.get(text["exit_code"], "UNKNOWN"),
                "report_path": os.path.relpath(os.path.join(verifier_dir, f"{base}.txt"), REPO_ROOT),
                "json_path": os.path.relpath(os.path.join(verifier_dir, f"{base}.json"), REPO_ROOT) if parsed else None,
                "at": now_iso(),
            }
            print(f"  [{n:>2}] {case_id}  -> {verdicts.get(text['exit_code'], text['exit_code'])}")
            save_state()

    save_state()
    print(f"\nwrote {state_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
