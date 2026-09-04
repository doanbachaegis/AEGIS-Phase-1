import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import {
  API_PREFIXES,
  acceptsGzip,
  contentTypeFor,
  isApiPath,
  isCompressible,
  hasDotSegment,
  requestPathname,
  registerConsole,
  resolveWithin,
} from "../src/staticConsole.js";

/**
 * The console is served by the gateway process — the same process that holds
 * `OPERATOR_SECRET`, `OWNER_SECRET` and the agent secret keys. Two properties
 * pay for that topology and both are pinned here:
 *
 *   1. The SPA fallback never answers for the API. A miss under `/v1` reaches
 *      the caller as JSON, not as `index.html` with status 200.
 *   2. Nothing outside `apps/console/dist` is reachable, dotfiles included, by
 *      traversal or by symlink.
 */

const INDEX_MARKER = "<!-- aegis-console-index -->";
const SECRET = "OPERATOR_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

let tmp: string;
let root: string;
/** `resolveWithin` compares against a realpath; on macOS `/var` is a symlink. */
let realRoot: string;
let outside: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "aegis-console-"));
  root = join(tmp, "dist");
  outside = join(tmp, "outside");

  await mkdir(join(root, "assets"), { recursive: true });
  await mkdir(join(root, "nested"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(join(root, "index.html"), `<html><body>${INDEX_MARKER}</body></html>`);
  await writeFile(join(root, "assets", "app-abc123.js"), "export const ok = 1;\n");
  await writeFile(join(root, "assets", "index-abc123.css"), "body{color:#000}\n");

  // A dotfile INSIDE the served root. Nothing puts one here on purpose; the
  // point is that if something ever does, it is not reachable.
  await writeFile(join(root, ".env"), SECRET);

  // The real risk this topology introduces: the process's own `.env` sits above
  // the served root.
  await writeFile(join(tmp, ".env"), SECRET);
  await writeFile(join(outside, "secret.txt"), SECRET);

  // A symlink planted inside the root pointing out of it. `stat` follows it, so
  // only the `realpath` check refuses this one.
  await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));

  realRoot = await realpath(root);
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A gateway-shaped app: the console, then routes under the API prefixes. */
async function buildApp(consoleRoot: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerConsole(app, { root: consoleRoot });

  app.get("/health", async () => ({ ok: true }));

  // Stands in for the real `/v1/decisions/:id`: a decision that is not there is
  // the gateway's own JSON 404, produced by a route that matched.
  app.get("/v1/decisions/:id", async (_req, reply) =>
    reply.code(404).send({ error: "decision_not_found", detail: "DecisionNotFound (#6)" }),
  );
  app.post("/v1/intents", async (_req, reply) => reply.code(202).send({ ok: true }));

  await app.ready();
  return app;
}

describe("serving the console", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(root);
  });
  afterAll(async () => {
    await app.close();
  });

  it("serves index.html at the root", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain(INDEX_MARKER);
  });

  /**
   * SOW §6.1 D4 makes the evidence "a public link to the console" plus a list of
   * intent references, so a deep link pasted into a cold tab has to resolve.
   */
  it.each(["/intent/" + "a".repeat(64), "/decision/" + "b".repeat(64), "/anything/else"])(
    "returns the app for the deep link %s",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain(INDEX_MARKER);
    },
  );

  it("serves fingerprinted assets with their own content type and immutable caching", async () => {
    const js = await app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect(js.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");

    const css = await app.inject({ method: "GET", url: "/assets/index-abc123.css" });
    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
  });

  /** A cached index.html pins the reviewer to a previous deploy's asset hashes. */
  it("does not let index.html be cached", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  /**
   * A CDN did this for free under the old topology. The bundle is ~640 kB of
   * JavaScript uncompressed, on the link that IS the §6.1 D4 evidence.
   */
  it("gzips a compressible file for a client that asks, byte-for-byte", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assets/app-abc123.js",
      headers: { "accept-encoding": "gzip, deflate, br" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers["vary"]).toBe("accept-encoding");
    expect(gunzipSync(res.rawPayload).toString()).toBe("export const ok = 1;\n");
  });

  it("sends plain bytes to a client that does not ask for gzip", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/assets/app-abc123.js",
      headers: { "accept-encoding": "identity" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body).toBe("export const ok = 1;\n");
  });

  it("gzips the SPA fallback too", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/intent/abc",
      headers: { "accept-encoding": "gzip" },
    });
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(res.rawPayload).toString()).toContain(INDEX_MARKER);
  });

  it("ignores the query string when resolving a file", async () => {
    const res = await app.inject({ method: "GET", url: "/assets/app-abc123.js?v=2" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("export const ok");
  });
});

/**
 * Trap 1. A naive `setNotFoundHandler` returning index.html for everything turns
 * every API miss into an HTML page with status 200, and a client parsing JSON
 * gets an error that names nothing useful.
 */
describe("the SPA fallback never answers for the API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(root);
  });
  afterAll(async () => {
    await app.close();
  });

  it("leaves a matched API route's own 404 alone", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/decisions/${"c".repeat(64)}` });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toMatchObject({ error: "decision_not_found" });
    expect(res.body).not.toContain(INDEX_MARKER);
  });

  it.each([
    "/v1",
    "/v1/",
    "/v1/nope",
    "/v1/decisions",
    "/v1/decisions/abc/extra",
    "/health/nope",
  ])("answers %s with a JSON 404, never the app", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).not.toContain(INDEX_MARKER);
    expect(res.json()).toMatchObject({ error: "not_found" });
  });

  it("still serves the API itself", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true });

    const post = await app.inject({ method: "POST", url: "/v1/intents", payload: {} });
    expect(post.statusCode).toBe(202);
  });

  /** Only a navigation can be answered with a document. */
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "answers %s on a console-shaped path with a JSON 404",
    async (method) => {
      const res = await app.inject({
        method: method as "POST",
        url: "/intent/" + "d".repeat(64),
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(INDEX_MARKER);
    },
  );

  /**
   * A missing hashed asset means a stale build referencing bytes this deploy
   * does not have. Answering with HTML at 200 hands the browser a document where
   * it asked for JavaScript and hides the real fault.
   */
  it.each(["/assets/gone-000000.js", "/favicon.ico", "/deep/path/missing.css"])(
    "answers the missing file %s with a 404 rather than the app",
    async (url) => {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(INDEX_MARKER);
    },
  );
});

/**
 * Trap 5. This process holds the signing keys; the served root is exactly
 * `apps/console/dist` and nothing above it.
 */
describe("the served root cannot be escaped", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(root);
  });
  afterAll(async () => {
    await app.close();
  });

  it.each([
    "/.env",
    "/.git/config",
    "/nested/.env",
    "/%2e%2e/.env",
    "/%2e%2e%2f%2e%2e%2f.env",
    "/assets/%2e%2e/%2e%2e/.env",
    "/..%2f.env",
    "/....//.env",
    "/%2e%2e%5c.env",
  ])("refuses %s", async (url) => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("OPERATOR_SECRET");
    expect(res.body).not.toContain(INDEX_MARKER);
  });

  /** `stat` follows symlinks. Only the realpath check refuses this one. */
  it("refuses a symlink inside the root that points out of it", async () => {
    const res = await app.inject({ method: "GET", url: "/escape.txt" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("OPERATOR_SECRET");
  });

  it("never returns a secret under any of these paths", async () => {
    for (const url of ["/.env", "/escape.txt", "/%2e%2e/.env", "/outside/secret.txt"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.body).not.toContain("OPERATOR_SECRET");
    }
  });

  it("does not serve a directory as a file", async () => {
    // Falls through to the SPA fallback — a path with no extension is a route as
    // far as this server is concerned — but the directory itself is never read.
    const res = await app.inject({ method: "GET", url: "/assets" });
    expect(res.body).not.toContain("app-abc123");
  });
});

describe("resolveWithin", () => {
  it("resolves a real file inside the root", async () => {
    await expect(resolveWithin(realRoot, "/assets/app-abc123.js")).resolves.toContain(
      "app-abc123.js",
    );
  });

  it("maps the bare root onto index.html", async () => {
    await expect(resolveWithin(realRoot, "/")).resolves.toContain("index.html");
  });

  it.each(["/../.env", "/./.env", "/.env", "/a/../../.env", "/nested/..\\.env"])(
    "refuses %s",
    async (path) => {
      await expect(resolveWithin(realRoot, path)).resolves.toBeNull();
    },
  );

  it("refuses a directory", async () => {
    await expect(resolveWithin(realRoot, "/assets")).resolves.toBeNull();
  });

  it("refuses a file that is not there", async () => {
    await expect(resolveWithin(realRoot, "/assets/nope.js")).resolves.toBeNull();
  });
});

describe("with no console build next to it", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(join(tmp, "does-not-exist"));
  });
  afterAll(async () => {
    await app.close();
  });

  /**
   * `pnpm dev` on the gateway alone. The API must still work and every miss must
   * still be JSON — a gateway that throws at boot because a *frontend* is
   * missing would be the wrong trade.
   */
  it("serves the API and answers every miss with JSON", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);

    const miss = await app.inject({ method: "GET", url: "/intent/abc" });
    expect(miss.statusCode).toBe(404);
    expect(miss.headers["content-type"]).toContain("application/json");
  });
});

/**
 * The guard that keeps `API_PREFIXES` honest. Without it, adding an API route
 * outside `/v1` and `/health` would silently start returning `index.html` with
 * status 200 for that route's 404s.
 */
describe("the API prefix guard", () => {
  it("refuses at boot to register an API route outside API_PREFIXES", async () => {
    const app = Fastify({ logger: false });
    await registerConsole(app, { root });
    expect(() => app.get("/decisions/:id", async () => ({}))).toThrow(/API_PREFIXES/);
    await app.close();
  });

  it("allows the wildcard OPTIONS route @fastify/cors registers for preflight", async () => {
    const app = Fastify({ logger: false });
    await registerConsole(app, { root });
    expect(() => app.options("/*", async () => ({}))).not.toThrow();
    await app.close();
  });
});

describe("path helpers", () => {
  it("classifies API paths and only API paths", () => {
    for (const p of ["/health", "/v1", "/v1/", "/v1/intents", "/v1/decisions/abc"]) {
      expect(isApiPath(p)).toBe(true);
    }
    for (const p of ["/", "/intent/abc", "/healthz", "/v1x", "/assets/v1/x.js"]) {
      expect(isApiPath(p)).toBe(false);
    }
    expect(API_PREFIXES).toContain("/v1");
  });

  it("strips the query string and normalises dot segments", () => {
    expect(requestPathname("/assets/a.js?x=1")).toBe("/assets/a.js");
    expect(requestPathname("/a/../b")).toBe("/b");
    // WHATWG URL decodes `%2e` and resolves the dot segments itself, so an
    // encoded traversal arrives here already collapsed. `hasDotSegment` is what
    // catches whatever survives that.
    expect(requestPathname("/%2e%2e/.env")).toBe("/.env");
    expect(requestPathname("/assets/%2e%2e/%2e%2e/.env")).toBe("/.env");
  });

  it("returns null for a pathname that cannot be decoded", () => {
    expect(requestPathname("/%zz")).toBeNull();
  });

  it("catches traversal and dotfiles under one rule", () => {
    for (const p of ["/.env", "/a/.env", "/../x", "/./x", "/nested/.git/config"]) {
      expect(hasDotSegment(p)).toBe(true);
    }
    for (const p of ["/", "/intent/abc", "/assets/app-abc123.js", "/a.b/c"]) {
      expect(hasDotSegment(p)).toBe(false);
    }
  });

  it("gzips text and leaves already-compressed formats alone", () => {
    for (const t of ["text/javascript; charset=utf-8", "text/css", "image/svg+xml"]) {
      expect(isCompressible(t)).toBe(true);
    }
    for (const t of ["image/png", "font/woff2", "application/octet-stream"]) {
      expect(isCompressible(t)).toBe(false);
    }
  });

  it("reads accept-encoding, including a q=0 refusal", () => {
    expect(acceptsGzip("gzip, deflate")).toBe(true);
    expect(acceptsGzip("br;q=1.0, gzip;q=0.8")).toBe(true);
    expect(acceptsGzip("*")).toBe(true);
    expect(acceptsGzip(undefined)).toBe(false);
    expect(acceptsGzip("identity")).toBe(false);
    expect(acceptsGzip("br")).toBe(false);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
  });

  it("never guesses text/html for an unknown extension", () => {
    expect(contentTypeFor("/index.html")).toContain("text/html");
    expect(contentTypeFor("/app.js")).toContain("text/javascript");
    expect(contentTypeFor("/weird.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("/no-extension")).toBe("application/octet-stream");
  });
});
