/**
 * Who may WRITE through this gateway.
 *
 * README, Phase 1 boundaries: *"The console is publicly readable; intent submission is
 * not."* Reads are public on purpose — §6.3 turns on a stranger being able to check a
 * decision — but the two write paths are not, and until this module existed the deployed
 * gateway accepted both from anyone who knew the URL.
 *
 * WHY THE CONTRACT GATE IS NOT ENOUGH
 *
 * `resolve()` is owner-only on chain via `require_owner`, which stops a leaked OPERATOR
 * key from standing in for the owner. It does not stop an anonymous HTTP caller: this
 * process holds OWNER_SECRET and signs as the owner for whoever reaches the endpoint. The
 * contract gate defends the key hierarchy; this defends the door. They are different
 * threats and the first does not imply the second.
 *
 * SCOPED BY METHOD, NOT BY ROUTE
 *
 * The guard covers every non-read method under the API prefixes rather than a list of
 * paths, so a write route added later is protected by default instead of by memory. That
 * is the same reasoning as the `onRoute` guard in ./staticConsole.ts: make the unsafe
 * thing impossible to reach by forgetting, not merely documented.
 *
 * FAIL CLOSED
 *
 * An unset key DISABLES writes rather than opening them. A misconfigured deploy then
 * refuses to accept intents — loudly, with the variable named in the response — instead
 * of quietly serving the whole internet, which is exactly the failure this module exists
 * to remove. `/health` reports which of the two states the process is in.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { API_PREFIXES, isApiPath } from "./staticConsole.js";

/**
 * Anything below this is a password, not a key. Refusing at BOOT rather than at request
 * time means a weak value cannot sit unnoticed in a running deployment.
 */
export const MIN_WRITE_KEY_LENGTH = 24;

/** Methods that only read. OPTIONS is here so a CORS preflight is never challenged. */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when this request would change state through the API and must present a key. */
export function isGuardedWrite(
  method: string,
  url: string,
  prefixes: readonly string[] = API_PREFIXES,
): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  // A query string or fragment must not smuggle a path past the prefix test.
  const path = url.split(/[?#]/, 1)[0] ?? url;
  return isApiPath(path, prefixes);
}

/** The presented key, from `Authorization: Bearer <key>`. Null when absent or malformed. */
export function bearerToken(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, and the lengths themselves are a
 * side channel, so both sides are hashed to a fixed width first — comparing digests
 * leaks nothing about the key's length or content.
 */
export function keyMatches(presented: string, expected: string): boolean {
  const digest = (v: string): Buffer => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

export type WriteAuthOutcome = "allowed" | "not-a-write" | "writes-disabled" | "unauthorized";

/** Pure decision, so the policy is testable without a server. */
export function classify(
  method: string,
  url: string,
  authorization: string | undefined,
  writeKey: string | undefined,
): WriteAuthOutcome {
  if (!isGuardedWrite(method, url)) return "not-a-write";
  if (writeKey === undefined || writeKey === "") return "writes-disabled";
  const presented = bearerToken(authorization);
  if (presented === null) return "unauthorized";
  return keyMatches(presented, writeKey) ? "allowed" : "unauthorized";
}

/**
 * Install the guard. Call BEFORE the routes it protects — an `onRequest` hook runs for
 * every request regardless of registration order, but keeping the call site next to
 * `registerConsole` keeps the two guards readable together.
 */
export function registerWriteAuth(app: FastifyInstance, writeKey: string | undefined): void {
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const outcome = classify(req.method, req.url, req.headers.authorization, writeKey);
    if (outcome === "not-a-write" || outcome === "allowed") return;

    if (outcome === "writes-disabled") {
      req.log.warn(
        { path: req.url, method: req.method },
        "write refused: AEGIS_WRITE_KEY is not set, so this gateway accepts no writes",
      );
      return reply.code(503).send({
        error: "writes_disabled",
        detail:
          "This gateway has no AEGIS_WRITE_KEY configured, so it accepts reads only. " +
          "Set it to enable intent submission and resolve. Reading decisions needs no key.",
      });
    }

    req.log.warn({ path: req.url, method: req.method }, "write refused: bad or missing key");
    return reply
      .code(401)
      .header("www-authenticate", 'Bearer realm="aegis", charset="UTF-8"')
      .send({
        error: "unauthorized",
        detail:
          "Writes require `Authorization: Bearer <AEGIS_WRITE_KEY>`. " +
          "Reads are public and need no key.",
      });
  });
}
