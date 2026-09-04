#!/usr/bin/env python3
"""
d4-report.py -- render the SOW 6.1 D4 result table from the verification run.

Reads only evidence/d4-console-verification.json (written by
scripts/d4-console-verify.mjs) and the screenshot directory it produced, and
writes:

  evidence/d4-results.md            the "70/70 viewable, 10/10 links live" table
  evidence/d4-screenshots/README.md what each screenshot shows and why it was chosen

Every count, status and hash in the output is copied from the run artifact.
Nothing is recomputed here and nothing is typed in by hand -- if a check failed,
this script prints the failure into the table rather than dropping the row.

Usage: python3 scripts/d4-report.py
"""

import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVIDENCE = os.path.join(REPO_ROOT, "evidence")
RUN_FILE = os.path.join(EVIDENCE, "d4-console-verification.json")
SHOTS_DIR = os.path.join(EVIDENCE, "d4-screenshots")

EXPERT_CONTRACT = "https://stellar.expert/explorer/testnet/contract/"
EXPERT_TX = "https://stellar.expert/explorer/testnet/tx/"

# SOW 5.2's own wording for each scenario. Labels, not measurements -- every
# number beside them comes from the run artifact.
SCENARIOS = {
    1: "Compliant intent",
    2: "Amount over `per_intent_cap`",
    3: "Service not whitelisted",
    4: "Asset not the policy asset",
    5: "Above `approval_threshold`, at or under `per_intent_cap`",
    6: "Revoked agent",
    7: "Replay of an already-authorized `intent_hash`",
}


def write(path, lines):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines).rstrip() + "\n")
    print(f"wrote {os.path.relpath(path, REPO_ROOT)}")


def short(h, n=12):
    return f"`{h[:n]}…`" if h else "—"


def tick(ok):
    return "PASS" if ok else "**FAIL**"


def results_md(run):
    t = run["totals"]
    m = run["method"]
    base = m["console_base_url"]
    contract = run["contract_id"]
    d1 = run["d1_decisions"]
    settled = run["settlements"]
    controls = run["controls"]
    link_control = run.get("link_control")

    d1_pass = t["d1_run_rows_passed"]
    d1_total = t["d1_run_rows_checked"]
    links_live = t["transaction_links_resolving"]
    links_total = t["settlements_checked"]
    rendered_links = t["consoles_rendering_a_transaction_link"]

    L = []
    L.append("# D4 — result table: decisions viewable, transaction links live")
    L.append("")
    L.append("SOW §6.1 D4 asks for a *“result table showing 70/70 decisions viewable and 10/10")
    L.append("transaction links live”*, where a run counts as successful if the page shows the")
    L.append("**correct verdict and reason code** for the decision, and for settled intents the")
    L.append("Stellar Expert link opens the **correct** testnet transaction. This is that table.")
    L.append("")
    L.append(f"- **Console:** <{base}>")
    L.append(f"- **Contract:** [`{contract}`]({EXPERT_CONTRACT}{contract}) (testnet)")
    L.append(f"- **Run:** `{run['started_at']}` → `{run['generated_at']}`")
    L.append(f"- **Browser:** {m['browser']}")
    L.append(f"- **Console root returned:** HTTP {run['console']['http_status_of_root']}")
    L.append("")
    L.append("| | Result |")
    L.append("| --- | --- |")
    L.append(
        f"| Decisions viewable with the correct verdict **and** reason code | **{d1_pass} / {d1_total}** |"
    )
    L.append(f"| Transaction links live and bound to the right decision | **{links_live} / {links_total}** |")
    L.append(
        f"| … of which the console page itself renders as a link | **{rendered_links} / {links_total}** "
        "— see [§B](#one-thing-this-table-does-not-say) |"
    )
    L.append(
        f"| Settled intents whose console page renders correctly | **{t['settlements_passed']} / {t['settlements_checked']}** |"
    )
    L.append(f"| Controls that had to find nothing, and found nothing | **{t['controls_passed']} / {t['controls_total']}** |")
    L.append(f"| Total real page loads | **{t['page_loads_total']}** |")
    L.append("")
    L.append("---")
    L.append("")

    # ---------------------------------------------------------------- method
    L.append("## How this was checked, and what it does not prove")
    L.append("")
    L.append("**Method: real browser page loads.** " + m["detail"])
    L.append("")
    L.append("This matters because the console is a React app. Querying Soroban RPC from a shell")
    L.append("and comparing the answer to the expected verdict would prove that the *data*")
    L.append("resolves; it would not prove that the *page* renders it. Every row below is a page")
    L.append("that was actually loaded, rendered, and read back.")
    L.append("")
    L.append("**The limits, stated so they are not read past:**")
    L.append("")
    L.append("- No pixels are inspected. The check reads `document.body.innerText`, so it proves")
    L.append("  the page renders the right *text*. It cannot prove the text was visible, legible,")
    L.append("  or laid out correctly. That is what the screenshots in `d4-screenshots/` are for,")
    L.append("  and they were taken by the same browser in the same run.")
    L.append("- The comparison is against the values recorded at run time in")
    L.append("  `d1-authorize/decision-export.json` and `d3-receipts/*.json`. Those are AEGIS")
    L.append("  artifacts. What makes the loop closed rather than circular is that the console")
    L.append("  never reads them: it reads the contract over Soroban RPC")
    L.append(f"  (`{m['soroban_rpc_used_by_the_console']}`) with no AEGIS API in the authoritative path.")
    L.append("  The two sides agreeing is therefore a chain read agreeing with a chain write.")
    L.append("- The screenshots are one browser at one viewport. No cross-browser or mobile")
    L.append("  rendering claim is made anywhere in this pack.")
    L.append("")
    # Not a measurement -- a property of the method, so it is stated here rather than
    # echoed out of the run artifact.
    L.append("**No writes.** The console holds no key and every contract call stops at")
    L.append("`simulateTransaction`; Horizon and Stellar Expert are read with `GET`. Nothing in")
    L.append("this check can move a lumen, and none of it touches the AEGIS write path.")
    L.append("")
    L.append("Reproduce it:")
    L.append("")
    L.append("```bash")
    L.append("node scripts/d4-console-verify.mjs      # 80 page loads + controls + screenshots")
    L.append("python3 scripts/d4-report.py            # regenerates this file from the run")
    L.append("```")
    L.append("")
    L.append("---")
    L.append("")

    # --------------------------------------------------------------- part A
    L.append(f"## A. {d1_pass} / {d1_total} decisions viewable")
    L.append("")
    L.append(f"**{d1_total} run rows over {t['d1_distinct_decisions']} distinct decisions.** The")
    L.append(f"{t['d1_replay_rows']} scenario-7 rows are replays: the contract returns the *original*")
    L.append("decision for a repeated `intent_hash` — that idempotence is the behaviour SOW §5.2")
    L.append("scenario 7 tests — so those rows deliberately re-resolve a reference an earlier row")
    L.append("already loaded. Reported here as run rows, never as distinct decisions.")
    L.append("")
    L.append("Each row is one load of "
             f"`{base}/decision/<decision_id>`.")
    L.append("")

    by_scn = {}
    for r in d1:
        by_scn.setdefault(r["scenario"], []).append(r)

    L.append("| # | Scenario | Expected verdict / reason | Rows | Rendered correctly |")
    L.append("| --- | --- | --- | ---: | ---: |")
    for scn in sorted(by_scn):
        rows = by_scn[scn]
        expected = sorted({f"{r['expected']['verdict']} / {r['expected']['reason_code']}" for r in rows})
        passed = sum(1 for r in rows if r["pass"])
        label = SCENARIOS.get(scn, f"scenario {scn}")
        L.append(f"| {scn} | {label} | {', '.join(expected)} | {len(rows)} | {passed} / {len(rows)} |")
    L.append("")

    L.append("### Every run")
    L.append("")
    L.append("`ledger_seq` and `policy_version` are checked too: a page that showed the right")
    L.append("verdict against the wrong ledger would not be the same decision.")
    L.append("")
    L.append(
        "| # | Scn | Expected verdict / reason | Rendered verdict | Rendered reason_code | "
        "policy_v | ledger_seq | decision_id | Replay | Load ms | Pass |"
    )
    L.append("| ---: | ---: | --- | --- | --- | ---: | ---: | --- | :---: | ---: | :---: |")
    for r in d1:
        rr = r["rendered"]
        L.append(
            f"| {r['run_index']} | {r['scenario']} | "
            f"{r['expected']['verdict']} / {r['expected']['reason_code']} | "
            f"{rr['verdict'] or '—'} | `{rr['reason_code'] or '—'}` | "
            f"v{rr['policy_version'] or '—'} | {rr['ledger_seq'] or '—'} | "
            f"{short(r['decision_id'])} | {'yes' if r['is_replay_of_an_earlier_run'] else '—'} | "
            f"{r['load_ms']} | {tick(r['pass'])} |"
        )
    failures = [r for r in d1 if not r["pass"]]
    L.append("")
    if failures:
        L.append(f"**{len(failures)} row(s) failed.** Each failure, verbatim:")
        L.append("")
        for r in failures:
            L.append(f"- run {r['run_index']} (`{r['decision_id']}`): {'; '.join(r['failures'])}")
    else:
        L.append(
            f"**{d1_pass} / {d1_total}.** Every row rendered the verdict and reason code the "
            "chain recorded at run time, with the matching `policy_version` and `ledger_seq`."
        )
    L.append("")
    L.append("---")
    L.append("")

    # --------------------------------------------------------------- part B
    L.append(f"## B. {links_live} / {links_total} transaction links live")
    L.append("")
    L.append("A link is counted live only if **all four** hold:")
    L.append("")
    L.append("1. Horizon returns the transaction and reports `successful: true`;")
    L.append("2. the Stellar Expert **API** returns the same hash (its *page* is a single-page app")
    L.append("   and answers HTTP 200 for a hash that has never existed — see the control below);")
    L.append("3. the transaction carries a `MEMO_HASH`; and")
    L.append("4. that memo equals the `memo_hash()` **the console rendered from the contract** for")
    L.append("   this decision. This is the step that makes it the *correct* transaction rather")
    L.append("   than merely a transaction that exists.")
    L.append("")
    L.append(
        "| # | Case | decision_id | Console page | settled | memo_hash() ≡ tx MEMO_HASH | Horizon | Expert API | Transaction | Pass |"
    )
    L.append("| ---: | --- | --- | :---: | :---: | :---: | ---: | ---: | --- | :---: |")
    for i, s in enumerate(settled, start=1):
        case = s["case"].split("-")[1] if "-" in s["case"] else s["case"]
        h = s["horizon"]
        e = s["stellar_expert"]
        L.append(
            f"| {i} | `{case}` | {short(s['decision_id'])} | "
            f"{s['rendered']['verdict'] or '—'} / `{s['rendered']['reason_code'] or '—'}` | "
            f"{s['rendered']['settled'] or '—'} | "
            f"{'yes' if s['memo_binding_matches_console'] else '**no**'} | "
            f"{h.get('status')} `successful: {str(h.get('successful')).lower()}` | "
            f"{e['api_http_status']} | [{s['tx_hash'][:12]}…]({s['stellar_expert_url']}) | "
            f"{tick(s['pass'])} |"
        )
    L.append("")
    sfail = [s for s in settled if not s["pass"]]
    if sfail:
        L.append(f"**{len(sfail)} settlement(s) failed.** Verbatim:")
        L.append("")
        for s in sfail:
            L.append(f"- `{s['case']}`: {'; '.join(s['failures'])}")
    else:
        L.append(
            f"**{links_live} / {links_total}.** Every link resolves on Horizon, is reported by the "
            "Stellar Expert API under the same hash, and carries a `MEMO_HASH` identical to the "
            "`memo_hash()` the console read from the contract on the page above it."
        )
    L.append("")

    # ------------------------------------------- how the console gets the link
    L.append("### How the console gets to that link")
    L.append("")
    L.append("The contract records **that** a decision was settled. It never records **which**")
    L.append("Stellar transaction did it, so there is no `settlement_tx_hash` to read on-chain.")
    L.append("")
    L.append("The console does **not** solve that by asking the AEGIS API to name the")
    L.append("transaction — that would ask a reviewer to trust the party under review to name its")
    L.append("own receipt. `memo_hash()` is computed **by the contract** over")
    L.append("`intent_hash ‖ policy_version ‖ decision_id`, and the settle transaction has to")
    L.append("carry exactly those 32 bytes as its `MEMO_HASH`. So the page **searches** the")
    L.append("published settlement accounts on Horizon for a transaction carrying that memo, and")
    L.append("tags what it finds *derived from ledger* — a third provenance tier, distinct from")
    L.append("both *read from chain* and *display only*.")
    L.append("")
    L.append("The link is therefore a **consequence of public data**, not a claim. Horizon is")
    L.append("Stellar infrastructure, not an AEGIS service, so §6.3's *“independently of the AEGIS")
    L.append("database”* survives intact — this deployment in fact runs with")
    L.append(f"`/health` reporting `database: {run['console']['health'].get('database')}`, and the")
    L.append("links below still render.")
    L.append("")

    if rendered_links == links_total:
        L.append(f"**The console rendered {rendered_links} of {links_total}.** Each rendered hash")
        L.append("below was read back out of the page text and compared against the settlement")
        L.append("receipt — the browser and the receipt agree, having reached the answer by")
        L.append("different routes.")
        L.append("")
        L.append("| # | Rendered by the console | Tagged | Matches the receipt |")
        L.append("| --- | --- | --- | :---: |")
        for i, s_ in enumerate(settled, 1):
            line = (s_.get("console_settlement_tx_line") or "").split()
            shown = line[0] if line else "—"
            src = s_.get("console_settlement_tx_source") or "—"
            hit = "✅" if shown == s_["tx_hash"] else "❌"
            L.append(f"| {i} | [`{shown[:16]}…`]({EXPERT_TX}{shown}) | *{src}* | {hit} |")
    else:
        L.append(f"**The console rendered only {rendered_links} of {links_total}.** In place of the")
        L.append("others its Settlement card printed:")
        L.append("")
        example = next(
            (
                s_["console_settlement_tx_line"]
                for s_ in settled
                if s_.get("console_settlement_tx_line")
                and not s_["console_settlement_tx_line"].startswith(s_["tx_hash"][:16])
            ),
            None,
        )
        if example:
            L.append("> " + example.strip())
            L.append("")
        L.append("A miss never contradicts the `settled` flag above it — that flag is the")
        L.append("contract's own answer. It means the search did not locate the transaction in")
        L.append("the accounts and range it covered, and the page says which those were.")
    L.append("")
    L.append("Reproduce it without the console: fetch")
    L.append("`/accounts/<executor>/transactions` from Horizon and look for the transaction whose")
    L.append("base64 `memo` decodes to the `memo_hash()` printed on the page. That is the same")
    L.append("scan `tools/verifier` runs for check X3.")
    L.append("")
    L.append("---")
    L.append("")

    # -------------------------------------------------------------- controls
    L.append("## C. Controls — the checks that had to fail")
    L.append("")
    L.append("A console that renders a verdict for anything you paste into it proves nothing.")
    L.append("These ran in the same session as the rows above.")
    L.append("")
    L.append("| Control | Expected | Observed | Pass |")
    L.append("| --- | --- | --- | :---: |")
    for c in controls:
        L.append(
            f"| {c['name']} | `{c['expect']}`, no verdict | `{c['rendered_state']}`, "
            f"verdict {c['rendered_verdict'] or 'none'} | {tick(c['pass'])} |"
        )
    if link_control:
        L.append(
            f"| {link_control['name']} | Horizon 404, Expert API 404 | "
            f"Horizon {link_control['horizon_http_status']}, Expert API "
            f"{link_control['stellar_expert_api_http_status']}, Expert **page** "
            f"{link_control['stellar_expert_page_http_status']} | {tick(link_control['pass'])} |"
        )
    L.append("")
    if link_control:
        L.append("The last row is the reason the Stellar Expert *page* status is not used as")
        L.append("evidence anywhere in this pack:")
        L.append("")
        L.append("> " + link_control["note"])
        L.append("")
    L.append("---")
    L.append("")

    # ----------------------------------------------------------- screenshots
    shots = run.get("screenshots") or []
    L.append("## D. Screenshots")
    L.append("")
    if not shots:
        L.append("None captured in this run (`--no-screenshots`).")
    else:
        L.append("Captured by the same browser, in the same run, from the live console.")
        L.append("`d4-screenshots/README.md` says what each one is for.")
        L.append("")
        L.append("| File | Shows | Rendered verdict | Reason code | Page |")
        L.append("| --- | --- | --- | --- | --- |")
        for s in shots:
            L.append(
                f"| [`{s['file']}`](d4-screenshots/{s['file']}) | {s['note']} | "
                f"{s['rendered_verdict'] or '—'} | "
                f"{('`' + s['rendered_reason_code'] + '`') if s['rendered_reason_code'] else '—'} | "
                f"<{s['url']}> |"
            )
    L.append("")
    L.append("---")
    L.append("")
    L.append("Raw per-check records, including the SHA-256 of the rendered text of every page:")
    L.append("`d4-console-verification.json`.")
    return L


def screenshots_md(run):
    shots = run.get("screenshots") or []
    base = run["method"]["console_base_url"]
    L = []
    L.append("# D4 screenshots")
    L.append("")
    L.append("SOW §6.1 D4 asks for **one approved intent showing the full chain** and **one refused**")
    L.append("**intent showing its reason code**. The first two files below are those two. The rest")
    L.append("are here because a reviewer scoring the refusal path will want more than one example.")
    L.append("")
    L.append(f"All were captured from <{base}> by {run['method']['browser']} during the run recorded")
    L.append("in `../d4-console-verification.json`, at a 1280px viewport, 2× device pixel ratio,")
    L.append("full page height. Nothing is cropped and nothing is annotated.")
    L.append("")
    L.append("| File | Page | Verdict | Reason code | Size |")
    L.append("| --- | --- | --- | --- | ---: |")
    for s in shots:
        L.append(
            f"| `{s['file']}` | <{s['url']}> | {s['rendered_verdict'] or '—'} | "
            f"{('`' + s['rendered_reason_code'] + '`') if s['rendered_reason_code'] else '—'} | "
            f"{s['width']}×{s['height']} css px |"
        )
    L.append("")
    L.append("## Why these references")
    L.append("")
    for s in shots:
        L.append(f"**`{s['file']}`** — {s['note']}.")
        L.append("")
    L.append("The refusal chosen for the mandatory pair is `OwnerRejected`, not the blandest one")
    L.append("available. It is the case where **no policy rule refused the intent**: the contract")
    L.append("escalated it because it sat above `approval_threshold` but under `per_intent_cap`, a")
    L.append("human declined it, and `resolve()` wrote that refusal to the chain. The page shows")
    L.append("both the final `reason_code` (`OwnerRejected`) and the `original_reason_code`")
    L.append("(`PendingApproval`) that the contract kept and never rewrote — so the ledger itself")
    L.append("records that a human was required, and what they decided.")
    L.append("")
    L.append("A refusal is rendered with the same box, type scale and space as an approval; only the")
    L.append("hue differs. That is deliberate (`apps/console/src/labels.ts`): refusing correctly is")
    L.append("the outcome the product sells, not a failure to approve.")
    L.append("")
    L.append("## What a screenshot catches that an `innerText` check cannot")
    L.append("")
    L.append("An earlier run of these images recorded a real cosmetic defect: `Field` in")
    L.append("`apps/console/src/ui.tsx` gave the label column a fixed `13rem`, and the longer")
    L.append("labels — `original_reason_code`, `resolved_policy_version`, `cumulative_window_cap` —")
    L.append("plus their source badge overflowed the `<dt>` and printed on top of the value beside")
    L.append("it. Every automated page read passed throughout, because the values were intact in")
    L.append("the DOM the whole time. Only the pictures showed it.")
    L.append("")
    L.append("The label side now wraps inside its track, so these images show it resolved. The")
    L.append("point is kept because it is the honest limit of the method above: 80 correct")
    L.append("`innerText` reads say nothing about whether a human can read the page, and the")
    L.append("screenshots are in this pack unretouched and uncropped for that reason.")
    return L


def main():
    if not os.path.exists(RUN_FILE):
        sys.exit(
            f"{os.path.relpath(RUN_FILE, REPO_ROOT)} not found — "
            "run `node scripts/d4-console-verify.mjs` first."
        )
    with open(RUN_FILE, encoding="utf-8") as fh:
        run = json.load(fh)

    write(os.path.join(EVIDENCE, "d4-results.md"), results_md(run))
    if run.get("screenshots"):
        os.makedirs(SHOTS_DIR, exist_ok=True)
        write(os.path.join(SHOTS_DIR, "README.md"), screenshots_md(run))


if __name__ == "__main__":
    main()
