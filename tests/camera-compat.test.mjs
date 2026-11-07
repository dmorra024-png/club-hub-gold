import test from "node:test";
import assert from "node:assert/strict";
import { guardQrCameraPlayback } from "../scripts/lib/camera-compat.mjs";
const source = "return function(){this.surface.play();}";
const id = "/node_modules/html5-qrcode/esm/camera/core-impl.js";
test("QR camera guard catches only a cancelled library video and reports active playback failures", async () => {
  const run = Function(guardQrCameraPlayback(source, id))();
  const events = [];
  const surface = {
    isConnected: false,
    play: () => Promise.reject(new DOMException("Cancelled", "AbortError")),
    dispatchEvent: (event) => events.push(event),
  };
  run.call({ surface, isClosed: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 0);
  surface.isConnected = true;
  surface.play = () => Promise.reject(new DOMException("Denied", "NotAllowedError"));
  run.call({ surface, isClosed: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "snoop:camera-play-error");
  assert.equal(events[0].detail.name, "NotAllowedError");
  assert.equal(guardQrCameraPlayback(source, "/src/another-project/camera.js"), null);
  assert.equal(guardQrCameraPlayback("other.play();", id), null);
});
