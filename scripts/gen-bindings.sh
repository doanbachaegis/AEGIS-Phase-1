#!/usr/bin/env bash
# Generate TypeScript bindings from the ABI of the deployed contract.
# DO NOT hand-write, DO NOT commit — re-run after every contract bump.
# ABI drift then becomes a COMPILE ERROR instead of a runtime error.
set -euo pipefail

: "${CONTRACT_ID:?CONTRACT_ID is required — see .env.example}"
NETWORK="${STELLAR_NETWORK:-testnet}"

stellar contract bindings typescript \
  --contract-id "$CONTRACT_ID" \
  --network "$NETWORK" \
  --output-dir packages/bindings \
  --overwrite

echo "bindings generated for $CONTRACT_ID on $NETWORK"

# The generated package does not match this workspace out of the box:
#   - it is named "bindings", but the code imports "@aegis/bindings"
#   - it pins its own TypeScript, while the repo is on the root toolchain
#   - its tsconfig leaves rootDir unset, which TS 7 rejects (TS5011)
# Patch all three so `pnpm -r build` succeeds. Re-applied on every regeneration.
node - <<'PATCH'
import { readFileSync, writeFileSync } from "node:fs";

const pkgPath = "packages/bindings/package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
pkg.name = "@aegis/bindings";
pkg.private = true;
pkg.version = "0.1.0";
delete pkg.devDependencies?.typescript;
pkg.scripts = { ...pkg.scripts, typecheck: "tsc --noEmit", test: "vitest run --passWithNoTests" };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// The emitted tsconfig is a stock template: hundreds of commented-out lines
// around four live options. It is not hand-maintained, so replace it outright
// with those same four options plus the rootDir that TS 7 requires.
writeFileSync(
  "packages/bindings/tsconfig.json",
  JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "NodeNext",
        moduleResolution: "nodenext",
        strictNullChecks: true,
        declaration: true,
        skipLibCheck: true,
        rootDir: "./src",
        outDir: "./dist",
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n",
);

console.log("patched packages/bindings -> @aegis/bindings (rootDir ./src)");
PATCH
