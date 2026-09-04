import { describe, expect, it } from "vitest";
import { KeyedMutex } from "../src/mutex.js";

/**
 * The failure this class exists to prevent is `txBAD_SEQ`: two concurrent POSTs
 * read the same sequence number, build two envelopes with it, and the second
 * submission is rejected by the network. That is a lost decision wearing the
 * costume of a network fault.
 */
describe("KeyedMutex", () => {
  it("runs same-key work strictly one at a time", async () => {
    const mutex = new KeyedMutex();
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];

    const task = (n: number) =>
      mutex.run("source-account", async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        order.push(n);
        inFlight -= 1;
        return n;
      });

    expect(await Promise.all([task(1), task(2), task(3)])).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it("lets different keys overlap", async () => {
    const mutex = new KeyedMutex();
    let inFlight = 0;
    let maxInFlight = 0;

    const task = (key: string) =>
      mutex.run(key, async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
      });

    await Promise.all([task("operator"), task("owner")]);
    expect(maxInFlight).toBe(2);
  });

  it("does not let a rejected predecessor stall the queue behind it", async () => {
    const mutex = new KeyedMutex();
    const boom = mutex.run("k", async () => {
      throw new Error("simulation failed");
    });
    const after = mutex.run("k", async () => "still ran");

    await expect(boom).rejects.toThrow("simulation failed");
    await expect(after).resolves.toBe("still ran");
  });

  it("drops finished keys so the map tracks active sources, not traffic", async () => {
    const mutex = new KeyedMutex();
    await mutex.run("a", async () => undefined);
    await mutex.run("b", async () => undefined);
    // one microtask turn for the cleanup continuation
    await new Promise((r) => setTimeout(r, 0));
    expect(mutex.depth).toBe(0);
  });
});
