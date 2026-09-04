import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { createGzip } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

/**
 * Serving the reviewer console (D4) from the gateway process.
 *
 * The console used to be a static bundle on its own host. It is now served by
 * this server, from one Railway service, at one origin:
 *
 *   /              -> apps/console/dist/index.html
 *   /assets/*      -> apps/console/dist/assets/*
 *   /intent/:ref   -> index.html again (SPA deep link, status 200)
 *   /v1/*, /health -> the API, untouched
 *
 * **This process holds `OPERATOR_SECRET`, `OWNER_SECRET` and the agent secret
 * keys.** Serving files from the same process as the signing keys is the price
 * of the single-service topology, and it is the reason this module is written
 * out rather than delegated: every path that reaches the filesystem is
 * constrained here, in one place, with a test pinning it.
 *
 * Four constraints, each enforced below and each asserted in
 * `test/staticConsole.test.ts`:
 *
 * 1. The served root is exactly `apps/console/dist`. A resolved path that is not
 *    inside it is a 404, checked BOTH on the joined path and again on the
 *    `realpath`, so a symlink planted in `dist` cannot reach out of it either.
 * 2. No dotfiles. Any path segment beginning with `.` is refused before the
 *    filesystem is touched, which covers `..` traversal and `.env` with the same
 *    rule.
 * 3. The SPA fallback never answers for the API. See `isApiPath` — a miss under
 *    `/v1` stays a JSON 404 rather than becoming `index.html` with status 200.
 * 4. Only GET and HEAD are served. A POST to an unrouted path is a JSON 404.
 */

/**
 * Prefixes owned by the API. Anything matching these is the gateway's to answer,
 * including when it answers 404.
 *
 * `registerConsole` installs an `onRoute` guard over this list, so adding an API
 * route outside these prefixes fails at BOOT rather than quietly starting to
 * return `index.html` with status 200 to a client parsing JSON.
 */
export const API_PREFIXES: readonly string[] = ["/v1", "/health"];

/** True when `pathname` belongs to the API and must never get the SPA fallback. */
export function isApiPath(pathname: string, prefixes: readonly string[] = API_PREFIXES): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Extensions the console actually ships, plus the few a bundler may add later.
 * An unknown extension is served as `application/octet-stream` rather than
 * guessed at — a wrong `text/html` on an unexpected file is the one mistake in
 * this table with a security consequence.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

export function contentTypeFor(pathname: string): string {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Content types worth gzipping.
 *
 * The bundle is around 640 kB of JavaScript and CSS uncompressed and about a
 * third of that gzipped. A CDN did this for free under the old topology; this
 * server has to do it itself or the reviewer pays the difference on the link
 * that IS the §6.1 D4 evidence. Images and fonts are already compressed —
 * running them through gzip spends CPU to make them marginally larger.
 */
export function isCompressible(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    contentType.startsWith("application/json") ||
    contentType === "image/svg+xml" ||
    contentType === "application/manifest+json"
  );
}

/** True when the client said it accepts gzip. Absent or `identity` means no. */
export function acceptsGzip(header: string | undefined): boolean {
  if (header === undefined) return false;
  return header
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .some((part) => {
      const [coding = "", ...params] = part.split(";").map((x) => x.trim());
      if (coding !== "gzip" && coding !== "*") return false;
      // `gzip;q=0` is a refusal, not an offer.
      return !params.some((x) => x.replace(/\s/g, "") === "q=0" || /^q=0(\.0+)?$/.test(x));
    });
}

/**
 * The default location of the built console, resolved from THIS module rather
 * than from the working directory — `src/staticConsole.ts` and
 * `dist/staticConsole.js` both sit one level under `apps/gateway`, so the
 * gateway finds the console identically however it was started. Same rule as
 * `config.ts` uses for the registry paths.
 */
export function defaultConsoleRoot(): string {
  return resolve(import.meta.dirname, "../../console/dist");
}

/** The pathname of a request, percent-decoded, or `null` if it cannot be decoded. */
export function requestPathname(url: string): string | null {
  let pathname: string;
  try {
    // Parsing against a fixed base normalises literal `.` and `..` segments and
    // strips the query string. Percent-encoded segments survive it and are
    // decoded — and re-checked — below.
    pathname = new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
  try {
    return decodeURIComponent(pathname);
  } catch {
    // `%` followed by something that is not a hex pair. Not a path we have.
    return null;
  }
}

/**
 * True when any segment of `pathname` begins with a dot.
 *
 * One rule covering three things: `.` and `..` traversal, and dotfiles such as
 * `.env` or `.git/config`. The console ships nothing whose name starts with a
 * dot, so this costs nothing and is checked before the filesystem is touched.
 */
export function hasDotSegment(pathname: string): boolean {
  return pathname.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Map a decoded pathname onto a file inside `root`, or `null`.
 *
 * `root` MUST already be a `realpath` — the containment check at the end
 * compares against it directly, and a root that is itself reached through a
 * symlink (macOS `/var` -> `/private/var`, for one) would otherwise refuse every
 * file under it.
 *
 * `null` covers every refusal — traversal, dotfile, directory, missing file,
 * symlink escape — because none of them should be distinguishable from outside.
 * A caller that could tell "refused" from "absent" could map the filesystem.
 */
export async function resolveWithin(root: string, pathname: string): Promise<string | null> {
  if (hasDotSegment(pathname)) return null;

  const segments = pathname.split("/").filter((s) => s.length > 0);
  for (const segment of segments) {
    // Neither can appear in a path the console ships, and both are separators or
    // terminators somewhere in the stack below us.
    if (segment.includes("\\") || segment.includes("\0")) return null;
  }

  const abs = segments.length === 0 ? join(root, "index.html") : join(root, ...segments);

  // Defence in depth. The segment checks above already make this unreachable;
  // it stays because it is the invariant the module actually promises, and an
  // invariant that is only implied by another check is one refactor from gone.
  if (abs !== root && !abs.startsWith(root + sep)) return null;

  let info;
  try {
    info = await stat(abs);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;

  // The same containment check again, on the resolved target. `stat` follows
  // symlinks, so without this a link inside `dist` pointing at `/app/.env` — or
  // at anything else in the image — would be served as console content.
  let real: string;
  try {
    real = await realpath(abs);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) return null;

  return real;
}

export interface ConsoleStaticOptions {
  /** Absolute path to the built console. Nothing above it is reachable. */
  root: string;
  /** Prefixes the API owns; a miss under one of these stays a JSON 404. */
  apiPrefixes?: readonly string[];
}

function jsonNotFound(req: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.code(404).send({
    error: "not_found",
    detail: `no route for ${req.method} ${requestPathname(req.url) ?? req.url}`,
  });
}

/**
 * Install the console's static handler and SPA fallback on `app`.
 *
 * Call this BEFORE `registerRoutes`: the `onRoute` guard only sees routes
 * registered after it, and it is the thing that keeps `API_PREFIXES` honest.
 * Ordering is otherwise irrelevant — everything here hangs off the not-found
 * handler, so a real route always wins by construction rather than by luck.
 *
 * Returns `false` when `root` does not exist, in which case the API is served
 * alone and every miss is a JSON 404. That is the normal state of a `pnpm dev`
 * gateway with no console build next to it, so it warns rather than throwing.
 */
export async function registerConsole(
  app: FastifyInstance,
  opts: ConsoleStaticOptions,
): Promise<boolean> {
  const prefixes = opts.apiPrefixes ?? API_PREFIXES;

  app.addHook("onRoute", (route) => {
    // `@fastify/cors` registers a wildcard OPTIONS route for preflight; plugins
    // are allowed their own. Only concrete paths are held to the list.
    if (route.url.startsWith("*") || route.url === "/*") return;
    if (isApiPath(route.url, prefixes)) return;
    throw new Error(
      `route ${route.method} ${route.url} is outside API_PREFIXES (${prefixes.join(", ")}); ` +
        "add its prefix in staticConsole.ts or the console's SPA fallback will answer its 404s with HTML",
    );
  });

  const root = resolve(opts.root);

  let realRoot: string;
  try {
    const info = await stat(root);
    if (!info.isDirectory()) throw new Error(`${root} is not a directory`);
    realRoot = await realpath(root);
  } catch {
    app.log.warn(
      { console_root: root },
      "no console build found — serving the API only; every miss is a JSON 404",
    );
    app.setNotFoundHandler((req, reply) => jsonNotFound(req, reply));
    return false;
  }

  const indexPath = join(realRoot, "index.html");

  const sendFile = (
    req: FastifyRequest,
    reply: FastifyReply,
    absolute: string,
    immutable: boolean,
  ): FastifyReply => {
    const contentType = contentTypeFor(absolute);
    const gzip = isCompressible(contentType) && acceptsGzip(req.headers["accept-encoding"]);

    reply
      .type(contentType)
      // The console is a bundle of scripts and styles served from the same
      // origin as an API holding signing keys. Sniffing is off.
      .header("x-content-type-options", "nosniff")
      .header(
        "cache-control",
        immutable
          ? // Vite fingerprints everything under /assets with a content hash, so
            // the URL changes whenever the bytes do.
            "public, max-age=31536000, immutable"
          : // index.html must not be. A cached one pins the reviewer to the
            // asset hashes of a previous deploy.
            "no-cache",
      );

    const body = createReadStream(absolute);
    if (!gzip) return reply.send(body);

    // `vary` even though this server never caches: a proxy in front of it would
    // otherwise be free to hand a gzipped body to a client that did not ask.
    // No `content-length` in either branch — the response is streamed.
    return reply
      .header("content-encoding", "gzip")
      .header("vary", "accept-encoding")
      .send(body.pipe(createGzip()));
  };

  app.setNotFoundHandler(async (req, reply) => {
    // Trap 1, the whole point of this handler: the API answers its own misses.
    // A GET for a decision that does not exist must reach a client as JSON.
    const pathname = requestPathname(req.url);
    if (pathname === null) return jsonNotFound(req, reply);
    if (isApiPath(pathname, prefixes)) return jsonNotFound(req, reply);

    // Refused here rather than left to fall through to the SPA fallback. Both
    // outcomes withhold the file, but only this one answers `GET /.env` with a
    // 404: handing back `index.html` at status 200 would say "this path exists,
    // as a page", which is the wrong claim to make about a dotfile.
    if (hasDotSegment(pathname)) return jsonNotFound(req, reply);

    // A body-carrying method that matched no route is a routing error, never a
    // page. Only a navigation can be answered with a document.
    if (req.method !== "GET" && req.method !== "HEAD") return jsonNotFound(req, reply);

    const file = await resolveWithin(realRoot, pathname);
    if (file !== null) {
      return sendFile(req, reply, file, pathname.startsWith("/assets/"));
    }

    // Nothing on disk. Either this is a deep link the SPA router will handle, or
    // it is a genuinely missing file.
    //
    // The split is the extension. `/intent/<hash>` is a route; `/assets/x.js`
    // that is not there is a stale build referencing an asset this deploy does
    // not have, and answering that with `index.html` at status 200 would hand
    // the browser HTML where it asked for JavaScript and hide the real fault.
    const last = pathname.slice(pathname.lastIndexOf("/") + 1);
    if (extname(last) !== "") return jsonNotFound(req, reply);

    return sendFile(req, reply, indexPath, false);
  });

  app.log.info({ console_root: realRoot }, "serving the reviewer console");
  return true;
}
