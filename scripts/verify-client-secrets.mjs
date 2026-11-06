import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
const settings = Object.fromEntries(
  (await readFile(".env.sandbox.local", "utf8"))
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
assert.equal(settings.SUPABASE_URL, "http://127.0.0.1:54321");
const forbidden = [
  settings.SUPABASE_SERVICE_ROLE_KEY,
  settings.AI_API_KEY,
  "synthetic-local-ai-key",
].filter(Boolean);
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
