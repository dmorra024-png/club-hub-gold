import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
const require = createRequire(import.meta.url),
  { Miniflare, convertV4MiniflareOptions } = require(
    require.resolve("miniflare", { paths: [require.resolve("wrangler")] }),
  );
const code = await readFile(".sandbox/deepgram-lab/module.mjs", "utf8");
let outbound = 0;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script:
      code +
      '\nexport default {async fetch(req,env){return await labFetch(req,env)??new Response("old lab unchanged");}};',
    compatibilityDate: "2026-11-05",
    bindings: {
      DEEPGRAM_API_KEY: "FAKE_LAB_KEY_NEVER_REAL",
      VOICE_PREVIEW_KEY: "synthetic-preview-key",
    },
    outboundService: async () => {
      outbound++;
      return new Response("blocked fake provider", { status: 401 });
    },
  }),
);
const base = "https://snoop-voice-lab.dmorra024.workers.dev";
try {
  const health = await mf.dispatchFetch(base + "/deepgram/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).productionConnected, false);
  assert(!JSON.stringify([...health.headers]).includes("FAKE_LAB_KEY"));
  const old = await mf.dispatchFetch(base + "/");
  assert.equal(await old.text(), "old lab unchanged");
  const denied = await mf.dispatchFetch(base + "/deepgram/credit", {
    method: "POST",
    headers: { "x-preview-key": "wrong" },
  });
  assert.equal(denied.status, 401);
  const origin = await mf.dispatchFetch(base + "/deepgram/socket", {
    headers: { Upgrade: "websocket", Origin: "https://evil.example" },
  });
  assert.equal(origin.status, 403);
  const resp = await mf.dispatchFetch(base + "/deepgram/socket", {
    headers: { Upgrade: "websocket", Origin: base },
  });
  assert.equal(resp.status, 101);
  const ws = resp.webSocket;
  ws.accept();
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("bad auth did not close")), 3000);
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "LabClosed") {
        clearTimeout(timer);
        assert.equal(m.code, "LAB_UNAUTHORIZED");
        resolve();
      }
    });
  });
  ws.send(
    JSON.stringify({
      type: "LabStart",
      key: "wrong",
      synthetic: true,
      language: "it",
      sampleRate: 24000,
    }),
  );
  await done;
  assert.equal(outbound, 0);
  console.log(
    "PASS real Workerd: old route, health, same-origin, auth rejection, zero provider requests and no secret exposure",
  );
} finally {
  await mf.dispose();
}
