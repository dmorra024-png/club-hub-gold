import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
const workflow = await readFile(".github/workflows/snoop-pilot-deploy.yml", "utf8");
const marker = "          import assert from 'node:assert/strict';";
const source = (marker + workflow.split(marker)[1].split("\n          NODE")[0])
  .split("\n")
  .map((l) => (l.startsWith("          ") ? l.slice(10) : l))
  .join("\n");
const original = JSON.parse(await readFile("wrangler.json", "utf8"));
const config = {
  ...original,
  main: "index.mjs",
  no_bundle: true,
  rules: [],
  triggers: { crons: ["*/5 * * * *"] },
};
const canary = "SYNTHETIC_PRIVATE_CANARY_MUST_NOT_APPEAR";
function bindings() {
  return [
    ...Object.entries(original.vars).map(([name, value]) => ({
      name,
      type: "plain_text",
      text: String(value),
    })),
    { name: "SUPABASE_SERVICE_ROLE_KEY", type: "secret_text" },
    { name: "SUPABASE_URL", type: "plain_text", text: "https://bnwanxbmprbymbutoths.supabase.co" },
    { name: "SUPABASE_PUBLISHABLE_KEY", type: "secret_text" },
    { name: "APP_URL", type: "plain_text", text: "https://snoop-pilot.dmorra024.workers.dev" },
    { name: "SNOOP_AI", type: "ai" },
    { name: "ASSETS", type: "assets" },
    { name: "OPAQUE_TEST_SECRET", type: "secret_key" },
  ];
}
async function proof({
  candidate = config,
  live = bindings(),
  code = source,
  account = "0cc8106f8820d22996af3aed9e081e93",
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "snoop-binding-proof-")),
    file = join(dir, "wrangler.json");
  try {
    await writeFile(file, JSON.stringify(candidate));
    const setup = `
 globalThis.fetch=async(url,options)=>{
  if(url!=='https://api.cloudflare.com/client/v4/accounts/0cc8106f8820d22996af3aed9e081e93/workers/scripts/snoop-pilot/settings'||options.method!=='GET') throw new Error('Unauthorized operation');
  return Response.json({success:true,result:{bindings:${JSON.stringify(live)}}});
 };
 `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: setup + code.replace("'.output/server/wrangler.json'", JSON.stringify(file)),
      encoding: "utf8",
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        CLOUDFLARE_API_TOKEN: canary,
        CLOUDFLARE_ACCOUNT_ID: account,
        GITHUB_REPOSITORY: "dmorra024-png/club-hub-gold",
        GITHUB_REF_NAME: "codex/stabilize-independent-club",
      },
    });
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    assert.ok(
      !output.includes(canary),
      "Diagnostic output must never include secret or assertion values",
    );
    return { status: result.status, output, config: JSON.parse(await readFile(file, "utf8")) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("regression: old allowlist rejects Nitro cron after every binding and Wrangler metadata check passes", async () => {
  const old = source.replace("'rules','triggers'", "'rules'");
  const result = await proof({ code: old });
  assert.equal(result.status, 1);
  assert.match(result.output, /unaccounted_resource_bindings":\[\]/);
  assert.match(result.output, /"stage":"config-allowlist"/);
});
test("actual workflow proves pinned Wrangler inheritance, preserves AI/assets and only removes local variable values", async () => {
  const result = await proof();
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /SNOOP_BINDINGS_PRESERVATION_OK/);
  assert.match(result.output, /"secret_values_sent":false/);
  assert.deepEqual(result.config.triggers, { crons: ["*/5 * * * *"] });
  assert.deepEqual(result.config.vars, { AI_VOICE_INTENTS_ENABLED: "true", SNOOP_AI_FREE_TIER_CONFIRMED: "true", SNOOP_AI_ASSISTANT_MODEL: "@cf/zai-org/glm-4.7-flash" });
  assert.equal(result.config.ai.binding, "SNOOP_AI");
  assert.equal(result.config.assets.binding, "ASSETS");
  assert.match(
    result.output,
    /"payload_keep_bindings":\["plain_text","json","secret_text","secret_key"\]/,
  );
});
for (const [label, triggers] of [
  ["different schedule", { crons: ["* * * * *"] }],
  ["additional cron", { crons: ["*/5 * * * *", "0 * * * *"] }],
  ["unknown trigger setting", { crons: ["*/5 * * * *"], unexpected: true }],
  ["missing cron", undefined],
])
  test("reject " + label + " without dumping values", async () => {
    const result = await proof({ candidate: { ...config, triggers } });
    assert.equal(result.status, 1);
    assert.match(result.output, /"stage":"scheduled-triggers"/);
    assert.ok(result.config.vars);
  });
test("unknown config/resources remain blocked, and diagnostics are safe even for a secret-valued mismatch", async () => {
  let result = await proof({ candidate: { ...config, unsafe: canary } });
  assert.equal(result.status, 1);
  assert.match(result.output, /"stage":"config-allowlist"/);
  result = await proof({
    live: [...bindings(), { name: "OTHER_DATABASE", type: "d1", id: canary }],
  });
  assert.equal(result.status, 1);
  assert.match(result.output, /"stage":"resource-bindings"/);
  const live = bindings();
  live.find((b) => b.name === "AI_PROVIDER").text = canary;
  result = await proof({ live });
  assert.equal(result.status, 1);
  assert.match(result.output, /"stage":"runtime-variables"/);
  result = await proof({ account: "different-account" });
  assert.equal(result.status, 1);
  assert.match(result.output, /"stage":"target-environment"/);
});
