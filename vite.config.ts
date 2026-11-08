import { qrCameraCompatibility, guardQrCameraPlayback } from "./scripts/lib/camera-compat.mjs";
import { guardWorkerOutput } from "./scripts/lib/cloudflare-compat.mjs";
import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig(({ command, mode }) => {
  // Load server configuration without exposing it through Vite define.
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "sandbox") {
    if (
      !existsSync(".env.sandbox.local") ||
      env.VITE_SUPABASE_URL !== "/sandbox-api" ||
      !env.SUPABASE_URL
    ) {
      throw new Error(
        "Sandbox is not prepared. Run npm run sandbox:prepare; production configuration will not be used.",
      );
    }
    const backend = new URL(env.SUPABASE_URL);
    if (!["127.0.0.1", "localhost"].includes(backend.hostname) || backend.port !== "54321") {
      throw new Error("Sandbox requires the dedicated local backend on port 54321.");
    }
  }
  const cloudflare = process.env.SNOOP_RUNTIME === "cloudflare";
  if (mode === "pilot") {
    if (
      env.SNOOP_RESOURCE_NAMESPACE !== "snoop-pilot" ||
      !/^[a-z]{20}$/.test(env.SNOOP_SUPABASE_PROJECT_REF ?? "")
    )
      throw new Error(
        "Configure the dedicated SNOOP pilot project using Cloudflare build environment variables or a local .env.pilot.local.",
      );
    for (const key of ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"])
      if (!env[key] || /REPLACE_|YOUR_/.test(env[key]))
        throw new Error(`Missing dedicated SNOOP pilot setting: ${key}`);
    // A publishable key is public, but an access token, secret, or service-role
    // key must never be embedded in the browser bundle.
    if (!env.VITE_SUPABASE_PUBLISHABLE_KEY.startsWith("sb_publishable_"))
      throw new Error(
        "SNOOP pilot requires a Supabase sb_publishable_ key for the browser; do not use access tokens or private keys.",
      );
    if (env.VITE_SUPABASE_PUBLISHABLE_KEY !== env.SUPABASE_PUBLISHABLE_KEY)
      throw new Error("Browser and server must use the same dedicated SNOOP publishable key");
    const expected = `https://${env.SNOOP_SUPABASE_PROJECT_REF}.supabase.co`;
    if (
      env.VITE_SUPABASE_URL !== expected ||
      env.SUPABASE_URL !== expected ||
      !env.VITE_SUPABASE_PUBLISHABLE_KEY
    )
      throw new Error("Dedicated SNOOP project URLs/keys are missing or inconsistent");
  }
  const preview = env.DEV_PREVIEW_ORIGIN ? new URL(env.DEV_PREVIEW_ORIGIN) : undefined;
  for (const name of Object.keys(env)) {
    if (/^(SUPABASE_|AI_|EMAIL_|SNOOP_|APP_URL$)/.test(name) && process.env[name] === undefined)
      process.env[name] = env[name];
  }
  return {
    optimizeDeps: {
      rolldownOptions: {
        plugins: [
          {
            name: "snoop-qr-camera-prebundle",
            transform(code, id) {
              const guarded = guardQrCameraPlayback(code, id);
              return guarded === null ? null : { code: guarded, map: null };
            },
          },
        ],
      },
    },
    plugins: [
      qrCameraCompatibility(),
      tailwindcss(),
      tanstackStart({ server: { entry: "server" } }),
      command === "build" &&
        nitro({
          preset: cloudflare ? "cloudflare-module" : "node-server",
          ...(cloudflare
            ? {
                minify: true,
                experimental: { tasks: true },
                tasks: {
                  "snoop:mail": {
                    handler: fileURLToPath(
                      new URL("./server/tasks/snoop-mail.ts", import.meta.url),
                    ),
                  },
                },
                scheduledTasks: { "*/5 * * * *": ["snoop:mail"] },
                cloudflare: { nodeCompat: true },
                hooks: {
                  "rollup:before": (nitro) => {
                    nitro.hooks.hook("compiled", async () => {
                      await guardWorkerOutput(nitro.options.output.serverDir);
                    });
                  },
                },
              }
            : {}),
        }),
      react(),
    ],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
    },
    server: {
      fs: {
        deny: [
          ".env",
          ".env.*",
          "*.{crt,pem}",
          "**/.git/**",
          "**/.sandbox/**",
          "**/test-credentials.json",
          "**/setup.log",
        ],
      },
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
      ...(preview
        ? {
            allowedHosts: [preview.hostname],
            hmr: { clientPort: Number(preview.port || (preview.protocol === "https:" ? 443 : 80)) },
          }
        : {}),
      ...(mode === "sandbox"
        ? {
            proxy: {
              "/sandbox-api": {
                target: "http://127.0.0.1:54321",
                changeOrigin: true,
                ws: true,
                rewrite: (path: string) => path.replace(/^\/sandbox-api/, ""),
              },
            },
          }
        : {}),
    },
  };
});
