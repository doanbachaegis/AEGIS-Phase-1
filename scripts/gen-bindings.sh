#!/usr/bin/env bash
# Generate the TypeScript bindings from the LOCAL contract wasm.
#
# The output is GENERATED but COMMITTED, and the `bindings-drift` job in CI
# re-runs this script and fails on any diff. packages/bindings/ is therefore a
# pure function of contracts/authorization/src/** — a PR that changes the
# contract turns CI red BEFORE anyone deploys, and ABI drift becomes a COMPILE
# ERROR instead of a runtime error.
#
# Deliberately reads the wasm, not a deployed --contract-id:
#   - it works offline; no RPC, no CONTRACT_ID, no deploy needed;
#   - Cloudflare Pages and Railway build from the committed output, so neither
#     needs a Rust toolchain or the `stellar` CLI;
#   - the emitted code carries no `networks` block and no hard-coded contract
#     address, so `contractId` must come from the environment at runtime.
#
# Re-run with `pnpm bindings` after every contract change.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="packages/bindings"
# The output directory name leaks into the generated files, so it is fixed here
# rather than parameterised — a different name would produce a spurious diff.
WASM="${AEGIS_WASM:-target/wasm32v1-none/release/aegis_authorization.wasm}"

if [[ ! -f "$WASM" ]]; then
  echo "wasm not found at $WASM — building it"
  # -p is required: aegis-canonical is a std crate, so a workspace-wide build
  # against this bare-metal target fails on `can't find crate for std`.
  cargo build -p aegis-authorization --target wasm32v1-none --release
fi

stellar contract bindings typescript \
  --wasm "$WASM" \
  --output-dir "$OUT_DIR" \
  --overwrite

echo "bindings generated from $WASM"

# The generated package does not match this workspace out of the box:
#   - it is named "bindings", but the code imports "@aegis/bindings"
#   - it pins its own TypeScript, while the repo is on the root toolchain
#   - its tsconfig leaves rootDir unset, which TS 7 rejects (TS5011)
#   - its README is the stock Soroban template, which is wrong for this repo
#   - it drops a .gitignore that the root .gitignore already owns
# Patch all of them so `pnpm -r build` succeeds and the tree stays byte-stable.
# Re-applied on every regeneration.
# --input-type=module: the block below is ESM, and `node -` only infers that
# from syntax detection on recent Node. Be explicit so any Node >= 20 works.
node --input-type=module - <<'PATCH'
import { rmSync, readFileSync, writeFileSync } from "node:fs";

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

// The generated README is the stock Soroban template: it tells the reader to
// `npm publish` this package and to import from "bindings", and it quotes a
// generation command with a hard-coded contract ID. None of that is true here.
writeFileSync(
  "packages/bindings/README.md",
  `# @aegis/bindings

TypeScript bindings for the \`aegis-authorization\` Soroban contract.

**Generated, and committed.** Do not hand-edit anything in this package — the
next regeneration overwrites it. Edit the contract instead, then regenerate.

## Regenerate

\`\`\`bash
pnpm bindings
\`\`\`

That builds \`contracts/authorization\` to wasm if needed and runs
\`stellar contract bindings typescript --wasm …\` over the local artifact. It
needs no network, no deployed contract and no \`CONTRACT_ID\`.

\`--overwrite\` replaces this directory wholesale, so it also removes the
locally linked \`node_modules/\`. Run \`pnpm install\` afterwards to relink.

CI enforces this: the \`bindings-drift\` job rebuilds the wasm from source,
re-runs the generator and fails on \`git diff --exit-code packages/bindings/\`.
So a contract change that is not accompanied by regenerated bindings turns CI
red before it can turn into a runtime error.

## Use

Generating from the wasm rather than from a deployed contract means this
package exports no \`networks\` block and embeds no contract address. Supply
\`contractId\`, \`rpcUrl\` and \`networkPassphrase\` from the environment:

\`\`\`ts
import { Client } from "@aegis/bindings";

const client = new Client({
  contractId: process.env.CONTRACT_ID!,
  rpcUrl: process.env.STELLAR_RPC_URL!,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE!,
});
\`\`\`

See \`.env.example\` for the variable names.
`,
);

// The generator drops its own .gitignore (node_modules/, out/). The root
// .gitignore owns the ignore rules for this package, so remove it and keep the
// committed tree to exactly what the generator produces as source.
rmSync("packages/bindings/.gitignore", { force: true });

console.log("patched packages/bindings -> @aegis/bindings (rootDir ./src, README, .gitignore)");
PATCH
