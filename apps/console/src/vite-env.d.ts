/// <reference types="vite/client" />

/**
 * Typed configuration surface. Every name here is read through `requireEnv` in
 * `./env.ts`, which throws at module load if a required one is missing — a
 * misconfigured deploy must fail visibly instead of rendering an empty evidence
 * page.
 *
 * Vite only substitutes STATIC `import.meta.env.VITE_*` accesses, so `env.ts`
 * reads each one by name and passes the value to the helper. Never index this
 * object with a computed key.
 */
interface ImportMetaEnv {
  /** Soroban RPC endpoint. Read directly by the browser — CORS is open on testnet. */
  readonly VITE_STELLAR_RPC_URL: string;
  /** Contains a ";", so it must stay quoted in .env files. */
  readonly VITE_STELLAR_NETWORK_PASSPHRASE: string;
  /** The AEGIS authorization contract. Every authoritative field comes from here. */
  readonly VITE_CONTRACT_ID: string;
  /** Explorer path segment; defaults to "testnet". */
  readonly VITE_STELLAR_EXPERT_NETWORK?: string;
  /** Optional: lets the console print "USDC" beside the raw SAC address. */
  readonly VITE_USDC_SAC_ADDRESS?: string;
  /** Optional: base URL of the AEGIS API. Supplies NON-authoritative display fields only. */
  readonly VITE_AEGIS_API_URL?: string;
  /** Optional: comma-separated intent references to offer as example deep links. */
  readonly VITE_SAMPLE_INTENTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
