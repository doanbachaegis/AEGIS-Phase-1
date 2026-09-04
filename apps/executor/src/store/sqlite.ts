/**
 * The durable {@link SettlementStore}, on `node:sqlite`.
 *
 * ## Why SQLite, and why the one built into Node
 *
 * The requirement this store exists to satisfy is exactly one sentence: *the
 * record must be on stable storage before `mark_settled` is called.* Everything
 * else follows from picking the cheapest thing that can honestly promise that.
 *
 * - **Postgres** would satisfy it, and `DATABASE_URL` points at one — but
 *   nothing is listening on `localhost:5432`. An executor that cannot start
 *   without a database that is not running is an executor that cannot settle.
 * - **A JSON file** cannot promise it without hand-rolling
 *   write-temp / `fsync` / `rename` / `fsync`-the-directory, and a hand-rolled
 *   commit protocol in the one place where a lost write means a double payment
 *   is a poor trade for saving a dependency.
 * - **`node:sqlite`** is in the Node 24 runtime the workspace already requires
 *   (`engines.node >= 24`), so it adds no dependency, no daemon and no install
 *   step, and it gives a real transactional commit. With `journal_mode = WAL`
 *   and `synchronous = FULL` every commit is fsynced before it returns, which
 *   is precisely the promise above.
 *
 * The cost is that it is single-writer and node-local: two executor processes
 * on two machines would not see each other's journal. Phase 1 runs one
 * executor, and the double-settle guard that actually matters is on chain, not
 * here — the journal prevents a *rebuild*, the contract prevents a *double
 * settle*. When Phase 2 wants many executors, `SettlementStore` is the seam:
 * `PostgresStore` replaces this file and nothing above it changes.
 *
 * `node:sqlite` is flagged experimental and prints an ExperimentalWarning when
 * it is loaded. That is a stability-of-API caveat about the module, not a
 * durability one about the journal — but a settlement transcript is evidence a
 * reviewer reads, and an unexplained warning in the middle of one invites
 * exactly the wrong conclusion. It is therefore loaded through `createRequire`
 * at construction time rather than with a static `import`: ES module LINKING
 * resolves every static import before any module body runs, so a static import
 * would emit the warning before `src/quiet.ts` could install its filter. The
 * type is still imported statically, so nothing is lost at the type level.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { SettlementError } from "../errors.js";
import {
  type SettlementPatch,
  type SettlementRecord,
  type SettlementStatus,
  type SettlementStore,
} from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settlements (
  decision_id  TEXT PRIMARY KEY NOT NULL,
  tx_hash      TEXT NOT NULL,
  envelope_xdr TEXT NOT NULL,
  source       TEXT NOT NULL,
  sequence     TEXT NOT NULL,
  max_time     INTEGER NOT NULL,
  status       TEXT NOT NULL,
  ledger       INTEGER,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS settlements_status ON settlements (status, created_at);
`;

interface Row {
  decision_id: string;
  tx_hash: string;
  envelope_xdr: string;
  source: string;
  sequence: string;
  max_time: number;
  status: string;
  ledger: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const toRecord = (r: Row): SettlementRecord => {
  const rec: SettlementRecord = {
    decisionId: r.decision_id,
    txHash: r.tx_hash,
    envelopeXdr: r.envelope_xdr,
    source: r.source,
    sequence: r.sequence,
    maxTime: Number(r.max_time),
    status: r.status as SettlementStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.ledger !== null) rec.ledger = Number(r.ledger);
  if (r.note !== null) rec.note = r.note;
  return rec;
};

const loadSqlite = (): typeof import("node:sqlite") =>
  createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export class SqliteSettlementStore implements SettlementStore {
  readonly #db: DatabaseSyncType;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = loadSqlite();
    this.#db = new DatabaseSync(path);
    // WAL keeps readers off the writer's back; synchronous = FULL is the half
    // that matters here — it makes COMMIT wait for the fsync, so a record that
    // this process has committed survives an immediate power loss.
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = FULL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(SCHEMA);
  }

  async get(decisionId: string): Promise<SettlementRecord | undefined> {
    const row = this.#db
      .prepare("SELECT * FROM settlements WHERE decision_id = ?")
      .get(decisionId) as Row | undefined;
    return row === undefined ? undefined : toRecord(row);
  }

  async putPrepared(
    record: Omit<SettlementRecord, "createdAt" | "updatedAt" | "status">,
  ): Promise<SettlementRecord> {
    const now = new Date().toISOString();
    try {
      this.#db
        .prepare(
          `INSERT INTO settlements
             (decision_id, tx_hash, envelope_xdr, source, sequence, max_time, status, ledger, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'PREPARED', NULL, ?, ?, ?)`,
        )
        .run(
          record.decisionId,
          record.txHash,
          record.envelopeXdr,
          record.source,
          record.sequence,
          record.maxTime,
          record.note ?? null,
          now,
          now,
        );
    } catch (cause) {
      // The PRIMARY KEY is the guard: a decision gets exactly one prepared
      // envelope, so a crashed run comes back through recover() and can never
      // mint a second transaction for the same decision.
      throw new SettlementError(
        "STORE_CONFLICT",
        `a settlement record already exists for decision ${record.decisionId}`,
        { expected: "no prior record", actual: "a record exists", cause },
      );
    }
    const stored = await this.get(record.decisionId);
    if (stored === undefined) {
      throw new SettlementError("STORE_CONFLICT", "the prepared record vanished immediately after commit");
    }
    return stored;
  }

  async advance(
    decisionId: string,
    status: SettlementStatus,
    patch: SettlementPatch = {},
  ): Promise<SettlementRecord> {
    const now = new Date().toISOString();
    const changes = this.#db
      .prepare(
        `UPDATE settlements
            SET status = ?, ledger = COALESCE(?, ledger), note = COALESCE(?, note), updated_at = ?
          WHERE decision_id = ?`,
      )
      .run(status, patch.ledger ?? null, patch.note ?? null, now, decisionId);
    if (changes.changes === 0) {
      throw new SettlementError("STORE_CONFLICT", `no settlement record for decision ${decisionId}`);
    }
    const stored = await this.get(decisionId);
    if (stored === undefined) {
      throw new SettlementError("STORE_CONFLICT", `no settlement record for decision ${decisionId}`);
    }
    return stored;
  }

  async replacePrepared(
    record: Omit<SettlementRecord, "createdAt" | "updatedAt" | "status">,
  ): Promise<SettlementRecord> {
    const now = new Date().toISOString();
    // Guarded in SQL as well as by the caller: the WHERE clause makes it
    // impossible to overwrite an envelope that has already been marked or
    // submitted, even if a future caller forgets the precondition.
    const changes = this.#db
      .prepare(
        `UPDATE settlements
            SET tx_hash = ?, envelope_xdr = ?, source = ?, sequence = ?, max_time = ?,
                note = ?, updated_at = ?
          WHERE decision_id = ? AND status = 'PREPARED'`,
      )
      .run(
        record.txHash,
        record.envelopeXdr,
        record.source,
        record.sequence,
        record.maxTime,
        record.note ?? null,
        now,
        record.decisionId,
      );
    if (changes.changes === 0) {
      throw new SettlementError(
        "STORE_CONFLICT",
        `decision ${record.decisionId} has no PREPARED record to replace`,
        { expected: "status PREPARED", actual: "missing or already advanced" },
      );
    }
    const stored = await this.get(record.decisionId);
    if (stored === undefined) {
      throw new SettlementError("STORE_CONFLICT", `no settlement record for decision ${record.decisionId}`);
    }
    return stored;
  }

  async pending(): Promise<SettlementRecord[]> {
    const rows = this.#db
      .prepare(
        "SELECT * FROM settlements WHERE status NOT IN ('SETTLED', 'ABANDONED') ORDER BY created_at ASC",
      )
      .all() as unknown as Row[];
    return rows.map(toRecord);
  }

  async close(): Promise<void> {
    this.#db.close();
  }
}
