import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Match the exact public RPC name in either supported bundler serialization. */
export async function findServerFunctionId(directory, name) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw Error("SNOOP_RPC_NAME_INVALID");
  const pattern = new RegExp(
    "\\bid\\s*:\\s*([\"'`])([a-f0-9]+)\\1\\s*,\\s*name\\s*:\\s*([\"'`])" + name + "\\3",
    "g",
  );
  const ids = new Set();
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".mjs")) continue;
    const code = await readFile(join(directory, file), "utf8");
    for (const match of code.matchAll(pattern)) ids.add(match[2]);
  }
  if (ids.size !== 1) throw Error(ids.size ? "SNOOP_RPC_AMBIGUOUS" : "SNOOP_RPC_NOT_FOUND");
  return [...ids][0];
}
