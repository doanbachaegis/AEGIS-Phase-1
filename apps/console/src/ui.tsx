import { Component, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useLinkHandler } from "./router.js";

/**
 * Clearly separates authoritative data (chain) from supplementary display data (AEGIS API).
 *
 * This is the two-tier distinction §6.3 turns on. Anything tagged "read from chain" was
 * simulated against Soroban RPC by the browser showing this page; anything tagged
 * "display only" came from the AEGIS database and proves nothing on its own.
 */
export function SourceTag({ chain }: { chain: boolean }) {
  return chain ? (
    <span
      title="Read directly from the authorization contract over Soroban RPC. Reproducible by anyone with the contract ID."
      className="text-xs rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 align-middle whitespace-nowrap"
    >
      read from chain
    </span>
  ) : (
    <span
      title="Supplied by the AEGIS API. Not part of the on-chain evidence."
      className="text-xs rounded bg-slate-100 text-slate-600 px-1.5 py-0.5 align-middle whitespace-nowrap"
    >
      display only
    </span>
  );
}

/** A value the reviewer is expected to copy and paste into a verifier. */
export function Hex({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-baseline gap-2">
      <code className="font-mono text-[0.8rem] break-all text-slate-900">{value}</code>
      <button
        type="button"
        className="shrink-0 text-xs text-slate-500 underline decoration-dotted hover:text-slate-900"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            },
            () => setCopied(false),
          );
        }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
    >
      {children} ↗
    </a>
  );
}

/** An in-app link that is a real href — so it survives a copy-paste into a new tab. */
export function AppLink({ href, children }: { href: string; children: ReactNode }) {
  const onClick = useLinkHandler();
  return (
    <a
      href={href}
      onClick={onClick}
      className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
    >
      {children}
    </a>
  );
}

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {subtitle !== undefined && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  chain,
  children,
}: {
  label: string;
  chain: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 last:border-b-0 sm:grid-cols-[13rem_1fr] sm:gap-4">
      <dt className="flex items-baseline gap-2 text-sm text-slate-600">
        <span className="font-mono text-[0.8rem]">{label}</span>
        <SourceTag chain={chain} />
      </dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function Callout({ level, children }: { level: "info" | "warn"; children: ReactNode }) {
  const tone =
    level === "warn"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-sky-200 bg-sky-50 text-sky-900";
  return (
    <p className={`rounded-md border px-3 py-2 text-sm ${tone}`}>
      <span className="font-semibold">{level === "warn" ? "Caveat: " : "Note: "}</span>
      {children}
    </p>
  );
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Renders BELOW the testnet banner by construction — `main.tsx` mounts the banner as a
 * sibling, so a crash inside the app cannot take the mandatory label down with it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("AEGIS console render error", error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-bold text-red-900">The console failed to render</h1>
        <p className="mt-2 text-sm text-slate-700">
          Nothing on-chain is affected by this — it is a bug in the viewer. The decision can
          still be read with the <code className="font-mono">stellar</code> CLI; the commands are
          in <code className="font-mono">apps/console/README.md</code>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          {error.message}
        </pre>
      </main>
    );
  }
}
