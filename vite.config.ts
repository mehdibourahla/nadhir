import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type Plugin } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// maplibre resolves its worker as a sibling of its own chunk URL, which no
// bundler step emits; without it tiles are never parsed and the map stays blank
function maplibreWorkerAsset(): Plugin {
  return {
    name: "maplibre-worker-asset",
    apply: "build",
    generateBundle(_options, bundle) {
      if (!Object.keys(bundle).some((f) => f.startsWith("assets/"))) return;
      const require = createRequire(import.meta.url);
      // the worker imports ./maplibre-gl-shared.mjs, so both must sit together
      for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
        this.emitFile({
          type: "asset",
          fileName: `assets/${name}`,
          source: readFileSync(require.resolve(`maplibre-gl/dist/${name}`)),
        });
      }
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  server: { host: "::", port: 8080, strictPort: true },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
    // only the Workers runtime has this module; dev gets bindings-free stand-ins
    alias:
      command === "serve"
        ? {
            "cloudflare:workers": fileURLToPath(
              new URL("./src/lib/cloudflare-workers.dev.ts", import.meta.url),
            ),
          }
        : {},
  },
  build: { rolldownOptions: { external: [/^cloudflare:/] } },
  // maplibre spawns its worker from a sibling file the dep optimizer does not emit,
  // which silently breaks GeoJSON sources (fire layers never render)
  optimizeDeps: { exclude: ["maplibre-gl"] },
  plugins: [
    maplibreWorkerAsset(),
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart({
      // TanStack Start's bundled server entry is redirected to src/server.ts (our SSR error wrapper)
      server: { entry: "server" },
      ...(mode === "native"
        ? { spa: { enabled: true, prerender: { outputPath: "/index" } } }
        : {}),
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    ...(command === "build" && mode !== "native"
      ? [
          nitro({
            preset: "cloudflare-module",
            plugins: ["./src/lib/source-scheduler.plugin.server.ts"],
            cloudflare: {
              nodeCompat: true,
              deployConfig: true,
              exports: "./src/exports.cloudflare.ts",
              wrangler: {
                name: "nadhir",
                compatibility_date: "2026-08-31",
                compatibility_flags: ["global_fetch_strictly_public"],
                triggers: { crons: ["* * * * *"] },
                vars: {
                  NADHIR_APP_URL: "https://nadhir.app",
                  ...(process.env["GITHUB_SHA"]
                    ? { NADHIR_CODE_REVISION: process.env["GITHUB_SHA"] }
                    : {}),
                },
                // paid default is 50ms, which React SSR over 1536 communes exceeds
                limits: { cpu_ms: 30000 },
                // SSR makes several Supabase round-trips, so run near the database
                placement: { mode: "smart" },
                browser: { binding: "BROWSER" },
                // the one owner of the rotating Codex login and its pause state
                durable_objects: {
                  bindings: [{ name: "CODEX_LOGIN", class_name: "CodexLogin" }],
                },
                migrations: [
                  { tag: "codex-login-v1", new_sqlite_classes: ["CodexLogin"] },
                ],
                observability: { enabled: true, head_sampling_rate: 1 },
                routes: [
                  { pattern: "nadhir.app", custom_domain: true },
                  { pattern: "www.nadhir.app", custom_domain: true },
                ],
              },
            },
          }),
        ]
      : []),
    viteReact(),
  ],
}));
