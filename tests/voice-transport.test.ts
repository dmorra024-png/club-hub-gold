import assert from "node:assert/strict";
import { test } from "node:test";
import { VoiceTransport } from "../src/lib/voice/transport.ts";
class Socket {
  readyState = 1;
  bufferedAmount = 0;
  binaryType = "";
  sent: any[] = [];
  closed = false;
  onopen: any;
  onmessage: any;
  onerror: any;
  onclose: any;
  send(v: any) {
    this.sent.push(v);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  emit(value: any) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
function rig() {
  const sockets: Socket[] = [],
    phases: string[] = [],
    errors: string[] = [],
    messages: any[] = [];
  let foreground = true,
    auth = 0;
  const t = new VoiceTransport({
    url: "wss://synthetic.invalid/socket",
    sampleRate: 24000,
    payload: async () => ({ type: "AppStart", token: "synthetic-" + ++auth }),
    foreground: () => foreground,
    message: (x) => messages.push(x),
    binary: () => {},
    phase: (p) => phases.push(p),
    fatal: (e) => errors.push(e),
    socketFactory: () => {
      const s = new Socket();
      sockets.push(s);
      return s as any;
    },
  });
  return {
    t,
    sockets,
    phases,
    errors,
    messages,
    background: () => {
      foreground = false;
    },
  };
}
test("voice transport retains one socket across consecutive commands and confirms explicit stop", async () => {
  const r = rig();
  await r.t.start();
  const s = r.sockets[0];
  s.onopen();
  s.emit({ type: "AppReady" });
  for (let n = 0; n < 20; n++) {
    r.t.capture(new ArrayBuffer(4800));
    s.emit({ type: "ConversationText", role: "user", content: "synthetic " + n });
  }
  assert.equal(r.sockets.length, 1);
  assert.equal(s.sent.filter((x) => x instanceof ArrayBuffer).length, 20);
  assert.equal(r.messages.length, 21);
  r.t.stop();
  assert(s.closed);
  assert(s.sent.includes("STOP"));
  s.emit({ type: "ConversationText" });
  assert.equal(r.messages.length, 21);
});
test("idle pauses network and resumes on local speech with ephemeral context and refreshed auth", async () => {
  const r = rig();
  await r.t.start();
  const first = r.sockets[0];
  first.onopen();
  first.emit({ type: "AppReady" });
  first.emit({ type: "AppCheckpoint", token: "encrypted-context", sequence: 1 });
  first.emit({ type: "AppClosed", code: "IDLE_PAUSED" });
  assert(first.closed);
  r.t.capture(new ArrayBuffer(4800));
  assert.equal(r.sockets.length, 1);
  const voice = new Int16Array(7200).fill(3000).buffer;
  r.t.capture(voice);
  await tick();
  const second = r.sockets[1];
  assert(second);
  second.onopen();
  const a = JSON.parse(second.sent[0]);
  assert.equal(a.resume, "encrypted-context");
  assert.equal(a.token, "synthetic-2");
  second.emit({ type: "AppReady" });
  assert(second.sent.some((x) => x instanceof ArrayBuffer));
  first.emit({ type: "AppError" });
  assert.equal(r.errors.length, 0);
  r.t.stop();
  assert.equal(r.t.checkpoint, undefined);
});
test("background and slow-connection buffers never silently apply partial speech", async () => {
  const r = rig();
  await r.t.start();
  r.background();
  r.t.capture(new ArrayBuffer(4800));
  assert.equal(r.sockets[0].sent.length, 0);
  r.t.stop();
  const slow = rig();
  await slow.t.start();
  slow.t.capture(new ArrayBuffer(24000 * 2 * 9));
  assert.deepEqual(slow.errors, ["SPEECH_BUFFER_FULL"]);
  assert(slow.sockets[0].closed);
});
