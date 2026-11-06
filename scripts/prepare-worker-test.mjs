import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const config = JSON.parse(await readFile("wrangler.json", "utf8"));
assert.equal(config.name, "snoop-pilot");
const text = await readFile(".env.sandbox.local", "utf8");
const env = Object.fromEntries(
  text
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
assert.equal(env.SUPABASE_URL, "http://127.0.0.1:54321");
assert.equal(env.VITE_SUPABASE_URL, "/sandbox-api");
delete config.ai; // Workers AI inference is remote; the local test must never invoke it.
config.name = "snoop-local-only";
config.main = resolve(".output/server/index.mjs");
config.assets.directory = resolve(".output/public");
config.workers_dev = false;
await mkdir(".sandbox", { recursive: true });
await writeFile(".sandbox/wrangler-local.json", JSON.stringify(config, null, 2), { mode: 0o600 });
await writeFile(
  ".sandbox/.dev.vars",
  Object.entries({
    ...env,
    APP_URL: "http://127.0.0.1:8798",
    AI_EXTERNAL_PROCESSING_ENABLED: "false",
  })
    .filter(([key]) => /^(SUPABASE_|APP_URL|AI_)/.test(key))
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Local-only Worker configured. AI binding removed; no cloud resources or credentials printed.",
);
