import { test } from "node:test";
import assert from "node:assert/strict";
import { planRuntimeBindings } from "../scripts/lib/snoop-runtime-bindings.mjs";
const values = {
  SUPABASE_URL: "https://bnwanxbmprbymbutoths.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic",
  APP_URL: "https://snoop-pilot.dmorra024.workers.dev",
};
test("runtime plan preserves existing secret types and never serializes private values", () => {
  const result = planRuntimeBindings(
    { name: "snoop-pilot", vars: {} },
    [
      { name: "SUPABASE_SERVICE_ROLE_KEY", type: "secret_text" },
      { name: "SUPABASE_URL", type: "secret_text" },
      { name: "APP_URL", type: "plain_text" },
    ],
    values,
  );
  assert.deepEqual(result.secretNames, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
  assert.equal(result.config.vars.SUPABASE_URL, undefined);
  assert.equal(result.config.vars.APP_URL, values.APP_URL);
  assert.equal(result.config.vars.SUPABASE_SERVICE_ROLE_KEY, undefined);
});
test("public bindings are updated as variables without secret-put name collisions", () => {
  const result = planRuntimeBindings(
    { name: "snoop-pilot", vars: {} },
    [
      { name: "SUPABASE_URL", type: "plain_text" },
      { name: "APP_URL", type: "plain_text" },
      { name: "SUPABASE_PUBLISHABLE_KEY", type: "plain_text" },
    ],
    values,
  );
  assert.deepEqual(result.secretNames, ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.equal(result.config.vars.SUPABASE_URL, values.SUPABASE_URL);
});
test("wrong Worker/database/origin and unsafe private binding types fail closed", () => {
  assert.throws(() => planRuntimeBindings({ name: "another-worker" }, [], values));
  assert.throws(() =>
    planRuntimeBindings({ name: "snoop-pilot" }, [], {
      ...values,
      SUPABASE_URL: "https://other.invalid",
    }),
  );
  assert.throws(() =>
    planRuntimeBindings({ name: "snoop-pilot" }, [], {
      ...values,
      APP_URL: "https://other.invalid",
    }),
  );
  assert.throws(
    () =>
      planRuntimeBindings(
        { name: "snoop-pilot" },
        [{ name: "SUPABASE_SERVICE_ROLE_KEY", type: "plain_text" }],
        values,
      ),
    /protected Worker secret/,
  );
});

test("deploy configuration enables voice only and keeps documents/personal text/browser recognition off", async () => {
  const { readFile } = await import("node:fs/promises");
  const config = JSON.parse(await readFile(new URL("../wrangler.json", import.meta.url), "utf8"));
  assert.equal(config.name, "snoop-pilot");
  assert.equal(config.ai.binding, "SNOOP_AI");
  assert.equal(config.vars.AI_PROVIDER, "cloudflare");
  assert.equal(config.vars.AI_EXTERNAL_PROCESSING_ENABLED, "true");
  assert.equal(config.vars.AI_VOICE_PROCESSING_ENABLED, "true");
  assert.equal(config.vars.AI_VOICE_ONLY, "true");
  for (const name of [
    "AI_PERSONAL_DATA_PROCESSING_ENABLED",
    "AI_DOCUMENT_PROCESSING_ENABLED",
    "AI_BROWSER_SPEECH_ENABLED",
  ])
    assert.equal(config.vars[name], "false");
  assert.equal(config.vars.AI_CF_TRANSCRIBE_MODEL, "@cf/openai/whisper-large-v3-turbo");
});
