import { Component, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { useLinkHandler } from "./router.js";

/**
 * Where a value came from, which is the distinction §6.3 turns on.
 *
 * THREE tiers, not two. "chain" is the contract's own answer over Soroban RPC. "ledger"
 * is public Stellar history read from Horizon — not an AEGIS service, reproducible by a
 * stranger, but a search result rather than a stored field. "api" is the AEGIS database
 * and proves nothing on its own. Collapsing the middle tier into either neighbour would
 * be a false claim: the settlement transaction link is neither stored on-chain nor taken
 * on trust from AEGIS.
 */
export type FieldSource = "chain" | "ledger" | "api";

const SOURCE: Record<FieldSource, { label: string; title: string; className: string }> = {
  chain: {
    label: "read from chain",
    title:
      "Read directly from the authorization contract over Soroban RPC. Reproducible by anyone with the contract ID.",
    className: "bg-emerald-100 text-emerald-800",
  },
  ledger: {
    label: "derived from ledger",
    title:
      "Found on the public Stellar ledger through Horizon, by searching for the memo the contract itself commits to. Not supplied by AEGIS, and reproducible by anyone.",
    className: "bg-sky-100 text-sky-800",
  },
  api: {
    label: "display only",
    title: "Supplied by the AEGIS API. Not part of the on-chain evidence.",
    className: "bg-slate-100 text-slate-600",
  },
};

export function SourceTag({ source }: { source: FieldSource }) {
  const tag = SOURCE[source];
  return (
    <span
      title={tag.title}
      className={`text-xs rounded px-1.5 py-0.5 align-middle whitespace-nowrap ${tag.className}`}
    >
      {tag.label}
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

/**
 * The label column is a FIXED 13rem track so the values line up down a card. A fixed
 * track does not grow, so the label side must be allowed to wrap inside it — `flex-wrap`
 * lets the source tag drop to its own line, and `min-w-0` lets a long identifier break
 * instead of spilling across the value. Without both, `resolved_policy_version` and its
 * badge overrun the track and print on top of the value beside them.
 */
export function Field({
  label,
  source,
  children,
}: {
  label: string;
  source: FieldSource;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-2 last:border-b-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <dt className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-slate-600">
        <span className="font-mono text-[0.8rem] break-all">{label}</span>
        <SourceTag source={source} />
      </dt>
      <dd className="min-w-0 text-sm text-slate-900">{children}</dd>
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
