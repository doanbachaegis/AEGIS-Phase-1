import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TestnetBanner } from "./TestnetBanner.js";
import { ConfigError } from "./ConfigError.js";
import { ErrorBoundary } from "./ui.js";
import "./index.css";

/**
 * The banner is a sibling of the entire application, mounted before anything that can
 * fail: above the router, above the error boundary, and above the module that validates
 * configuration. `./App.js` is imported dynamically for exactly that reason — `./env.js`
 * throws at import time on a misconfigured deploy, and a static import would take the
 * mandatory testnet label down with it.
 */
const root = createRoot(document.getElementById("root")!);

// On-chain data is immutable -> cache forever, no pointless refetching. The one exception
// is `settled`, which the executor can flip after the decision is written; the evidence
// query overrides `staleTime` for that and offers an explicit re-read.
async function boot() {
  const [{ default: App }, { QueryClient, QueryClientProvider }] = await Promise.all([
    import("./App.js"),
    import("@tanstack/react-query"),
  ]);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: 2, refetchOnWindowFocus: false } },
  });

  // No persister: amounts are bigint, and JSON.stringify throws on bigint.
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

let body;
try {
  body = await boot();
} catch (error) {
  body = <ConfigError error={error} />;
}

root.render(
  <StrictMode>
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <TestnetBanner />
      {body}
    </div>
  </StrictMode>,
);
