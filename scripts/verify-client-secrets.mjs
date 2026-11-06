import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
// Supports both the original local sandbox and the isolated CI pilot build.
// In CI the sensitive values arrive from GitHub Secrets and must never be logged.
let settings = {};
try {
  settings = Object.fromEntries(
    (await readFile(".env.sandbox.local", "utf8"))
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
} catch (error) {
  if (error?.code !== "ENOENT" || process.env.CI !== "true") throw error;
}
if (Object.keys(settings).length) {
  assert.equal(settings.SUPABASE_URL, "http://127.0.0.1:54321");
} else {
  assert.equal(process.env.SNOOP_RESOURCE_NAMESPACE, "snoop-pilot");
  assert.equal(process.env.SNOOP_SUPABASE_PROJECT_REF, "bnwanxbmprbymbutoths");
}
const forbidden = [
  settings.SUPABASE_SERVICE_ROLE_KEY,
  settings.AI_API_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.CLOUDFLARE_API_TOKEN,
  "synthetic-local-ai-key",
].filter((v) => typeof v === "string" && v.length > 8);
let checked = 0;
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(js|json|map|html)$/.test(entry.name)) {
      const text = await readFile(path, "utf8");
      for (const secret of forbidden)
        assert.ok(!text.includes(secret), "Server secret exposed in client artifact");
      assert.ok(
        !text.includes("Lovable-API-Key"),
        "Legacy gateway authentication in public artifact",
      );
      checked++;
    }
  }
}
await scan(".output/public");
assert.ok(checked > 0);
console.log(`PASS ${checked} public artifacts contain no local service-role / AI test secrets`);
