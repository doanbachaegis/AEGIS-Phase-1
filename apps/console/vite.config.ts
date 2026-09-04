import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The built bundle is served by the GATEWAY, from `apps/console/dist`, at the
 * same origin as the API (DEPLOY.md §1). Two consequences show up here.
 *
 * **The dev server needs the same shape.** `src/aegisApi.ts` calls `/v1/...`
 * relatively, which is correct in production and would otherwise hit Vite in
 * development. The proxy below makes `pnpm dev` behave like the deployment
 * instead of requiring `VITE_AEGIS_API_URL` to be set locally.
 *
 * **There is no `public/_redirects`.** That file was Cloudflare/Netlify syntax
 * for the SPA fallback; nothing reads it now. The fallback lives in the gateway,
 * in `apps/gateway/src/staticConsole.ts`, and Vite's dev server does its own.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist" },
  server: {
    proxy: {
      "/v1": {
        target: process.env.AEGIS_DEV_GATEWAY ?? "http://127.0.0.1:8080",
        changeOrigin: false,
      },
    },
  },
});
