import { useState } from "react";
import { normalizeRef, stellarExpert } from "./chain.js";
import { env } from "./env.js";
import { intentHref, navigate } from "./router.js";
import { AppLink, Card, ExtLink, Hex, SourceTag } from "./ui.js";

export function HomePage() {
  const [ref, setRef] = useState("");
  const normalized = normalizeRef(ref);
  const dirty = ref.trim().length > 0;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          AEGIS Evidence Console
        </h1>
        <p className="mt-1 max-w-2xl text-slate-600">
          Enter an intent reference to see the full chain: agent → policy → decision →
          settlement. Every authoritative field is read directly from the authorization
          contract over Soroban RPC, with no AEGIS database in the path.
        </p>
      </header>

      <Card title="Look up a reference">
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (normalized !== null) navigate(intentHref(normalized));
          }}
        >
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="intent_hash or decision_id — 64 hex characters"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-sm"
          />
          <button
            type="submit"
            disabled={normalized === null}
            className="rounded bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Look up
          </button>
        </form>
        {dirty && normalized === null && (
          <p className="mt-2 text-sm text-rose-700">
            A reference is 32 bytes of hex — 64 characters, optionally prefixed{" "}
            <code className="font-mono">0x</code>.
          </p>
        )}
        <p className="mt-3 text-sm text-slate-600">
          Either identifier works. The console tries{" "}
          <code className="font-mono">decision_by_intent</code> first and falls back to{" "}
          <code className="font-mono">get_decision</code>, so a link you were handed resolves
          whichever of the two it carries.
        </p>
      </Card>

      {env.sampleIntents.length > 0 && (
        <Card
          title="Published references"
          subtitle="The intent references that accompany this link as the D4 evidence pack (§6.1)."
        >
          <ul className="space-y-2">
            {env.sampleIntents.map((sample) => (
              <li key={sample} className="text-sm">
                <AppLink href={intentHref(sample)}>
                  <span className="font-mono break-all">{sample}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="What this console does and does not do"
        subtitle="§6.3: every decision can be read on-chain by contract ID, independently of the AEGIS database."
      >
        <ul className="space-y-3 text-sm text-slate-700">
          <li>
            verdict · reason code · policy version · amount · asset · settled{" "}
            <SourceTag source="chain" />
            <div className="text-slate-500">
              read from the contract by simulating <code className="font-mono">get_decision</code>{" "}
              / <code className="font-mono">decision_by_intent</code>.
            </div>
          </li>
          <li>
            <code className="font-mono">memo_hash()</code> <SourceTag source="chain" />
            <div className="text-slate-500">
              computed by the contract, not recomputed here — it is what a settle transaction's
              MEMO_HASH is checked against.
            </div>
          </li>
          <li>
            settlement transaction <SourceTag source="ledger" />
            <div className="text-slate-500">
              the contract never records WHICH transaction paid, so the console searches the
              public ledger through Horizon for a transaction carrying the{" "}
              <code className="font-mono">memo_hash()</code> above. Derived from public data,
              not asserted by AEGIS — and reproducible without this console.
            </div>
          </li>
          <li>
            purpose · client_ref <SourceTag source="api" />
            <div className="text-slate-500">
              supplied by the AEGIS API. Never mixed with the fields above.
            </div>
          </li>
          <li className="pt-2">
            <strong>No key, no signer, no writes.</strong> Every call stops at{" "}
            <code className="font-mono">simulateTransaction</code>. That is not a limitation — it
            is why a reviewer with no relationship to AEGIS can reproduce this page.
          </li>
          <li>
            <strong>Refused intents are shown, never hidden</strong>, with the same visual weight
            as an approval. Refusing correctly is the product.
          </li>
        </ul>
      </Card>

      <Card title="This deployment">
        <dl className="text-sm">
          <div className="border-b border-slate-100 py-2">
            <dt className="font-mono text-xs text-slate-600">contract</dt>
            <dd className="mt-1">
              <ExtLink href={stellarExpert.contract(env.contractId)}>
                <span className="font-mono break-all">{env.contractId}</span>
              </ExtLink>
            </dd>
          </div>
          <div className="border-b border-slate-100 py-2">
            <dt className="font-mono text-xs text-slate-600">rpc</dt>
            <dd className="mt-1 font-mono break-all text-slate-900">{env.rpcUrl}</dd>
          </div>
          <div className="py-2">
            <dt className="font-mono text-xs text-slate-600">network passphrase</dt>
            <dd className="mt-1 font-mono break-all text-slate-900">{env.networkPassphrase}</dd>
          </div>
        </dl>
      </Card>
    </main>
  );
}

export function NotFoundPage({ path }: { path: string }) {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <Card title="No such page">
        <p className="text-sm text-slate-700">
          Nothing is served at <Hex value={path} />.
        </p>
        <p className="mt-3 text-sm">
          <AppLink href="/">Go to the lookup form</AppLink>
        </p>
      </Card>
    </main>
  );
}
