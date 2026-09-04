import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettlementError } from "../src/errors.js";
import { MemorySettlementStore, SqliteSettlementStore } from "../src/store/index.js";
import type { SettlementRecord, SettlementStore } from "../src/store/index.js";

const row = (decisionId = "a".repeat(64)): Omit<SettlementRecord, "createdAt" | "updatedAt" | "status"> => ({
  decisionId,
  txHash: "b".repeat(64),
  envelopeXdr: "AAAAAgAA",
  source: "GBZZPQQHAAABQEHRYIF7GQ4ZL2ULZVRHJNZDOR5SS3XP23DIPX5JWNY3",
  sequence: "101",
  maxTime: 1_800_000_180,
});

/**
 * Both implementations are held to the SAME contract. That is the point of the
 * interface: if the durable store and the test store could diverge, every test
 * written against the memory store would be evidence about nothing.
 */
const backends: Array<[string, () => { store: SettlementStore; cleanup: () => void }]> = [
  [
    "SqliteSettlementStore",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "aegis-store-"));
      const store = new SqliteSettlementStore(join(dir, "settlements.db"));
      return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
    },
  ],
  ["MemorySettlementStore", () => ({ store: new MemorySettlementStore(), cleanup: () => {} })],
];

for (const [name, make] of backends) {
  describe(name, () => {
    let store: SettlementStore;
    let cleanup: () => void;

    beforeEach(() => {
      ({ store, cleanup } = make());
    });
    afterEach(async () => {
      await store.close();
      cleanup();
    });

    it("commits a PREPARED record and reads it back", async () => {
      const stored = await store.putPrepared(row());
      expect(stored.status).toBe("PREPARED");
      expect(await store.get(row().decisionId)).toMatchObject({ txHash: "b".repeat(64), sequence: "101" });
    });

    it("refuses a second record for the same decision", async () => {
      // The primary key is what stops a crashed run from minting a second
      // transaction for the same decision.
      await store.putPrepared(row());
      await expect(store.putPrepared(row())).rejects.toThrowError(SettlementError);
    });

    it("advances through the state machine and records the ledger", async () => {
      await store.putPrepared(row());
      await store.advance(row().decisionId, "MARKED");
      const settled = await store.advance(row().decisionId, "SETTLED", { ledger: 5_000_001 });
      expect(settled.status).toBe("SETTLED");
      expect(settled.ledger).toBe(5_000_001);
    });

    it("lists only non-terminal records as pending", async () => {
      await store.putPrepared(row("a".repeat(64)));
      await store.putPrepared(row("c".repeat(64)));
      await store.advance("c".repeat(64), "SETTLED", { ledger: 1 });
      const pending = await store.pending();
      expect(pending.map((r) => r.decisionId)).toEqual(["a".repeat(64)]);
    });

    it("replaces a PREPARED envelope, but refuses once it has been MARKED", async () => {
      await store.putPrepared(row());
      const replaced = await store.replacePrepared({ ...row(), txHash: "d".repeat(64), sequence: "102" });
      expect(replaced.txHash).toBe("d".repeat(64));

      // Once mark_settled has been written, the stored bytes are the only
      // transaction that may ever settle this decision. Rebuilding is the
      // double-payment bug, so the store refuses it even if a caller asks.
      await store.advance(row().decisionId, "MARKED");
      await expect(
        store.replacePrepared({ ...row(), txHash: "e".repeat(64) }),
      ).rejects.toThrowError(/PREPARED/);
    });

    it("refuses to advance an unknown decision", async () => {
      await expect(store.advance("f".repeat(64), "MARKED")).rejects.toThrowError(SettlementError);
    });
  });
}

describe("SqliteSettlementStore durability", () => {
  it("survives the process closing the database and reopening it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aegis-store-"));
    const path = join(dir, "settlements.db");
    try {
      const first = new SqliteSettlementStore(path);
      await first.putPrepared(row());
      await first.advance(row().decisionId, "MARKED");
      await first.close();

      // This is the property the whole ordering argument rests on: the record
      // committed before mark_settled is still there after the crash.
      const second = new SqliteSettlementStore(path);
      expect(await second.get(row().decisionId)).toMatchObject({ status: "MARKED", txHash: "b".repeat(64) });
      await second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
