/**
 * A deep link has to resolve. SOW §6.1 D4 says the evidence is "a public link to the
 * console" plus a list of intent references, which means /intent/<ref> must be a real
 * URL a reviewer can paste into a fresh tab — not a client-side state the app forgets
 * on reload. The matching SPA fallback is the GATEWAY's — it serves this bundle
 * and returns index.html for an unrouted path, carefully not doing so for /v1/*
 * (apps/gateway/src/staticConsole.ts).
 *
 * Hand-rolled rather than pulled from a router library: two routes, no nesting, no
 * loaders. A dependency here would be more code than the code.
 */

import { useCallback, useSyncExternalStore } from "react";

export type Route =
  | { kind: "home" }
  | { kind: "reference"; ref: string; prefer: "intent" | "decision" }
  | { kind: "unknown"; path: string };

export function parseRoute(pathname: string): Route {
  const segments = pathname.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) return { kind: "home" };

  const [head, tail] = segments;
  if (segments.length === 2 && tail !== undefined) {
    if (head === "intent") return { kind: "reference", ref: decode(tail), prefer: "intent" };
    if (head === "decision") return { kind: "reference", ref: decode(tail), prefer: "decision" };
  }

  return { kind: "unknown", path: pathname };
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function intentHref(ref: string): string {
  return `/intent/${encodeURIComponent(ref)}`;
}

export function decisionHref(ref: string): string {
  return `/decision/${encodeURIComponent(ref)}`;
}

const NAVIGATED = "aegis:navigated";

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event(NAVIGATED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATED, onChange);
  };
}

function currentPath(): string {
  return window.location.pathname;
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, currentPath, () => "/");
  return parseRoute(path);
}

/** Intercepts a plain left click so in-app links stay client-side but remain real hrefs. */
export function useLinkHandler(): (e: React.MouseEvent<HTMLAnchorElement>) => void {
  return useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const href = e.currentTarget.getAttribute("href");
    if (href === null || !href.startsWith("/")) return;
    e.preventDefault();
    navigate(href);
  }, []);
}
