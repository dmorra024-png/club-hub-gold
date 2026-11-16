import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deepgramAppSocket } from "../src/lib/deepgram-app-gateway.ts";

test("Deepgram socket endpoint never intercepts unrelated application requests", async () => {
  const req = new Request("https://snoop.example.invalid/auth");
  assert.equal(await deepgramAppSocket(req, {}), null);
});

test("Deepgram app endpoint rejects cross-origin WebSocket before any provider access", async () => {
  const req = new Request("https://snoop.example.invalid/api/snoop-deepgram/socket", {
    headers: { Origin: "https://attacker.example.invalid", Upgrade: "websocket" },
  });
  const response = await deepgramAppSocket(req, {});
  assert.equal(response?.status, 403);
  assert.equal((await response?.json()).code, "ORIGIN");
});

test("Deepgram app endpoint is fail-closed without configured pilot and secret", async () => {
  const req = new Request("https://snoop.example.invalid/api/snoop-deepgram/socket", {
    headers: { Origin: "https://snoop.example.invalid", Upgrade: "websocket" },
  });
  const response = await deepgramAppSocket(req, {
    SNOOP_DEEPGRAM_PILOT_ENABLED: "false",
  });
  assert.equal(response?.status, 503);
  assert.equal((await response?.json()).code, "PILOT_OFF");
});
