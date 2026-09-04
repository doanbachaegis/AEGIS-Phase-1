/**
 * Mandatory label per §4.1 D4 — must not be removed.
 *
 * It lives in its own module, imports nothing else, and is rendered by `main.tsx` as a
 * sibling of the entire application: above the router, above the error boundary, and
 * above the configuration check. There is no state the app can reach — an unresolved
 * reference, a thrown render, a missing VITE_CONTRACT_ID — in which a viewer sees the
 * console without also seeing this. `test/testnet-banner.test.tsx` asserts the two
 * required strings against the rendered TEXT, so restyling cannot quietly drop them.
 */
export function TestnetBanner() {
  return (
    <div
      role="note"
      className="bg-amber-100 text-amber-900 border-b border-amber-300 px-4 py-2 text-sm font-medium"
    >
      ⚠️ <strong>Testnet</strong> — no real funds. Settlement runs between AEGIS test
      accounts; nothing is paid to a real digital-service provider.
    </div>
  );
}
