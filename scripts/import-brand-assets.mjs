import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const names = ["snoop-logo.png", "meduza-xxiii-logo.png"];
assert.equal(
  process.argv.length,
  4,
  "Usage: node scripts/import-brand-assets.mjs /path/snoop-logo.png /path/meduza-xxiii-logo.png",
);
const root = resolve(fileURLToPath(new URL("../public/", import.meta.url)));
const planned = [];
// Validate both original exports before writing either file.
for (const [index, name] of names.entries()) {
  const metadata = JSON.parse(
    await readFile(new URL(`../src/assets/${name}.asset.json`, import.meta.url), "utf8"),
  );
  const bytes = await readFile(process.argv[index + 2]);
  assert.equal(
    bytes.length,
    metadata.size,
    `${name}: file size differs from the original asset metadata`,
  );
  assert.deepEqual(
    bytes.subarray(0, 8),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    `${name}: PNG required`,
  );
  const target = resolve(root, `.${metadata.url}`);
  assert.ok(target.startsWith(`${root}/__l5e/assets-v1/`), "Invalid asset path");
  try {
    assert.deepEqual(
      await readFile(target),
      bytes,
      "Refusing to overwrite a different existing asset",
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  planned.push({ target, bytes });
}
for (const { target, bytes } of planned) {
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(target, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    assert.deepEqual(await readFile(target), bytes, "A different asset appeared during import");
  }
}
console.log("Original brand assets imported; existing UI references preserved.");
