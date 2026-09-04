/**
 * Cross-origin access to this API.
 *
 * **The console no longer needs this.** It is served by this same process, from
 * `apps/console/dist`, at this same origin — one Railway service, one URL — so
 * the calls it makes to `/v1/...` are same-origin and a browser sends no
 * `Origin` header at all. Nothing has to be configured here for the console to
 * work, and `DEPLOY.md` says so where an operator will look.
 *
 * This module survives because "the console" is not the same thing as "a
 * browser". Anything ELSE calling this API from a page — a reviewer's scratch
 * page, a second front end, a notebook — is cross-origin and still needs an
 * allowlist entry. Deleting the plugin would make that a code change instead of
 * a configuration change.
 *
 * **What is actually at stake is smaller than it looks.** The console reads the
 * authoritative evidence — the decision, its verdict and reason, the settlement
 * — straight from Soroban RPC, and Soroban RPC answers with
 * `access-control-allow-origin: *`. This gateway supplies only the
 * NON-authoritative display fields (`purpose`, `client_ref`, the settlement
 * transaction hash), each already tagged "display only" in the UI. So a
 * misconfigured allowlist here degrades a cross-origin caller; it cannot break
 * the evidence. That asymmetry is the §6.3 invariant — "the chain is the
 * evidence, the API is a convenience" — paying rent at deploy time.
 *
 * Consequently this defaults CLOSED. `CORS_ORIGIN` unset means no CORS headers
 * at all, which is now the CORRECT setting for a normal deployment.
 */

/**
 * One entry of `CORS_ORIGIN`, compiled to a predicate.
 *
 * Three forms, and the wildcard form is the reason this is not a plain
 * `Array.includes`:
 *
 * - `*`                             — any origin. Convenient; see the warning below.
 * - `https://tools.example.org`     — that origin and no other.
 * - `https://*.up.railway.app`      — any single label in place of the `*`.
 *
 * The third form exists because a provider that mints a fresh subdomain per
 * environment (Railway's PR environments, a preview host) would otherwise force
 * the allowlist to be rewritten on every deploy — and the usual response to that
 * friction is `*`.
 *
 * The wildcard matches ONE label, never a dot: `https://*.up.railway.app`
 * admits `https://aegis-pr-7.up.railway.app` and rejects
 * `https://evil.com.up.railway.app.attacker.test`. Scheme and port are
 * compared literally in every form.
 */
function compile(pattern: string): (origin: string) => boolean {
  if (pattern === "*") return () => true;

  const star = pattern.indexOf("*");
  if (star === -1) return (origin) => origin === pattern;

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (origin) =>
    origin.length > prefix.length + suffix.length &&
    origin.startsWith(prefix) &&
    origin.endsWith(suffix) &&
    // The single label the `*` stands for. A dot inside it would mean the
    // pattern matched further up the tree than it was written to.
    !origin.slice(prefix.length, origin.length - suffix.length).includes(".");
}

/**
 * Parse `CORS_ORIGIN` into an ordered list of patterns.
 *
 * Comma-separated, whitespace-insensitive, empty entries dropped. An unset or
 * blank value yields an empty list, which callers MUST read as "do not enable
 * CORS" rather than "allow nothing" — the two are indistinguishable to a
 * browser but not to an operator reading the boot log.
 */
export function parseCorsOrigins(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** True when `origin` matches any configured pattern. */
export function originAllowed(patterns: readonly string[], origin: string): boolean {
  return patterns.some((p) => compile(p)(origin));
}

/**
 * `@fastify/cors` options for the configured patterns.
 *
 * `credentials` stays off: the gateway has no cookie or session of any kind, so
 * turning it on would only forbid the `*` pattern while buying nothing. The
 * method list is the API's actual surface — decisions are read and intents are
 * posted; nothing is ever deleted.
 */
export function corsOptions(patterns: readonly string[]): {
  origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => void;
  methods: string[];
  allowedHeaders: string[];
  credentials: false;
  maxAge: number;
} {
  return {
    origin(origin, cb) {
      // A same-origin or non-browser request (curl, the health check, a
      // server-to-server call) sends no `Origin` header. Refusing those would
      // break the Railway health probe, which is not what an allowlist is for.
      if (origin === undefined) return cb(null, true);
      cb(null, originAllowed(patterns, origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
    credentials: false,
    // Cache the preflight for a day; the allowlist changes at deploy time, not
    // per request.
    maxAge: 86_400,
  };
}
