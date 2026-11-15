import { readFileSync, writeFileSync } from "node:fs";

// Nitro generates the deployed Wrangler configuration under .output/.
// Never replace Cloudflare dashboard runtime variables during source builds.
const path = ".output/server/wrangler.json";
const config = JSON.parse(readFileSync(path, "utf8"));
if (config.name !== "snoop-pilot") throw new Error("Unexpected Cloudflare Worker target");
config.keep_vars = true;
writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
console.log("Cloudflare runtime variable preservation enabled");
