// Copy packaged, pinned OCR runtime to this application's own HTTPS origin.
// No remote OCR CDN or paid API is needed after deployment.
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "public", "ocr");
const from = (...parts) => join(root, "node_modules", ...parts);
async function requiredCopy(source, destination) {
  const info = await stat(source);
  if (!info.isFile() || info.size < 100) throw new Error(`OCR asset missing: ${source}`);
  await copyFile(source, destination);
}
await mkdir(join(out, "core"), { recursive: true });
await mkdir(join(out, "lang"), { recursive: true });
await requiredCopy(from("tesseract.js", "dist", "tesseract.min.js"), join(out, "tesseract.min.js"));
await requiredCopy(from("tesseract.js", "dist", "worker.min.js"), join(out, "worker.min.js"));
const core = from("tesseract.js-core");
const filenames = (await readdir(core)).filter(file => /^tesseract-core.*\.wasm(?:\.js)?$/.test(file));
if (!filenames.some(f => f.endsWith(".wasm")) || !filenames.some(f => f.endsWith(".wasm.js")))
  throw new Error("Incomplete self-hosted Tesseract WASM runtime");
for (const name of filenames) await requiredCopy(join(core, name), join(out, "core", name));
await requiredCopy(
  from("@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
  join(out, "lang", "eng.traineddata.gz"),
);
console.log(`Local OCR assets ready: ${filenames.length} core files; only own-origin paths`);
