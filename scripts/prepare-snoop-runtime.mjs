import { readFile, writeFile, mkdir } from "node:fs/promises";
import { planRuntimeBindings } from "./lib/snoop-runtime-bindings.mjs";
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account || !/^[a-f0-9]{32}$/i.test(account))
  throw Error("Missing dedicated Cloudflare credentials");
const file = ".output/server/wrangler.json";
const config = JSON.parse(await readFile(file, "utf8"));
if (config.name !== "snoop-pilot") throw Error("Wrong Worker target");
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/snoop-pilot/settings`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
if (!response.ok)
  throw Error(
    `Cannot inspect existing SNOOP Worker bindings (HTTP ${response.status}); no resource modified`,
  );
const json = await response.json();
if (!json.success || !Array.isArray(json.result?.bindings))
  throw Error("SNOOP Worker settings unavailable");
const result = planRuntimeBindings(config, json.result.bindings, {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: process.env.SNOOP_PUBLISHABLE_KEY,
  APP_URL: process.env.APP_URL,
});
await writeFile(file, JSON.stringify(result.config, null, 2) + "\n");
await mkdir(".sandbox", { recursive: true });
await writeFile(
  ".sandbox/snoop-runtime-upload-plan.json",
  JSON.stringify({ worker: "snoop-pilot", secretNames: result.secretNames }, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  "SNOOP binding types verified; public settings prepared, private values remain in memory. Nothing deployed.",
);
