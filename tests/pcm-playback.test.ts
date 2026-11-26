import { test } from "node:test";
import assert from "node:assert/strict";
import { PcmPlayback, VOICE_OUTPUT_SAMPLE_RATE, resumePlaybackForAssistantText } from "../src/lib/voice/pcm-playback.ts";
function fixture(state = "running") {
  const buffers: Float32Array[] = [],
    nodes: any[] = [],
    notices: string[] = [];
  const context: any = {
    state,
    currentTime: 0,
    destination: {},
    createBuffer: (_c: number, n: number, rate: number) => {
      assert.equal(rate, 24000);
      const data = new Float32Array(n);
      buffers.push(data);
      return { duration: n / rate, getChannelData: () => data };
    },
    createBufferSource: () => {
      const n: any = {
        connect: () => {},
        disconnect: () => {},
        start: (at: number) => {
          n.startAt = at;
        },
        stop: () => {
          n.stopped = true;
        },
      };
      nodes.push(n);
      return n;
    },
  };
  return {
    context,
    buffers,
    nodes,
    notices,
    player: new PcmPlayback(context, (n) => notices.push(n)),
  };
}
test("signed little-endian 24kHz PCM survives odd WebSocket frame boundaries exactly", () => {
  const f = fixture();
  const bytes = new Uint8Array([0, 128, 0, 192, 0, 0, 0, 64, 255, 127]);
  for (const chunk of [bytes.slice(0, 1), bytes.slice(1, 4), bytes.slice(4, 9), bytes.slice(9)])
    f.player.push(chunk.buffer);
  assert.deepEqual(
    f.buffers.flatMap((b) => Array.from(b)),
    [-1, -0.5, 0, 0.5, 32767 / 32768],
  );
  assert.equal(f.player.snapshot().decodedSamples, 5);
  assert.equal(f.player.snapshot().nonzeroSamples, 4);
  assert.equal(VOICE_OUTPUT_SAMPLE_RATE, 24000);
  for (let i = 1; i < f.nodes.length; i++) assert(f.nodes[i].startAt >= f.nodes[i - 1].startAt);
});
test("suspension before registration queues PCM; interrupted iOS context resumes the same response", () => {
  const f = fixture("interrupted");
  f.player.push(new Uint8Array([0, 64, 0, 192]).buffer);
  assert.equal(f.nodes.length, 0);
  assert.equal(f.player.snapshot().bufferedSamples, 2);
  assert(f.notices.includes("blocked"));
  f.context.state = "running";
  f.player.contextChanged();
  assert.equal(f.nodes.length, 1);
  assert.deepEqual(Array.from(f.buffers[0]), [0.5, -0.5]);
  assert.equal(f.player.snapshot().bufferedSamples, 0);
});
test("interruption clears scheduled and blocked audio; stale onended cannot claim completion", () => {
  const f = fixture();
  f.player.push(new Uint8Array([0, 64]).buffer);
  const ended = f.nodes[0].onended;
  f.player.interrupt();
  assert(f.nodes[0].stopped);
  ended();
  assert.equal(f.player.snapshot().completedSamples, 0);
  f.player.push(new Uint8Array([0, 64]).buffer);
  assert.equal(f.nodes.length, 1);
  f.player.beginResponse();
  f.player.push(new Uint8Array([0, 192]).buffer);
  assert.equal(f.nodes.length, 2);
  f.player.dispose();
  f.player.beginResponse();
  f.player.push(new Uint8Array([0, 64]).buffer);
  assert.equal(f.nodes.length, 2);
});
test("buffer is bounded while blocked and diagnostics contain no conversation or identity", () => {
  const f = fixture("suspended");
  for (let i = 0; i < 31; i++) f.player.push(new ArrayBuffer(48000));
  assert.equal(f.player.snapshot().lastError, "overflow");
  assert.equal(f.player.snapshot().bufferedSamples, 0);
  assert(f.notices.includes("overflow"));
  assert.deepEqual(
    Object.keys(f.player.snapshot()).sort(),
    [
      "receivedBytes",
      "decodedSamples",
      "nonzeroSamples",
      "scheduledSamples",
      "completedSamples",
      "bufferedSamples",
      "scheduledNodes",
      "contextState",
      "suppressed",
      "lastError",
    ].sort(),
  );
});

test("text/provider completion is never proof of audio: empty and silent responses are distinct", () => {
  const empty = fixture();
  empty.player.beginResponse();
  empty.player.finishResponse();
  assert.equal(empty.player.snapshot().lastError, "empty");
  const silent = fixture();
  silent.player.beginResponse();
  silent.player.push(new ArrayBuffer(200));
  silent.player.finishResponse();
  assert.equal(silent.player.snapshot().lastError, "silent");
  const audible = fixture();
  audible.player.beginResponse();
  audible.player.push(new Uint8Array([0, 64]).buffer);
  audible.player.finishResponse();
  assert.equal(audible.player.snapshot().lastError, null);
});

test("real provider sequence: assistant text rearms interrupted PCM without optional AgentStartedSpeaking marker", () => {
  const f = fixture();
  f.player.beginResponse();
  f.player.push(new Uint8Array([0, 64]).buffer);
  f.player.interrupt(); // UserStartedSpeaking barge-in
  assert.equal(f.player.suppressed, true);
  f.player.push(new Uint8Array([0, 64]).buffer); // old interrupted audio must not play
  resumePlaybackForAssistantText(f.player, "user");
  assert.equal(f.player.suppressed, true);
  assert.equal(f.nodes.length, 1);
  // Deepgram's assistant ConversationText is a new response even when the
  // optional AgentThinking / AgentStartedSpeaking notifications are absent.
  resumePlaybackForAssistantText(f.player, "assistant");
  assert.equal(f.player.suppressed, false);
  f.player.push(new Uint8Array([0, 64]).buffer);
  assert.equal(f.nodes.length, 2);
  assert.equal(f.player.snapshot().decodedSamples, 2);
  assert.equal(f.player.snapshot().scheduledSamples, 2);
  assert.equal(f.player.snapshot().nonzeroSamples, 2);
});
