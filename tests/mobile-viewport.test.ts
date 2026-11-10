import test from "node:test";
import assert from "node:assert/strict";
import { focusedFieldDelta, keyboardGeometry } from "../src/lib/mobile-viewport.ts";
test("focused fields move minimally, with a stable zero delta once visible", () => {
  assert.equal(focusedFieldDelta(12, 280, 250, 290), 10);
  assert.equal(focusedFieldDelta(12, 280, 240, 280), 0);
  assert.equal(focusedFieldDelta(12, 280, 2, 30), -10);
  assert.equal(focusedFieldDelta(12, 280, 50, 400), 38);
  assert.equal(focusedFieldDelta(12, 280, NaN, 100), 0);
});
test("keyboard geometry handles overlay, content resize, pan and pinch without disabling zoom", () => {
  assert.equal(keyboardGeometry(844, 844, 300, 0, true).open, true);
  assert.equal(keyboardGeometry(844, 450, 450, 0, true).open, true);
  assert.equal(keyboardGeometry(844, 844, 844, 0, true).open, false);
  assert.equal(keyboardGeometry(844, 844, 300, 0, false).open, false);
  assert.equal(keyboardGeometry(844, 844, 422, 0, true, 2).open, false);
  assert.deepEqual(keyboardGeometry(844, 844, 300, 20, true), { open: true, top: 32, bottom: 300 });
});
