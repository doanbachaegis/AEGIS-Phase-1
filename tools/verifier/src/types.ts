/** Result model shared by every check. */

/**
 * Where the evidence for a check came from.
 *
 * This label is printed on every line the tool emits, and it is the point of the
 * whole exercise: a reviewer reading the output can see, check by check, that no
 * fact came from the AEGIS API. `derived` means computed locally from values
 * already carried by one of the other sources.
 */
export type CheckSource = "receipt" | "horizon" | "soroban-rpc" | "derived" | "registry";

/**
 * `unavailable` is a first-class outcome, not a soft pass. "Could not check" and
 * "checked and fine" are different statements and the exit code keeps them apart
 * (3 vs 0) — a network blip must never be reported as a verified settlement.
 */
export type CheckStatus = "pass" | "fail" | "unavailable";

export interface Check {
  /** Stable machine-readable id, e.g. `commitment.memo_matches`. */
  id: string;
  source: CheckSource;
  /** One line, present tense, stating the property being asserted. */
  title: string;
  status: CheckStatus;
  /** Why it passed, failed, or could not be run. */
  detail: string;
  expected?: string;
  actual?: string;
}

export const pass = (id: string, source: CheckSource, title: string, detail: string): Check => ({
  id,
  source,
  title,
  status: "pass",
  detail,
});

export const fail = (
  id: string,
  source: CheckSource,
  title: string,
  detail: string,
  expected?: string,
  actual?: string,
): Check => {
  const c: Check = { id, source, title, status: "fail", detail };
  if (expected !== undefined) c.expected = expected;
  if (actual !== undefined) c.actual = actual;
  return c;
};

export const unavailable = (
  id: string,
  source: CheckSource,
  title: string,
  detail: string,
): Check => ({ id, source, title, status: "unavailable", detail });

/** Process exit codes. The gap between 1 and 3 is the whole point (see {@link CheckStatus}). */
export const EXIT = {
  VERIFIED: 0,
  FAILED: 1,
  USAGE: 2,
  UNAVAILABLE: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * A detected mismatch outranks an unfinished check: if anything actually
 * contradicts the receipt, the answer is FAILED even when other checks could not
 * be run — the finding stands on its own.
 */
export function exitCodeFor(checks: readonly Check[]): ExitCode {
  if (checks.some((c) => c.status === "fail")) return EXIT.FAILED;
  if (checks.some((c) => c.status === "unavailable")) return EXIT.UNAVAILABLE;
  return EXIT.VERIFIED;
}

export const verdictFor = (code: ExitCode): string =>
  code === EXIT.VERIFIED ? "VERIFIED" : code === EXIT.FAILED ? "FAILED" : "UNAVAILABLE";
