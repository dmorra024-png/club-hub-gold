import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
// Preparation only: does not contact Cloudflare or Supabase.
let text;
try {
  text = await readFile(".env.pilot.local", "utf8");
} catch {
  throw new Error(
    "Fill .env.pilot.local from .env.pilot.example with a dedicated SNOOP Free project first",
  );
}
const env = Object.fromEntries(
  text
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if (v.startsWith('"')) v = JSON.parse(v);
      return [l.slice(0, i), v];
    }),
);
assert.equal(env.SNOOP_RESOURCE_NAMESPACE, "snoop-pilot");
assert.match(env.SNOOP_SUPABASE_PROJECT_REF, /^[a-z]{20}$/);
const url = "https://" + env.SNOOP_SUPABASE_PROJECT_REF + ".supabase.co";
assert.equal(env.SUPABASE_URL, url);
assert.equal(env.VITE_SUPABASE_URL, url);
const app = new URL(env.APP_URL);
assert.ok(
  app.protocol === "https:" &&
    app.hostname.startsWith("snoop-pilot.") &&
    app.hostname.endsWith(".workers.dev") &&
    app.pathname === "/",
);
const output = {};
for (const k of [
  "APP_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
]) {
  assert.ok(env[k] && !env[k].startsWith("REPLACE_"), k + " is missing");
  output[k] = env[k];
}
await mkdir(".sandbox", { recursive: true });
await writeFile(".sandbox/pilot-worker-secrets.json", JSON.stringify(output, null, 2), {
  mode: 0o600,
});
console.log("Private SNOOP Worker secrets prepared locally. Nothing uploaded or deployed.");
