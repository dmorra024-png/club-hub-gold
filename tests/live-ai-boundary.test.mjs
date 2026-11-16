import test from "node:test";
import assert from "node:assert/strict";
import { liveSnoopClient } from "../scripts/check-live-snoop-ai.mjs";

test("live synthetic check cannot select other accounts/models, redirect credentials, or retry", async () => {
  const calls = [],
    events = [];
  const client = liveSnoopClient(
    "SYNTHETIC_TOKEN",
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({ success: true, result: { text: "Synthetic" } });
    },
    events,
  );
  assert.throws(() => client.run("paid-or-unknown", {}), /MODEL_NOT_ALLOWED/);
  assert.equal(calls.length, 0);
  await client.settings();
  await client.run("@cf/openai/whisper-large-v3-turbo", { audio: "YQ==", language: "es" });
  assert.equal(
    calls[0].url,
    "https://api.cloudflare.com/client/v4/accounts/0cc8106f8820d22996af3aed9e081e93/workers/scripts/snoop-pilot/settings",
  );
  for (const call of calls) {
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.init.headers.Authorization, "Bearer SYNTHETIC_TOKEN");
  }
  assert.ok(!JSON.stringify(events).includes("SYNTHETIC_TOKEN"));
  while (calls.length < 12) await client.settings();
  await assert.rejects(client.settings(), /REQUEST_BUDGET/);
  assert.equal(calls.length, 12);
});
test("live access failures expose HTTP/codes only, never provider messages or token values", async () => {
  let count = 0;
  const events = [];
  const client = liveSnoopClient(
    "SYNTHETIC_TOKEN",
    async () => {
      count++;
      return Response.json(
        { success: false, errors: [{ code: 10000, message: "PRIVATE_PROVIDER_PAYLOAD" }] },
        { status: 403 },
      );
    },
    events,
  );
  await assert.rejects(
    client.models(),
    (error) => error.message === "SNOOP_LIVE_MODELS_CATALOGUE_HTTP_403",
  );
  assert.equal(count, 1);
  assert.deepEqual(events[0].errorCodes, [10000]);
  assert.ok(!JSON.stringify(events).includes("PRIVATE_PROVIDER_PAYLOAD"));
  assert.ok(!JSON.stringify(events).includes("SYNTHETIC_TOKEN"));
  assert.throws(() => liveSnoopClient(""), /TOKEN_UNAVAILABLE/);
});
