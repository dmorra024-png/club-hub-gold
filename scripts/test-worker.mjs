import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import process from "node:process";
const root = resolve(new URL("../", import.meta.url).pathname);
const work = resolve(process.env.SANDBOX_WORKDIR || ".sandbox");
const worker = spawn(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "dev",
    "--local",
    "--config",
    ".sandbox/wrangler-local.json",
    "--ip",
    "127.0.0.1",
    "--port",
    "8797",
  ],
  {
    cwd: root,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "ignore", "ignore"],
  },
);
const proxy = createServer((req, res) => {
  const db = req.url.startsWith("/sandbox-api/");
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: db ? 54321 : 8797,
      path: db ? req.url.replace("/sandbox-api", "") : req.url,
      method: req.method,
      headers: { ...req.headers, host: db ? "127.0.0.1:54321" : req.headers.host },
    },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502).end("Local-only test service unavailable"));
  req.pipe(upstream);
});
await new Promise((r) => proxy.listen(8798, "127.0.0.1", r));
const results = [];
async function command(name, args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: {
      ...process.env,
      SANDBOX_WORKDIR: work,
      TEST_BASE_URL: "http://127.0.0.1:8798",
      SNOOP_TEST_MANUAL_INVITES: "true",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  const code = await new Promise((r) => child.on("exit", r));
  await writeFile(join(work, "acceptance", name + ".log"), output, { mode: 0o600 });
  results.push({ name, status: code === 0 ? "PASS" : "FAIL", exit_code: code });
  console.log(`${code === 0 ? "PASS" : "FAIL"} ${name}`);
}
try {
  await mkdir(join(work, "acceptance"), { recursive: true });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8798/auth")).ok) break;
    } catch {}
    if (i === 79) throw new Error("Worker failed to serve login");
    await new Promise((r) => setTimeout(r, 500));
  }
  await command("workerd-security", ["scripts/smoke-worker-security.mjs"]);
  await command("workerd-administration", ["scripts/test-native-administration.mjs"]);
  await command("workerd-mobile", ["scripts/test-mobile-administration.mjs"], {
    SNOOP_WORKER_BASE_URL: "http://127.0.0.1:8797",
  });
  // A static public-asset route must not expose private dev.vars/configuration.
  for (const path of ["/.env.sandbox.local", "/.dev.vars", "/.sandbox/.dev.vars"]) {
    const response = await fetch("http://127.0.0.1:8798" + path);
    assert.ok(response.status >= 400, `${path} must not be public`);
  }
  results.push({ name: "Private configuration inaccessible", status: "PASS" });
} finally {
  worker.kill("SIGTERM");
  proxy.closeAllConnections();
  await new Promise((r) => proxy.close(r));
  await mkdir(join(work, "acceptance"), { recursive: true });
  await writeFile(join(work, "acceptance/worker-results.json"), JSON.stringify(results, null, 2), {
    mode: 0o600,
  });
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
