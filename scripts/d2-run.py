#!/usr/bin/env python3
"""
d2-run.py -- execute the SOW 6.1 D2 run plan against a live gateway.

Reads scripts/d2-intents.json top to bottom and performs, in order:

  * the 20 POST /v1/intents submissions,
  * the two POST /v1/decisions/:id/resolve calls that make up the scenario-5
    pending-approval trail (one approval, one owner refusal),
  * the two repeat resolve calls that MUST be refused as AlreadyResolved,
  * a final GET /v1/approvals snapshot,
  * a GET /v1/intents/:intent_hash lookup for every submission, which is the
    endpoint 6.1 D2 points a reviewer at to recompute intent_hash.

Nothing here decides anything. The gateway calls the contract and the contract
rules; this script records what was sent and what came back.

Outputs (under --out-dir, default ./evidence):
  d2-responses.ndjson       one record per HTTP call: request, status, body, client timing
  d2-intent-lookups.ndjson  one record per GET /v1/intents/:hash
  d2-index.json             case_id -> intent_hash / decision_id / verdict, for the D3 phase

The gateway's own pino log is the primary transcript and is captured separately
by scripts/d2-d3-run.sh; this file is the client side of the same conversation.

Usage:
  python3 scripts/d2-run.py [--gateway http://127.0.0.1:8080] [--out-dir evidence]
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A submission may collide with another process using the same source account
# (see the D1 evidence run happening in parallel). authorize() is idempotent on
# intent_hash, so retrying is safe: the contract returns the original decision.
RETRYABLE_STATUS = {500, 502, 503, 504}
RETRY_MARKERS = ("txBAD_SEQ", "BAD_SEQ", "chain_unavailable", "TRY_AGAIN_LATER", "timeout")
MAX_ATTEMPTS = 6
RETRY_SLEEP_SECONDS = 5


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def expand(value):
    """Expand {"pattern": s, "length": n} into a string of exactly n characters."""
    if isinstance(value, dict):
        pattern, length = value["pattern"], value["length"]
        return (pattern * (length // len(pattern) + 1))[:length]
    return value


# The two write paths need a bearer key; reads do not. Taken from the environment so a
# key never lands in this file or in the transcript it writes.
WRITE_KEY = os.environ.get("AEGIS_WRITE_KEY", "").strip()


def http_json(method: str, url: str, body=None, timeout: int = 120):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json")
    # Only writes are gated. Sending it on a read would be harmless but would put the
    # key in more places than it needs to be.
    if method.upper() not in ("GET", "HEAD") and WRITE_KEY:
        req.add_header("Authorization", f"Bearer {WRITE_KEY}")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            status = resp.status
            headers = dict(resp.headers.items())
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        status = e.code
        headers = dict(e.headers.items()) if e.headers else {}
    except urllib.error.URLError as e:
        return {
            "http_status": None,
            "transport_error": str(e.reason),
            "client_ms": round((time.perf_counter() - started) * 1000),
            "body": None,
            "headers": {},
        }
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = {"unparsed_body": raw}
    return {"http_status": status, "client_ms": elapsed_ms, "body": parsed, "headers": headers}


def should_retry(result) -> bool:
    if result.get("transport_error"):
        return True
    if result["http_status"] in RETRYABLE_STATUS:
        blob = json.dumps(result.get("body") or {})
        return any(marker in blob for marker in RETRY_MARKERS) or result["http_status"] != 500
    return False


def call_with_retry(method: str, url: str, body=None):
    attempts = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        result = http_json(method, url, body)
        result["attempt"] = attempt
        if not should_retry(result) or attempt == MAX_ATTEMPTS:
            result["attempts"] = attempts + [summarize(result)]
            return result
        attempts.append(summarize(result))
        print(
            f"    retryable failure (attempt {attempt}/{MAX_ATTEMPTS}): "
            f"status={result['http_status']} -- retrying in {RETRY_SLEEP_SECONDS}s",
            file=sys.stderr,
        )
        time.sleep(RETRY_SLEEP_SECONDS)
    raise AssertionError("unreachable")


def summarize(result):
    body = result.get("body") or {}
    return {
        "attempt": result.get("attempt"),
        "http_status": result.get("http_status"),
        "transport_error": result.get("transport_error"),
        "error": body.get("error") if isinstance(body, dict) else None,
        "contract_error": body.get("contract_error") if isinstance(body, dict) else None,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gateway", default=os.environ.get("GATEWAY_URL", "http://127.0.0.1:8080"))
    ap.add_argument("--plan", default=os.path.join(REPO_ROOT, "scripts", "d2-intents.json"))
    ap.add_argument("--out-dir", default=os.path.join(REPO_ROOT, "evidence"))
    args = ap.parse_args()

    with open(args.plan, encoding="utf-8") as fh:
        plan = json.load(fh)

    os.makedirs(args.out_dir, exist_ok=True)
    responses_path = os.path.join(args.out_dir, "d2-responses.ndjson")
    lookups_path = os.path.join(args.out_dir, "d2-intent-lookups.ndjson")
    index_path = os.path.join(args.out_dir, "d2-index.json")

    health = http_json("GET", f"{args.gateway}/health")
    if health["http_status"] != 200:
        print(f"gateway is not healthy at {args.gateway}: {health}", file=sys.stderr)
        return 1
    print(f"gateway ready: {json.dumps(health['body'])}")

    index = {"gateway_health": health["body"], "run_started_at": now_iso(), "cases": {}}
    responses = open(responses_path, "w", encoding="utf-8")
    submitted = {}  # case_id -> the exact intent body that was sent

    def record(rec):
        responses.write(json.dumps(rec, ensure_ascii=False) + "\n")
        responses.flush()

    for step in plan["steps"]:
        case_id = step["case_id"]
        kind = step["kind"]

        if kind == "intent":
            if "replay_of" in step:
                body = dict(submitted[step["replay_of"]])
            else:
                spec = step["intent"]
                body = {
                    "agent_id": plan["agent_id"],
                    "service_id": spec["service_id"],
                    "asset": plan["assets"][spec["asset"]],
                    "amount": spec["amount"],
                    "purpose": expand(spec["purpose"]),
                    "client_ref": expand(spec["client_ref"]),
                }
            submitted[case_id] = body
            print(f"[{step['n']:>2}/20] {case_id}  {body['service_id']}  {body['amount']}  -> POST /v1/intents")
            sent_at = now_iso()
            result = call_with_retry("POST", f"{args.gateway}/v1/intents", body)
            rb = result["body"] if isinstance(result["body"], dict) else {}
            record({
                "case_id": case_id,
                "n": step.get("n"),
                "kind": kind,
                "field_variation": step.get("field_variation"),
                "replay_of": step.get("replay_of"),
                "sent_at": sent_at,
                "request": {"method": "POST", "path": "/v1/intents", "body": body},
                "expect": step.get("expect"),
                "http_status": result["http_status"],
                "client_ms": result["client_ms"],
                "attempts": result.get("attempts"),
                "response": result["body"],
                "location_header": result.get("headers", {}).get("Location"),
            })
            index["cases"][case_id] = {
                "n": step.get("n"),
                "field_variation": step.get("field_variation"),
                "replay_of": step.get("replay_of"),
                "request": body,
                "http_status": result["http_status"],
                "intent_hash": rb.get("intent_hash"),
                "decision_id": rb.get("decision_id"),
                "verdict": rb.get("verdict"),
                "reason_code": rb.get("reason_code"),
                "policy_version": rb.get("policy_version"),
                "amount_stroops": rb.get("amount_stroops"),
                "tx_hash": rb.get("tx_hash"),
                "ledger_seq": rb.get("ledger_seq"),
                "timings_ms": rb.get("timings_ms"),
                "settle": step.get("settle", False),
                "expect": step.get("expect"),
            }
            print(f"        -> {result['http_status']}  {rb.get('verdict')}  {rb.get('reason_code')}  decision {str(rb.get('decision_id'))[:16]}")

        elif kind == "resolve":
            target = index["cases"].get(step["target"], {})
            decision_id = target.get("decision_id")
            if not decision_id:
                print(f"  !! {case_id}: no decision_id recorded for {step['target']}, skipping", file=sys.stderr)
                continue
            body = {"approve": step["approve"], "note": step["note"]}
            label = "REFUSAL EXPECTED" if step.get("refusal") else "resolve"
            print(f"[{label}] {case_id}  decision {decision_id[:16]}  approve={step['approve']}")
            sent_at = now_iso()
            # A refusal is the evidence: never retry it, a 409 is the answer.
            result = (http_json if step.get("refusal") else call_with_retry)(
                "POST", f"{args.gateway}/v1/decisions/{decision_id}/resolve", body
            )
            rb = result["body"] if isinstance(result["body"], dict) else {}
            record({
                "case_id": case_id,
                "kind": kind,
                "refusal": step.get("refusal", False),
                "target_case": step["target"],
                "sent_at": sent_at,
                "request": {"method": "POST", "path": f"/v1/decisions/{decision_id}/resolve", "body": body},
                "expect": step.get("expect"),
                "http_status": result["http_status"],
                "client_ms": result["client_ms"],
                "response": result["body"],
            })
            index["cases"][case_id] = {
                "kind": "resolve",
                "refusal": step.get("refusal", False),
                "target_case": step["target"],
                "decision_id": decision_id,
                "http_status": result["http_status"],
                "verdict": rb.get("verdict"),
                "reason_code": rb.get("reason_code"),
                "original_reason_code": rb.get("original_reason_code"),
                "resolved_policy_version": rb.get("resolved_policy_version"),
                "tx_hash": rb.get("tx_hash"),
                "contract_error": rb.get("contract_error"),
                "error": rb.get("error"),
                "timings_ms": rb.get("timings_ms"),
                "expect": step.get("expect"),
            }
            # The resolve rewrites the target decision's verdict; keep the index honest.
            if not step.get("refusal") and rb.get("verdict"):
                index["cases"][step["target"]]["verdict_after_resolve"] = rb.get("verdict")
                index["cases"][step["target"]]["reason_code_after_resolve"] = rb.get("reason_code")
                index["cases"][step["target"]]["resolve_tx_hash"] = rb.get("tx_hash")
            print(f"        -> {result['http_status']}  {rb.get('verdict') or rb.get('contract_error')}")

        elif kind == "approvals":
            print(f"[queue ] {case_id}  GET /v1/approvals")
            result = http_json("GET", f"{args.gateway}/v1/approvals")
            record({
                "case_id": case_id,
                "kind": kind,
                "sent_at": now_iso(),
                "request": {"method": "GET", "path": "/v1/approvals"},
                "http_status": result["http_status"],
                "client_ms": result["client_ms"],
                "response": result["body"],
            })
            index["approvals_snapshot"] = result["body"]
            pending = (result["body"] or {}).get("pending_count")
            print(f"        -> {result['http_status']}  pending_count={pending}")

    # ---- the recompute endpoint, once per submission ------------------------
    with open(lookups_path, "w", encoding="utf-8") as lookups:
        seen = set()
        for case_id, case in index["cases"].items():
            intent_hash = case.get("intent_hash")
            if not intent_hash or intent_hash in seen:
                continue
            seen.add(intent_hash)
            result = http_json("GET", f"{args.gateway}/v1/intents/{intent_hash}")
            lookups.write(json.dumps({
                "case_id": case_id,
                "intent_hash": intent_hash,
                "http_status": result["http_status"],
                "response": result["body"],
            }, ensure_ascii=False) + "\n")
        print(f"recompute lookups written for {len(seen)} distinct intent hashes")

    responses.close()
    index["run_finished_at"] = now_iso()
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(index, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"\nwrote {responses_path}")
    print(f"wrote {lookups_path}")
    print(f"wrote {index_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
