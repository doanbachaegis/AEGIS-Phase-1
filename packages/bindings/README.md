# @aegis/bindings

TypeScript bindings for the `aegis-authorization` Soroban contract.

**Generated, and committed.** Do not hand-edit anything in this package — the
next regeneration overwrites it. Edit the contract instead, then regenerate.

## Regenerate

```bash
pnpm bindings
```

That builds `contracts/authorization` to wasm if needed and runs
`stellar contract bindings typescript --wasm …` over the local artifact. It
needs no network, no deployed contract and no `CONTRACT_ID`.

`--overwrite` replaces this directory wholesale, so it also removes the
locally linked `node_modules/`. Run `pnpm install` afterwards to relink.

CI enforces this: the `bindings-drift` job rebuilds the wasm from source,
re-runs the generator and fails on `git diff --exit-code packages/bindings/`.
So a contract change that is not accompanied by regenerated bindings turns CI
red before it can turn into a runtime error.

## Use

Generating from the wasm rather than from a deployed contract means this
package exports no `networks` block and embeds no contract address. Supply
`contractId`, `rpcUrl` and `networkPassphrase` from the environment:

```ts
import { Client } from "@aegis/bindings";

const client = new Client({
  contractId: process.env.CONTRACT_ID!,
  rpcUrl: process.env.STELLAR_RPC_URL!,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE!,
});
```

See `.env.example` for the variable names.
