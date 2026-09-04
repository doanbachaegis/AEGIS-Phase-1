import { defineConfig } from "drizzle-kit";

/**
 * Migrations are GENERATED and COMMITTED, never applied by the server at boot.
 *
 * The gateway must start with no database at all (see `src/db/store.ts`), so it
 * cannot own schema migration: a process that migrates on boot cannot also boot
 * without one. `pnpm --filter @aegis/gateway db:migrate` is an explicit,
 * operator-run step against a provisioned instance.
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/aegis",
  },
  strict: true,
  verbose: true,
});
