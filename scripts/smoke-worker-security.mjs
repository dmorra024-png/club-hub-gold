import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const origin = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:8798");
assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname));
const files = await readdir(".output/server");
const file = files.find((x) => x.startsWith("__23tanstack-start-server-fn-resolver-"));
assert.ok(file);
const source = await readFile(".output/server/" + file, "utf8");
const ids = new Map(
  [...source.matchAll(/"?([a-f0-9]{64})"?:\{functionName:`([^`]+)_createServerFn_handler`/g)].map(
    (m) => [m[2], m[1]],
  ),
);
for (const name of [
  "createClub",
  "createClubAdmin",
  "listClubs",
  "listCollaborators",
  "extractMemberFields",
  "getAdministrativeAiStatus",
]) {
  assert.ok(ids.has(name), name + " has compiled handler");
  const response = await fetch(new URL("/_serverFn/" + ids.get(name), origin), {
    method: name.startsWith("list") || name === "getAdministrativeAiStatus" ? "GET" : "POST",
    headers: { "x-tsr-serverFn": "true", Accept: "application/json" },
  });
  const body = await response.text();
  assert.ok(
    body.includes("Unauthorized") || response.status === 401 || response.status === 403,
    name + ": no authentication must deny execution",
  );
  console.log("PASS unauthenticated " + name + " denied");
}
