import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const config = JSON.parse(await readFile(".output/server/wrangler.json", "utf8"));
const plan = JSON.parse(await readFile(".sandbox/snoop-runtime-upload-plan.json", "utf8"));
if (config.name !== "snoop-pilot" || plan.worker !== "snoop-pilot")
  throw Error("Wrong Worker target");
const allowed = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "APP_URL",
];
for (const name of plan.secretNames) {
  if (!allowed.includes(name)) throw Error("Unapproved secret name");
  const value =
    name === "SUPABASE_PUBLISHABLE_KEY" ? process.env.SNOOP_PUBLISHABLE_KEY : process.env[name];
  if (!value) throw Error("Missing runtime setting: " + name);
  const result = spawnSync(
    "npx",
    ["wrangler", "secret", "put", name, "--config", ".output/server/wrangler.json"],
    { input: value, encoding: "utf8" },
  );
  // Never echo Wrangler output or values. Public/secret binding types were
  // inspected before deployment so an existing plain variable is not overwritten.
  if (result.error || result.status !== 0)
    throw Error("SNOOP runtime upload failed for " + name + "; no retry performed");
  console.log("Protected SNOOP runtime setting updated: " + name);
}
