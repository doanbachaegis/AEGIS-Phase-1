/**
 * A per-decision, in-process mutex.
 *
 * Two concurrent `settle()` calls for the same decision would both re-read an
 * unsettled decision, both prepare an envelope, and race on the store. The
 * PRIMARY KEY in the journal and `AlreadySettled` on chain would each stop the
 * second one, but they would stop it *after* it had built and signed a second
 * transaction — and a signed payment envelope that exists but should not is the
 * thing this executor is built to avoid ever creating.
 *
 * Scope, stated plainly: this is a lock inside ONE process. It is not a
 * distributed lock and does not pretend to be. Phase 1 runs a single executor;
 * the guarantees that survive multiple processes are the contract's `settled`
 * flag and the journal's primary key, which is where they belong.
 */
const held = new Map<string, Promise<unknown>>();

export class LockBusyError extends Error {
  constructor(key: string) {
    super(`a settlement for ${key} is already in flight in this process`);
    this.name = "LockBusyError";
  }
}

/** Runs `fn` under the lock for `key`, or throws {@link LockBusyError} at once. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (held.has(key)) throw new LockBusyError(key);
  const running = (async () => fn())();
  held.set(key, running.catch(() => undefined));
  try {
    return await running;
  } finally {
    held.delete(key);
  }
}

/** Test seam. Never called in production paths. */
export const __clearLocks = (): void => held.clear();
