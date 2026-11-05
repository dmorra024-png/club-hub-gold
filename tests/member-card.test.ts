import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import jsQR from "jsqr";
import { memberCardAttachment } from "../src/lib/member-card.server.ts";
const require = createRequire(import.meta.url);
const { PNG } = require("pngjs") as {
  PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } };
};
test("membership QR round-trips locally as a PNG attachment without an external image service", async () => {
  const attachment = await memberCardAttachment("0000123");
  assert.equal(attachment.content_id, "member-card");
  const image = PNG.sync.read(Buffer.from(attachment.content, "base64"));
  const decoded = jsQR(new Uint8ClampedArray(image.data), image.width, image.height);
  assert.equal(decoded?.data, "SNOOP:0000123");
});
test("membership QR rejects invalid identifiers", async () => {
  for (const value of ["", "../secret", "<script>", "1234567890123"])
    await assert.rejects(memberCardAttachment(value));
});
