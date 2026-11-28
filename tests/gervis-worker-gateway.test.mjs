import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

/**
 * Runs the existing real Workerd gateway against a synthetic Deepgram
 * WebSocket and synthetic Supabase responses. No production credentials,
 * network requests to real services, or live writes are permitted.
 */
test("Gervis natural coworker utterance opens the real target through the gateway and survives the next turn", () => {
  const result = spawnSync(process.execPath, [
    "scripts/test-deepgram-app-worker.mjs",
    "--gervis",
    "--close-retry",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, CI: "true" },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0,
    "Gervis Workerd synthetic gateway failed:\n" +
    (result.stdout || "").slice(-5000) + "\n" + (result.stderr || "").slice(-7000));
  assert.match(result.stdout, /PASS isolated Workerd gateway/);
});
