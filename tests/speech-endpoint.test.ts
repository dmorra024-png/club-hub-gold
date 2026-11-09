import test from "node:test";
import assert from "node:assert/strict";
import { SpeechEndpoint } from "../src/lib/speech-endpoint.ts";
test("speech end requires sustained speech and then 1600ms silence", () => {
  const v = new SpeechEndpoint(0);
  assert.equal(v.sample(0.1, 100), null);
  assert.equal(v.sample(0.1, 240), null);
  assert.equal(v.sample(0, 1000), null);
  assert.equal(v.sample(0, 1840), "speech-end");
});
test("continuous speech is not cut at 12 or 15 seconds", () => {
  const v = new SpeechEndpoint(0);
  for (let t = 0; t < 59000; t += 120) assert.equal(v.sample(0.1, t), null);
  assert.equal(v.sample(0.1, 60000), "limit");
});
test("silence or a transient click never uploads an invented speech clip", () => {
  const v = new SpeechEndpoint(0);
  v.sample(0.1, 100);
  v.sample(0, 150);
  assert.equal(v.sample(0, 12000), "no-speech");
  const silent = new SpeechEndpoint(0);
  assert.equal(silent.sample(0, 12000), "no-speech");
});
test("invalid measurements cannot create a speech endpoint", () => {
  const v = new SpeechEndpoint(100);
  assert.equal(v.sample(NaN, 200), null);
  assert.equal(v.sample(0.1, NaN), null);
  assert.equal(v.sample(0.1, 0), null);
});
