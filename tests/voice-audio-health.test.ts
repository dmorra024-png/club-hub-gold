import { test } from "node:test";
import assert from "node:assert/strict";
import { CaptureHealth, ServerAudioHealth } from "../src/lib/voice/audio-health.ts";
test("audio health distinguishes missing frames, muted input, processor crash and ordinary silence without storing audio", () => {
  const h = new CaptureHealth(0);
  assert.equal(h.fault(true, false, 4000), null);
  assert.equal(h.fault(true, false, 6000), "CAPTURE_NO_FRAMES");
  assert(h.record(new ArrayBuffer(4096), 6000));
  assert.equal(h.fault(true, false, 6100), null);
  assert.equal(h.fault(true, true, 6100), "MICROPHONE_MUTED");
  assert.equal(h.fault(false, false, 6100), "AUDIO_CONTEXT_BLOCKED");
  const signal = new Int16Array([0, -300, 500, 0]).buffer;
  assert(h.record(signal, 6200));
  assert.equal(h.snapshot().nonzeroFrames, 1);
  assert.equal(h.snapshot().frames, 2);
  assert(!h.record(new ArrayBuffer(3), 6300));
  assert.equal(h.snapshot().invalidFrames, 1);
  h.processorFailed();
  assert.equal(h.fault(true, false, 6400), "AUDIO_PROCESSOR_ERROR");
  assert.deepEqual(Object.keys(h.snapshot()).sort(), [
    "bytes",
    "frames",
    "invalidFrames",
    "nonzeroFrames",
    "processorErrors",
  ]);
});
test("wire diagnostics reject arbitrary text, identities, negative or unbounded counters", () => {
  const packet = {
    type: "AppAudioHealth",
    inputFrames: 1,
    inputBytes: 4096,
    forwardedInputBytes: 4096,
    outputFrames: 1,
    outputBytes: 2400,
    providerUserMessages: 1,
    providerAssistantMessages: 1,
  };
  assert(ServerAudioHealth.safeParse(packet).success);
  for (const change of [
    { token: "forbidden" },
    { transcript: "forbidden" },
    { club: "forbidden" },
    { inputBytes: -1 },
    { inputFrames: Infinity },
  ])
    assert(!ServerAudioHealth.safeParse({ ...packet, ...change }).success);
});
