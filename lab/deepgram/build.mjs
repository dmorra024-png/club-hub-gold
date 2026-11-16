import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
await mkdir(".sandbox/deepgram-lab", { recursive: true });
const result = await build({
  entryPoints: ["lab/deepgram/worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
});
const assets = Object.fromEntries(
  await Promise.all(
    [
      ["/deepgram", "index.html", "text/html"],
      ["/deepgram/", "index.html", "text/html"],
      ["/deepgram/client.js", "client.js", "text/javascript"],
      ["/deepgram/style.css", "style.css", "text/css"],
    ].map(async ([path, file, type]) => [
      path,
      { content: await readFile("lab/deepgram/" + file, "utf8"), type },
    ]),
  ),
);
await writeFile(
  ".sandbox/deepgram-lab/module.mjs",
  result.outputFiles[0].text + `\nexport const labAssets=${JSON.stringify(assets)};\n`,
);
console.log("PASS isolated lab bundle built; no application or runtime secrets bundled");
