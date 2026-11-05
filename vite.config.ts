import { defineConfig, loadEnv } from "vite";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig(({ command, mode }) => {
  // Load server configuration without exposing it through Vite define.
  const env = loadEnv(mode, process.cwd(), "");
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
    server: { host: "0.0.0.0", port: 3000, strictPort: true },
  };
});
