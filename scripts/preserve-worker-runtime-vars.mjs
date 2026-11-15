import { readFileSync, writeFileSync } from "node:fs";

// Nitro generates the production deployment configuration under .output.
// Dashboard values must survive source-code deployments, including Supabase public vars.
const path = ".output/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
if (config.name !== "snoop-pilot") throw new Error("Unexpected Cloudflare Worker target");
config.keep_vars = true;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
console.log("Cloudflare dashboard runtime variables will be preserved");
