import { useState } from "react";

/** Mandatory label per §4.1 D4 — must not be removed. */
function TestnetBanner() {
  return (
    <div className="bg-amber-100 text-amber-900 border-b border-amber-300 px-4 py-2 text-sm font-medium">
      ⚠️ <strong>Testnet</strong> — no real funds. Settlement runs between AEGIS
      test accounts; nothing is paid to a real digital-service provider.
    </div>
  );
}

/** Clearly separates authoritative data (chain) from supplementary display data (AEGIS API). */
function SourceTag({ chain }: { chain: boolean }) {
  return chain ? (
    <span className="text-xs rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5">
      read from chain
    </span>
  ) : (
    <span className="text-xs rounded bg-slate-100 text-slate-600 px-1.5 py-0.5">
      display only
    </span>
  );
}

export default function App() {
  const [ref, setRef] = useState("");

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TestnetBanner />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold">AEGIS Evidence Console</h1>
        <p className="mt-1 text-slate-600">
          Enter an intent reference to see the full chain: agent → policy →
          decision → settlement.
        </p>

        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // TODO(D4): navigate to /intent/:ref and query via ./chain.ts
          }}
        >
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="intent reference or intent_hash"
            className="flex-1 rounded border border-slate-300 px-3 py-2"
          />
          <button className="rounded bg-slate-900 px-4 py-2 text-white">Look up</button>
        </form>

        <section className="mt-8 rounded border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">The evidence chain will appear here</h2>
          <ul className="mt-2 space-y-1 text-sm text-slate-700">
            <li>
              verdict · reason code · policy version <SourceTag chain />
            </li>
            <li>
              decision_id + Stellar Expert link to the contract <SourceTag chain />
            </li>
            <li>
              amount · asset · MEMO_HASH + link to the transaction <SourceTag chain />
            </li>
            <li>
              purpose · client_ref <SourceTag chain={false} />
            </li>
          </ul>
          <p className="mt-3 text-sm text-slate-500">
            Rejected intents show a <strong>reason code</strong> — they are never hidden.
          </p>
        </section>
      </main>
    </div>
  );
}
