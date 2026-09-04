#!/usr/bin/env node
/**
 * d4-console-verify.mjs -- the SOW 6.1 D4 result table, produced by driving a real
 * browser against the deployed console.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * The console is a React app: the verdict a reviewer sees is produced by JavaScript
 * that runs in the page and reads the contract over Soroban RPC. Asking the RPC the
 * same question from a shell would prove the DATA resolves; it would not prove the
 * PAGE renders it. So this script loads every reference in a headless Chrome, waits
 * for React to finish, and reads the verdict and reason code back out of the rendered
 * DOM (`document.body.innerText`) -- the same characters a human would read.
 *
 * It does not look at pixels. A rule that hid the banner with `visibility: hidden`
 * would still pass, and no automated check here replaces a person opening the two
 * screenshots this script captures. Everything else -- the app booting, the RPC
 * round-trip, the enum-to-name translation, the routing of a shared deep link -- is
 * exercised for real, once per reference.
 *
 * THE 80 LOOKUPS
 *
 *   70  D1 authorize runs, by decision_id, at /decision/<id>.
 *       70 RUN ROWS over 60 DISTINCT decisions: the ten scenario-7 runs are replays
 *       and the contract returns the original decision for them by design, so ten of
 *       these loads deliberately re-resolve a reference already loaded. Reported as
 *       70 rows / 60 distinct, never as 70 distinct.
 *   10  D3 settlements, by intent_hash, at /intent/<hash>. Each page load is paired
 *       with a live Horizon read of the settlement transaction and a fetch of the
 *       Stellar Expert URL, so "the link is live" is checked against the transaction
 *       the memo commits to rather than against the shape of the URL.
 *
 * Plus two controls that must FAIL to find anything: a well-formed reference that was
 * never issued, and a malformed one. A console that rendered a verdict for those would
 * be worthless, and "80/80 found" means nothing without them.
 *
 * NO WRITES. The console holds no key and only simulates; Horizon and Stellar Expert
 * are read with GET. Nothing in this file can move a lumen.
 *
 * Usage:
 *   node scripts/d4-console-verify.mjs                 # all 80 + controls + screenshots
 *   node scripts/d4-console-verify.mjs --limit 5       # first 5 of each set, for a smoke run
 *   node scripts/d4-console-verify.mjs --no-screenshots
 *   node scripts/d4-console-verify.mjs --base http://localhost:8080
 *
 * Requires a Chrome or Chromium binary. Found automatically on macOS and Linux, or
 * named with --chrome / CHROME_BIN. No npm dependency: the browser is driven over the
 * DevTools Protocol with the WebSocket built into Node 22+.
 *
 * Writes:
 *   evidence/d4-console-verification.json   every check, with what was rendered
 *   evidence/d4-screenshots/*.png           the approved and refused pages
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EVIDENCE = join(REPO_ROOT, "evidence");

const DEFAULT_BASE = "https://aegis-production-2216.up.railway.app";
const HORIZON = "https://horizon-testnet.stellar.org";
const EXPERT_TX = "https://stellar.expert/explorer/testnet/tx/";
const EXPERT_API_TX = "https://api.stellar.expert/explorer/testnet/tx/";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
];

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const opts = {
    base: process.env.CONSOLE_BASE_URL ?? DEFAULT_BASE,
    chrome: process.env.CHROME_BIN ?? null,
    limit: null,
    screenshots: true,
    headful: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") opts.base = argv[++i];
    else if (a === "--chrome") opts.chrome = argv[++i];
    else if (a === "--limit") opts.limit = Number(argv[++i]);
    else if (a === "--no-screenshots") opts.screenshots = false;
    else if (a === "--headful") opts.headful = true;
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  opts.base = opts.base.replace(/\/+$/, "");
  return opts;
}

function findChrome(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`--chrome ${explicit} does not exist`);
    return explicit;
  }
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  // Playwright keeps its browsers here; use one if the machine already has it.
  const pw = join(process.env.HOME ?? "", "Library/Caches/ms-playwright");
  const pwLinux = join(process.env.HOME ?? "", ".cache/ms-playwright");
  for (const root of [pw, pwLinux]) {
    if (!existsSync(root)) continue;
    const builds = readdirSync(root)
      .filter((d) => d.startsWith("chromium-") || d.startsWith("chromium_headless_shell-"))
      .sort();
    for (const b of builds.reverse()) {
      for (const rel of [
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-mac/headless_shell",
        "chrome-linux/chrome",
        "chrome-linux/headless_shell",
      ]) {
        const p = join(root, b, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  throw new Error(
    "No Chrome or Chromium found. Pass --chrome /path/to/binary or set CHROME_BIN.",
  );
}

// --------------------------------------------------- DevTools Protocol client

/**
 * Minimal CDP client. A browser automation library would be a heavier dependency
 * than the 120 lines it would replace, and this script has to be runnable by a
 * reviewer with nothing but Node and a browser already on the machine.
 */
class Browser {
  #proc;
  #ws;
  #dir;
  #nextId = 0;
  #pending = new Map();

  static async launch(binary, { headful = false } = {}) {
    const b = new Browser();
    b.#dir = mkdtempSync(join(tmpdir(), "aegis-d4-"));
    const args = [
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--window-size=1280,1600",
      "--remote-debugging-port=0",
      `--user-data-dir=${b.#dir}`,
      "about:blank",
    ];
    if (!headful) args.unshift("--headless=new");

    b.#proc = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    b.#proc.stderr.on("data", () => {});

    const portFile = join(b.#dir, "DevToolsActivePort");
    let port = null;
    for (let i = 0; i < 150 && port === null; i++) {
      await sleep(100);
      if (!existsSync(portFile)) continue;
      const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
      if (first) port = first;
    }
    if (port === null) throw new Error("Chrome did not report a DevTools port within 15s");

    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    b.#ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      b.#ws.onopen = res;
      b.#ws.onerror = () => rej(new Error("could not attach to the browser"));
    });
    b.#ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const waiter = msg.id === undefined ? undefined : b.#pending.get(msg.id);
      if (waiter === undefined) return;
      b.#pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(msg.error)}`));
      else waiter.resolve(msg.result);
    };
    b.userAgent = version["User-Agent"];
    b.version = version.Browser;
    return b;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#nextId;
    const payload = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`${method} timed out after 60s`));
      }, 60_000);
    });
  }

  async newPage() {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, sessionId);
    await this.send("Runtime.enable", {}, sessionId);
    await this.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 1600, deviceScaleFactor: 2, mobile: false },
      sessionId,
    );
    return new Page(this, sessionId, targetId);
  }

  async close() {
    try {
      this.#ws.close();
    } catch {
      /* already gone */
    }
    this.#proc.kill();
    try {
      rmSync(this.#dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

class Page {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
  }

  async text() {
    const r = await this.send("Runtime.evaluate", {
      expression: "document.body ? document.body.innerText : ''",
      returnByValue: true,
    });
    return r.result?.value ?? "";
  }

  /** Polls the rendered text until `done(text)` is true. Returns the final text. */
  async waitForText(done, { timeoutMs = 45_000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = "";
    for (;;) {
      last = await this.text();
      if (done(last)) return { text: last, timedOut: false };
      if (Date.now() > deadline) return { text: last, timedOut: true };
      await sleep(intervalMs);
    }
  }

  async screenshot(path) {
    const metrics = await this.send("Page.getLayoutMetrics", {});
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const height = Math.min(Math.ceil(size.height), 16000);
    const shot = await this.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.ceil(size.width), height, scale: 1 },
    });
    writeFileSync(path, Buffer.from(shot.data, "base64"));
    return { path, width: Math.ceil(size.width), height };
  }

  async close() {
    await this.browser.send("Target.closeTarget", { targetId: this.targetId });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- page scraping

/**
 * The console prints `verdict = X · reason_code = Y` under the banner precisely so a
 * machine and a human read the same claim. Nothing here infers a verdict from a colour.
 */
const RENDERED = {
  verdictLine: /verdict = (\w+) · reason_code = (\w+)/,
  decisionId: /decision_id\nread from chain\n([0-9a-f]{64})/,
  intentHash: /intent_hash\nread from chain\n([0-9a-f]{64})/,
  settled: /\bsettled\nread from chain\n(true|false)/,
  memoHash: /memo_hash\(\)\nread from chain\n([0-9a-f]{64})/,
  ledgerSeq: /ledger_seq\nread from chain\n(\d+)/,
  policyVersion: /\npolicy_version\nread from chain\nv(\d+)/,
  // The tag is part of the match on purpose. The console DERIVES this link by searching
  // the ledger for the contract's memo, so "derived from ledger" is the expected label
  // and a regression to "display only" would mean the page went back to repeating what
  // the AEGIS database told it. Both are accepted here so the mismatch is REPORTED
  // (`console_settlement_tx_source`) rather than silently read as "no link at all".
  settlementTx: /settlement transaction\n(derived from ledger|display only)\n([^\n]+)/,
  notFound: /No decision is stored under this reference/,
  archived: /This decision has been archived/,
  badRef: /That is not a valid reference/,
  transport: /Could not reach the chain/,
};

/**
 * The settlement card's in-flight text. Not a terminal state: the console is still
 * scanning Horizon for the transaction carrying this decision's memo.
 */
const SEARCH_IN_FLIGHT = /searching the public ledger/;

/** True once the page has reached a terminal state -- a verdict, or a stated absence. */
function settledPage(text) {
  return (
    RENDERED.verdictLine.test(text) ||
    RENDERED.notFound.test(text) ||
    RENDERED.archived.test(text) ||
    RENDERED.badRef.test(text) ||
    RENDERED.transport.test(text)
  );
}

function scrape(text) {
  const m = RENDERED.verdictLine.exec(text);
  // `group` names which capture to take, for the patterns that capture more than the value.
  const grab = (re, group = 1) => {
    const r = re.exec(text);
    return r === null ? null : (r[group] ?? null);
  };
  return {
    verdict: m === null ? null : m[1],
    reason_code: m === null ? null : m[2],
    decision_id: grab(RENDERED.decisionId),
    intent_hash: grab(RENDERED.intentHash),
    settled: grab(RENDERED.settled),
    memo_hash: grab(RENDERED.memoHash),
    ledger_seq: grab(RENDERED.ledgerSeq),
    policy_version: grab(RENDERED.policyVersion),
    settlement_tx_line: grab(RENDERED.settlementTx, 2),
    settlement_tx_source: grab(RENDERED.settlementTx, 1),
    state: RENDERED.verdictLine.test(text)
      ? "decision"
      : RENDERED.notFound.test(text)
        ? "not-found"
        : RENDERED.archived.test(text)
          ? "archived"
          : RENDERED.badRef.test(text)
            ? "invalid-reference"
            : RENDERED.transport.test(text)
              ? "transport-error"
              : "unresolved",
  };
}

/**
 * One page load, with retries. Only a transport failure or a timeout is retried --
 * "no decision is stored here" is an ANSWER and retrying it would be dishonest padding.
 *
 * `until` is the predicate for "this page has finished". It defaults to a rendered
 * verdict, which is what D1 asks about. A settlement page needs MORE than that: the
 * console looks up the transaction by scanning the ledger for the contract's memo, and
 * that search resolves after the verdict does. Scraping on the verdict alone captures a
 * spinner and scores a working link as absent -- which is exactly what it did until this
 * argument existed.
 */
async function loadReference(browser, url, { attempts = 3, until = settledPage } = {}) {
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const page = await browser.newPage();
    const startedAt = Date.now();
    try {
      await page.goto(url);
      const { text, timedOut } = await page.waitForText(until);
      const scraped = scrape(text);
      last = {
        url,
        attempt,
        load_ms: Date.now() - startedAt,
        timed_out: timedOut,
        rendered: scraped,
        rendered_text_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      };
      if (!timedOut && scraped.state !== "transport-error") return last;
    } finally {
      await page.close().catch(() => {});
    }
    if (attempt < attempts) await sleep(1500 * attempt);
  }
  return last;
}

// ------------------------------------------------------------------ chain IO

async function getJson(url, { attempts = 3 } = {}) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      const body = res.status === 204 ? null : await res.text();
      let parsed = null;
      try {
        parsed = body === null || body === "" ? null : JSON.parse(body);
      } catch {
        parsed = null;
      }
      return { status: res.status, json: parsed, raw: body };
    } catch (err) {
      lastErr = err;
      await sleep(1000 * i);
    }
  }
  return { status: 0, json: null, raw: null, error: String(lastErr) };
}

async function headStatus(url, { attempts = 3 } = {}) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      // Body is drained so the socket can be reused; only the status is used.
      await res.arrayBuffer().catch(() => {});
      return res.status;
    } catch {
      await sleep(1000 * i);
    }
  }
  return 0;
}

// -------------------------------------------------------------- the checks

function loadExpectations() {
  const d1 = JSON.parse(
    readFileSync(join(EVIDENCE, "d1-authorize", "decision-export.json"), "utf8"),
  );
  const receiptDir = join(EVIDENCE, "d3-receipts");
  const receipts = readdirSync(receiptDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(receiptDir, f), "utf8")) }));
  return { d1, receipts };
}

async function checkD1(browser, base, decisions) {
  const results = [];
  const seen = new Set();
  for (const d of decisions) {
    const url = `${base}/decision/${d.decision_id}`;
    // Wait for the LEDGER SEARCH as well as the verdict -- see `loadReference`.
    const load = await loadReference(browser, url, {
      until: (t) => settledPage(t) && !SEARCH_IN_FLIGHT.test(t),
    });
    const r = load.rendered;
    const failures = [];
    if (r.state !== "decision") failures.push(`page state is ${r.state}, not a decision`);
    if (r.verdict !== d.verdict_name) failures.push(`verdict rendered ${r.verdict}, expected ${d.verdict_name}`);
    if (r.reason_code !== d.reason_name) failures.push(`reason_code rendered ${r.reason_code}, expected ${d.reason_name}`);
    if (r.decision_id !== d.decision_id) failures.push(`decision_id rendered ${r.decision_id}`);
    if (r.intent_hash !== d.intent_hash) failures.push(`intent_hash rendered ${r.intent_hash}`);
    if (r.policy_version !== String(d.policy_version)) failures.push(`policy_version rendered v${r.policy_version}, expected v${d.policy_version}`);
    if (r.ledger_seq !== String(d.ledger_seq)) failures.push(`ledger_seq rendered ${r.ledger_seq}, expected ${d.ledger_seq}`);

    const replay = seen.has(d.decision_id);
    seen.add(d.decision_id);
    results.push({
      run_index: d.run_index,
      scenario: d.scenario,
      decision_id: d.decision_id,
      intent_hash: d.intent_hash,
      url,
      is_replay_of_an_earlier_run: replay,
      expected: {
        verdict: d.verdict_name,
        reason_code: d.reason_name,
        policy_version: d.policy_version,
        ledger_seq: d.ledger_seq,
      },
      rendered: r,
      rendered_text_sha256: load.rendered_text_sha256,
      load_ms: load.load_ms,
      attempts: load.attempt,
      pass: failures.length === 0,
      failures,
    });
    process.stdout.write(
      `  run ${String(d.run_index).padStart(2)}/70  s${d.scenario}  ` +
        `${(r.verdict ?? "-").padEnd(16)} ${(r.reason_code ?? "-").padEnd(17)} ` +
        `${failures.length === 0 ? "ok" : "FAIL " + failures.join("; ")}\n`,
    );
  }
  return results;
}

async function checkSettlements(browser, base, receipts) {
  const results = [];
  for (const rec of receipts) {
    const intentHash = rec.chain.intent_hash;
    const txHash = rec.settlement.tx_hash;
    const url = `${base}/intent/${intentHash}`;

    // Wait for the LEDGER SEARCH as well as the verdict -- see `loadReference`.
    const load = await loadReference(browser, url, {
      until: (t) => settledPage(t) && !SEARCH_IN_FLIGHT.test(t),
    });
    const r = load.rendered;

    const horizon = await getJson(`${HORIZON}/transactions/${txHash}`);
    const tx = horizon.json;
    const memoHex =
      tx && typeof tx.memo === "string" && tx.memo_type === "hash"
        ? Buffer.from(tx.memo, "base64").toString("hex")
        : null;

    const expertApi = await getJson(`${EXPERT_API_TX}${txHash}`);
    const expertUrl = `${EXPERT_TX}${txHash}`;
    const expertStatus = await headStatus(expertUrl);

    const failures = [];
    if (r.state !== "decision") failures.push(`page state is ${r.state}, not a decision`);
    if (r.decision_id !== rec.chain.decision_id) failures.push(`decision_id rendered ${r.decision_id}`);
    if (r.settled !== "true") failures.push(`page renders settled = ${r.settled}`);
    if (r.memo_hash !== rec.settlement.memo_hash) failures.push(`memo_hash() rendered ${r.memo_hash}, receipt says ${rec.settlement.memo_hash}`);
    if (horizon.status !== 200) failures.push(`Horizon returned ${horizon.status} for the transaction`);
    if (tx && tx.successful !== true) failures.push(`Horizon reports successful = ${tx?.successful}`);
    if (tx && tx.hash !== txHash) failures.push(`Horizon returned a different hash: ${tx.hash}`);
    if (memoHex === null) failures.push(`transaction memo is not a MEMO_HASH (memo_type = ${tx?.memo_type})`);
    // This is the check that makes the link the CORRECT transaction rather than merely
    // a transaction: the memo the ledger carries must equal the memo_hash() the contract
    // computed for this decision, as rendered on the page above.
    if (memoHex !== null && r.memo_hash !== null && memoHex !== r.memo_hash) {
      failures.push(`transaction MEMO_HASH ${memoHex} != memo_hash() ${r.memo_hash} rendered by the console`);
    }
    if (expertStatus !== 200) failures.push(`Stellar Expert page returned HTTP ${expertStatus}`);
    if (expertApi.status !== 200) failures.push(`Stellar Expert API returned ${expertApi.status}`);
    if (expertApi.json && expertApi.json.hash !== txHash) failures.push(`Stellar Expert API returned hash ${expertApi.json.hash}`);

    results.push({
      case: rec.file.replace(/\.json$/, ""),
      intent_hash: intentHash,
      decision_id: rec.chain.decision_id,
      url,
      tx_hash: txHash,
      stellar_expert_url: expertUrl,
      rendered: r,
      rendered_text_sha256: load.rendered_text_sha256,
      load_ms: load.load_ms,
      horizon: tx
        ? {
            status: horizon.status,
            successful: tx.successful,
            ledger: tx.ledger,
            created_at: tx.created_at,
            source_account: tx.source_account,
            memo_type: tx.memo_type,
            memo_hash_hex: memoHex,
          }
        : { status: horizon.status },
      stellar_expert: {
        page_http_status: expertStatus,
        api_http_status: expertApi.status,
        api_hash: expertApi.json?.hash ?? null,
        api_ledger: expertApi.json?.ledger ?? null,
      },
      memo_binding_matches_console: memoHex !== null && memoHex === r.memo_hash,
      console_renders_a_transaction_link:
        r.settlement_tx_line !== null && /^[0-9a-f]{64}/.test(r.settlement_tx_line),
      console_settlement_tx_line: r.settlement_tx_line,
      console_settlement_tx_source: r.settlement_tx_source,
      pass: failures.length === 0,
      failures,
    });
    process.stdout.write(
      `  ${rec.file.slice(0, 7)}  ${(r.verdict ?? "-").padEnd(10)} settled=${r.settled} ` +
        `memo ${memoHex === r.memo_hash ? "matches" : "MISMATCH"} ` +
        `expert ${expertStatus}/${expertApi.status}  ` +
        `${failures.length === 0 ? "ok" : "FAIL " + failures.join("; ")}\n`,
    );
  }
  return results;
}

/**
 * The transaction-link equivalent of the page controls below.
 *
 * `https://stellar.expert/explorer/testnet/tx/<anything>` is a single-page app: it
 * answers HTTP 200 for a hash that has never existed, so that status is NOT evidence
 * that a link is live and this script must not be read as claiming it is. What does
 * carry the claim is Horizon and the Stellar Expert API, both of which 404 on a hash
 * that is not on the ledger. This control records that difference in the artifact
 * instead of asking the reader to take it on trust.
 */
async function checkLinkControls() {
  const bogus = "ab".repeat(32);
  const horizon = await getJson(`${HORIZON}/transactions/${bogus}`);
  const api = await getJson(`${EXPERT_API_TX}${bogus}`);
  const page = await headStatus(`${EXPERT_TX}${bogus}`);
  const control = {
    name: "a transaction hash that is not on the ledger",
    tx_hash: bogus,
    horizon_http_status: horizon.status,
    stellar_expert_api_http_status: api.status,
    stellar_expert_page_http_status: page,
    note:
      "The Stellar Expert PAGE answers 200 for a non-existent hash because it is a " +
      "single-page app that resolves the hash client-side. Horizon and the Stellar " +
      "Expert API answer 404. Only the latter two, plus the MEMO_HASH match, support " +
      "the claim that a link opens the correct transaction.",
    pass: horizon.status === 404 && api.status === 404,
  };
  process.stdout.write(
    `  control: bogus tx -> horizon ${horizon.status}, expert api ${api.status}, ` +
      `expert page ${page} ${control.pass ? "ok" : "FAIL"}\n`,
  );
  return control;
}

/**
 * A verdict is only evidence if the page can also say "no". These two references must
 * NOT produce one.
 */
async function checkControls(browser, base) {
  const cases = [
    {
      name: "well-formed reference that was never issued",
      ref: "0".repeat(63) + "1",
      expect: "not-found",
    },
    {
      name: "malformed reference (48 hex characters, not 64)",
      ref: "deadbeef".repeat(6),
      expect: "invalid-reference",
    },
  ];
  const results = [];
  for (const c of cases) {
    const url = `${base}/intent/${c.ref}`;
    const load = await loadReference(browser, url, { attempts: 2 });
    const state = load.rendered.state;
    const pass = state === c.expect && load.rendered.verdict === null;
    results.push({ ...c, url, rendered_state: state, rendered_verdict: load.rendered.verdict, pass });
    process.stdout.write(`  control: ${c.name} -> ${state} ${pass ? "ok" : "FAIL"}\n`);
  }
  return results;
}

// ------------------------------------------------------------- screenshots

/**
 * Chosen, not sampled.
 *
 * SOW 6.1 D4 asks for one approved intent "showing the full chain" and one refused
 * intent "showing its reason code". The approved one is the escalation that went all
 * the way -- policy escalated it, a human resolved it on chain, and it settled -- so a
 * single page carries every link in the chain. The refusal is the owner declining by
 * hand: no policy rule refused it, which is the case where the reason code is doing
 * work no threshold could do. Two further refusals are captured because they are the
 * ones a sceptical reviewer will want: revocation outranking a cap breach, and a plain
 * per-intent cap.
 */
const SCREENSHOTS = [
  {
    file: "approved-full-chain.png",
    path: (base) => `${base}/intent/9a9ebd5efcd76521bd822db194815ea1d892a2860c953aa010ba34c9aab9cf2a`,
    note: "D2 case s10 — approved after the owner's on-chain resolve(), then settled",
  },
  {
    file: "refused-owner-rejected.png",
    path: (base) => `${base}/decision/03defcb77539553dac3b4d96ed2b6e6c31aa57b999da307dc2b67c62d125cee7`,
    note: "D2 case s15 — escalated by policy, then declined by hand: OwnerRejected",
  },
  {
    // D1 run 58, chosen from the ten scenario-6 runs because it is the one that breaks
    // every other rule at the same time: 9999.9999999 EURC to an unlisted service. The
    // contract still answers AgentRevoked, which is the evidence that revocation is
    // checked before anything else rather than merely alongside it.
    file: "refused-agent-revoked.png",
    path: (base) => `${base}/decision/2950696a1a3ab5005a1e378d45ed1e64e4f773152208450d78724fa6547a72f8`,
    note:
      "D1 run 58 — a revoked agent asking for 9999.9999999 EURC from an unlisted service: " +
      "every other rule is broken too, and the contract still answers AgentRevoked",
  },
  {
    file: "refused-cap-exceeded.png",
    path: (base) => `${base}/decision/c942b69f7af06b0172aa39f81e3e42412a9b83c4b8fbfdebe0b9411d314b9db2`,
    note: "D2 case s11 — above the per-intent cap",
  },
  {
    file: "home.png",
    path: (base) => `${base}/`,
    note: "the lookup form a reviewer lands on",
  },
];

async function captureScreenshots(browser, base, outDir) {
  mkdirSync(outDir, { recursive: true });
  const shots = [];
  for (const s of SCREENSHOTS) {
    const url = s.path(base);
    const page = await browser.newPage();
    try {
      await page.goto(url);
      // Waits past the verdict for the supplementary card to stop saying "Loading…",
      // so the screenshot shows the deployment as it really is rather than mid-fetch.
      await page.waitForText(
        (t) =>
          (settledPage(t) || /Look up a reference/i.test(t)) && !/\nLoading…/.test(t),
        { timeoutMs: 30_000 },
      );
      await sleep(600);
      const shot = await page.screenshot(join(outDir, s.file));
      const text = await page.text();
      const r = scrape(text);
      shots.push({
        file: s.file,
        url,
        note: s.note,
        width: shot.width,
        height: shot.height,
        rendered_verdict: r.verdict,
        rendered_reason_code: r.reason_code,
      });
      process.stdout.write(`  captured ${s.file}  ${r.verdict ?? "(no verdict)"} ${r.reason_code ?? ""}\n`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  return shots;
}

// ------------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const chrome = findChrome(opts.chrome);
  const { d1, receipts } = loadExpectations();

  let decisions = d1.decisions;
  let settlements = receipts;
  if (opts.limit !== null) {
    decisions = decisions.slice(0, opts.limit);
    settlements = settlements.slice(0, opts.limit);
  }

  console.log(`AEGIS D4 console verification`);
  console.log(`  console  ${opts.base}`);
  console.log(`  chrome   ${chrome}`);
  console.log(`  checks   ${decisions.length} D1 decisions + ${settlements.length} settlements\n`);

  const startedAt = new Date().toISOString();
  const browser = await Browser.launch(chrome, { headful: opts.headful });
  console.log(`  browser  ${browser.version}\n`);

  let health = null;
  let consoleHttp = null;
  try {
    health = (await getJson(`${opts.base}/health`)).json;
    consoleHttp = await headStatus(`${opts.base}/`);

    console.log("D1 -- 70 authorize decisions, one real page load each");
    const d1Results = await checkD1(browser, opts.base, decisions);

    console.log("\nD3 -- 10 settlements: page load + Horizon + Stellar Expert");
    const settleResults = await checkSettlements(browser, opts.base, settlements);

    console.log("\nControls -- these must NOT render a verdict, and must NOT resolve");
    const controls = await checkControls(browser, opts.base);
    const linkControl = await checkLinkControls();

    let shots = [];
    if (opts.screenshots) {
      console.log("\nScreenshots");
      shots = await captureScreenshots(browser, opts.base, join(EVIDENCE, "d4-screenshots"));
    }

    const distinctD1 = new Set(d1Results.map((r) => r.decision_id)).size;
    const report = {
      schema: "aegis-d4-console-verification/1",
      generated_at: new Date().toISOString(),
      started_at: startedAt,
      method: {
        kind: "real browser page loads",
        detail:
          "Every reference below was loaded in a headless Chrome over the DevTools " +
          "Protocol. The verdict and reason code recorded are the ones read back out of " +
          "the rendered DOM (document.body.innerText) after React finished, not values " +
          "fetched from RPC by this script. No pixels are inspected: this proves the page " +
          "renders the right text, not that the text is visible or legibly styled.",
        browser: browser.version,
        console_base_url: opts.base,
        soroban_rpc_used_by_the_console: "https://soroban-testnet.stellar.org",
        horizon: HORIZON,
        writes_performed:
          "None. The console holds no key and every contract call stops at simulateTransaction; " +
          "Horizon and Stellar Expert are read with GET.",
      },
      console: {
        http_status_of_root: consoleHttp,
        health,
      },
      contract_id: d1.contract_id,
      totals: {
        d1_run_rows_checked: d1Results.length,
        d1_run_rows_passed: d1Results.filter((r) => r.pass).length,
        d1_distinct_decisions: distinctD1,
        d1_replay_rows: d1Results.filter((r) => r.is_replay_of_an_earlier_run).length,
        settlements_checked: settleResults.length,
        settlements_passed: settleResults.filter((r) => r.pass).length,
        transaction_links_resolving: settleResults.filter(
          (r) =>
            r.horizon.status === 200 &&
            r.horizon.successful === true &&
            r.stellar_expert.page_http_status === 200 &&
            r.memo_binding_matches_console,
        ).length,
        consoles_rendering_a_transaction_link: settleResults.filter(
          (r) => r.console_renders_a_transaction_link,
        ).length,
        controls_passed: controls.filter((c) => c.pass).length + (linkControl.pass ? 1 : 0),
        controls_total: controls.length + 1,
        page_loads_total: d1Results.length + settleResults.length + controls.length,
      },
      d1_decisions: d1Results,
      settlements: settleResults,
      controls,
      link_control: linkControl,
      screenshots: shots,
    };

    const out = join(EVIDENCE, "d4-console-verification.json");
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

    const t = report.totals;
    console.log(`\n  D1 decisions            ${t.d1_run_rows_passed}/${t.d1_run_rows_checked} run rows (${t.d1_distinct_decisions} distinct, ${t.d1_replay_rows} replays)`);
    console.log(`  settlement pages        ${t.settlements_passed}/${t.settlements_checked}`);
    console.log(`  transaction links live  ${t.transaction_links_resolving}/${t.settlements_checked}`);
    console.log(`  console-rendered links  ${t.consoles_rendering_a_transaction_link}/${t.settlements_checked}`);
    console.log(`  controls                ${t.controls_passed}/${t.controls_total}`);
    console.log(`\n  wrote ${out}`);

    const failed =
      t.d1_run_rows_passed !== t.d1_run_rows_checked ||
      t.settlements_passed !== t.settlements_checked ||
      t.controls_passed !== t.controls_total;
    process.exitCode = failed ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
