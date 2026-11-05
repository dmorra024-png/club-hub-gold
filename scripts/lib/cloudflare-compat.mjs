import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
// Nitro already guards the non-minified form. Rolldown's shared runtime aliases
// createRequire, which escapes that guard; Workers has no import.meta.url.
export function guardWorkerRequire(source) {
  const match = source.match(
    /import\s*\{\s*createRequire\s+as\s+([\w$]+)\s*\}\s*from\s*["']node:module["']/,
  );
  const names = ["createRequire", ...(match ? [match[1]] : [])];
  for (const name of names)
    source = source.replaceAll(
      `${name}(import.meta.url)`,
      `${name}(import.meta.url || "file:///snoop-worker.mjs")`,
    );
  return source;
}
export async function guardWorkerOutput(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await guardWorkerOutput(path);
    else if (entry.name.endsWith(".mjs")) {
      const source = await readFile(path, "utf8");
      const next = guardWorkerRequire(source);
      if (next !== source) await writeFile(path, next);
    }
  }
}
