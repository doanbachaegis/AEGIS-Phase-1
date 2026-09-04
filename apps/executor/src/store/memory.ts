/**
 * In-memory {@link SettlementStore} — for tests only.
 *
 * Exported rather than hidden in the test tree because it is also the executable
 * proof that `SettlementStore` really is the seam it claims to be: if a swap to
 * a different backend needed anything beyond this interface, this file would not
 * compile.
 *
 * It is NOT durable, so it must never back a real settlement: the ordering
 * argument requires the prepared record to survive a crash.
 */
import { SettlementError } from "../errors.js";
import type {
  SettlementPatch,
  SettlementRecord,
  SettlementStatus,
  SettlementStore,
} from "./types.js";

export class MemorySettlementStore implements SettlementStore {
  readonly #rows = new Map<string, SettlementRecord>();

  async get(decisionId: string): Promise<SettlementRecord | undefined> {
    const row = this.#rows.get(decisionId);
    return row === undefined ? undefined : { ...row };
  }

  async putPrepared(
    record: Omit<SettlementRecord, "createdAt" | "updatedAt" | "status">,
  ): Promise<SettlementRecord> {
    if (this.#rows.has(record.decisionId)) {
      throw new SettlementError(
        "STORE_CONFLICT",
        `a settlement record already exists for decision ${record.decisionId}`,
      );
    }
    const now = new Date().toISOString();
    const stored: SettlementRecord = { ...record, status: "PREPARED", createdAt: now, updatedAt: now };
    this.#rows.set(record.decisionId, stored);
    return { ...stored };
  }

  async advance(
    decisionId: string,
    status: SettlementStatus,
    patch: SettlementPatch = {},
  ): Promise<SettlementRecord> {
    const row = this.#rows.get(decisionId);
    if (row === undefined) {
      throw new SettlementError("STORE_CONFLICT", `no settlement record for decision ${decisionId}`);
    }
    const next: SettlementRecord = { ...row, status, updatedAt: new Date().toISOString() };
    if (patch.ledger !== undefined) next.ledger = patch.ledger;
    if (patch.note !== undefined) next.note = patch.note;
    this.#rows.set(decisionId, next);
    return { ...next };
  }

  async replacePrepared(
    record: Omit<SettlementRecord, "createdAt" | "updatedAt" | "status">,
  ): Promise<SettlementRecord> {
    const row = this.#rows.get(record.decisionId);
    if (row === undefined || row.status !== "PREPARED") {
      throw new SettlementError(
        "STORE_CONFLICT",
        `decision ${record.decisionId} has no PREPARED record to replace`,
      );
    }
    const next: SettlementRecord = {
      ...row,
      ...record,
      status: "PREPARED",
      updatedAt: new Date().toISOString(),
    };
    this.#rows.set(record.decisionId, next);
    return { ...next };
  }

  async pending(): Promise<SettlementRecord[]> {
    return [...this.#rows.values()]
      .filter((r) => r.status !== "SETTLED" && r.status !== "ABANDONED")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ ...r }));
  }

  async close(): Promise<void> {}
}
