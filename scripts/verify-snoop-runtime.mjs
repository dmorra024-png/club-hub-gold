import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
const account = "0cc8106f8820d22996af3aed9e081e93",
  origin = "https://snoop-pilot.dmorra024.workers.dev";
try {
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, account);
  assert.ok(process.env.CLOUDFLARE_API_TOKEN);
  const config = JSON.parse(await readFile(".output/server/wrangler.json", "utf8"));
  assert.equal(config.name, "snoop-pilot");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/snoop-pilot/settings`,
    {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "Cache-Control": "no-cache",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  const result = await response.json();
  assert.ok(response.ok && result.success && Array.isArray(result.result.bindings));
  const bindings = new Map(result.result.bindings.map((b) => [b.name, b]));
  for (const name of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_URL"])
    assert.ok(["plain_text", "secret_text"].includes(bindings.get(name)?.type));
  for (const entry of config.unsafe?.bindings ?? [])
    assert.ok(["plain_text", "json"].includes(bindings.get(entry.name)?.type));
  assert.equal(bindings.get("SUPABASE_SERVICE_ROLE_KEY")?.type, "secret_text");
  assert.equal(bindings.get("SNOOP_AI")?.type, "ai");
  assert.equal(bindings.get("ASSETS")?.type, "assets");
  assert.equal(bindings.get("AI_PERSONAL_DATA_PROCESSING_ENABLED")?.text, "false");
  const files = await readdir(".output/server/_ssr");
  const code = await readFile(
    ".output/server/_ssr/" + files.find((n) => /^voice-agent.functions-.*\.mjs$/.test(n)),
    "utf8",
  );
  const id = code.match(/id:`([a-f0-9]+)`,name:`getAdministrativeAiStatus`/)[1];
  const probe = await fetch(origin + "/_serverFn/" + id, {
    headers: { "x-tsr-serverFn": "true", "Cache-Control": "no-cache" },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const body = await probe.text();
  assert.ok(body.includes("Unauthorized: No authorization header provided"));
  assert.ok(!body.includes("Missing Supabase"));
  console.log(
    JSON.stringify({
      SNOOP_RUNTIME_VERIFIED: true,
      worker: "snoop-pilot",
      required_bindings_present: true,
      private_data_processing: false,
      unauthenticated_voice_denied: true,
      real_audio_test: false,
    }),
  );
} catch {
  console.error(
    "SNOOP_RUNTIME_VERIFICATION_FAILED: no values logged; do not retry deployment automatically.",
  );
  process.exitCode = 1;
}
