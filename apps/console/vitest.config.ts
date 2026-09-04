import { defineConfig } from "vitest/config";

// JSX transform comes from tsconfig.json ("jsx": "react-jsx") — Vitest reads it.
export default defineConfig({
  test: {
    // Nothing here touches the DOM: components are asserted through
    // `renderToStaticMarkup`, which keeps the suite free of a jsdom dependency and
    // asserts the rendered TEXT rather than a component's internals.
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    // `./src/env.ts` throws at import time when configuration is missing — by design.
    // These are the live testnet values, so tests exercise the same code path a
    // deployed console does. Vitest exposes them on `import.meta.env`.
    env: {
      VITE_STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      VITE_STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      VITE_CONTRACT_ID: "CBSKXOYOXTFT3OGEQ6NDJXD3UQPMVK4WMJFUTXRR5CP3IUZAJOSGQBWA",
    },
  },
});
