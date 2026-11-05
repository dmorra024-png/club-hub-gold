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
  const preview = env.DEV_PREVIEW_ORIGIN ? new URL(env.DEV_PREVIEW_ORIGIN) : undefined;
  for (const name of Object.keys(env)) {
    if (/^(SUPABASE_|AI_|EMAIL_|APP_URL$)/.test(name) && process.env[name] === undefined)
      process.env[name] = env[name];
  }
  return {
    plugins: [
      tailwindcss(),
      tanstackStart({ server: { entry: "server" } }),
      command === "build" && nitro({ preset: "node-server" }),
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
