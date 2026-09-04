/**
 * Serialize work per key.
 *
 * The key is the transaction's SOURCE ACCOUNT. Two concurrent POSTs both read
 * the same sequence number from the RPC, build two envelopes with the same
 * `seqNum`, and the second one comes back `txBAD_SEQ` — a lost decision that
 * looks like a network fault. One chain per source account removes the race
 * without a global lock, so requests signed by different sources still overlap.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // `.then(fn, fn)`: a rejected predecessor must not cancel the queue behind it.
    const result = previous.then(fn, fn);
    // The tail swallows outcomes — it exists to order, not to report.
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      // Drop the entry once this was the last waiter, so the map stays the size
      // of the active source-account set rather than growing with traffic.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  get depth(): number {
    return this.tails.size;
  }
}
