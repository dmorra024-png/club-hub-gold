import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, devices } from "playwright-core";
import process from "node:process";
const root = resolve(new URL("../", import.meta.url).pathname);
const work = resolve(process.env.SANDBOX_WORKDIR || join(root, ".sandbox"));
const env = Object.fromEntries(
  (await readFile(join(root, ".env.sandbox.local"), "utf8"))
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
assert.equal(env.SUPABASE_URL, "http://127.0.0.1:54321");
assert.equal(env.VITE_SUPABASE_URL, "/sandbox-api");
const credentials = JSON.parse(await readFile(join(work, "test-credentials.json"), "utf8"));
assert.equal(credentials.email, "admin.demo@example.test");
const workerBase = process.env.SNOOP_WORKER_BASE_URL
  ? new URL(process.env.SNOOP_WORKER_BASE_URL)
  : null;
if (workerBase)
  assert.ok(
    workerBase.protocol === "http:" && ["localhost", "127.0.0.1"].includes(workerBase.hostname),
  );
const app = workerBase
  ? null
  : spawn(process.execPath, [".output/server/index.mjs"], {
      cwd: root,
      env: { ...process.env, ...env, PORT: "3011", HOST: "127.0.0.1" },
      stdio: ["ignore", "ignore", "ignore"],
    });
const originalCacheVersion = /clubhub-public-(v[0-9]+)/.exec(
  await readFile(join(root, "public/sw.js"), "utf8"),
)[1];
let version = originalCacheVersion;
const sw = await readFile(join(root, "public/sw.js"), "utf8");
const proxy = createServer((req, res) => {
  if (req.url.split("?")[0] === "/sw.js") {
    res.writeHead(200, { "content-type": "application/javascript", "cache-control": "no-store" });
    res.end(sw.replace(/clubhub-public-v[0-9]+/, `clubhub-public-${version}`));
    return;
  }
  const backend = req.url.startsWith("/sandbox-api/");
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: backend ? 54321 : Number(workerBase?.port || 3011),
      path: backend ? req.url.replace("/sandbox-api", "") : req.url,
      method: req.method,
      headers: { ...req.headers, host: backend ? "127.0.0.1:54321" : req.headers.host },
    },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502).end("Local test backend unavailable");
  });
  req.pipe(upstream);
});
await new Promise((r) => proxy.listen(3012, "127.0.0.1", r));
const origin = "http://127.0.0.1:3012";
const results = [];
let browser;
async function record(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS" });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "FAIL", detail: String(e.message).slice(0, 1000) });
    console.log("FAIL " + name + ": " + String(e.message).slice(0, 300));
  }
}
try {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/auth")).ok) break;
    } catch {}
    if (i === 59) throw new Error("Local production app not ready");
    await new Promise((r) => setTimeout(r, 500));
  }
  // Existing installation test uses this actual local production build and local API proxy.
  await record(
    "PWA manifest, installability, offline and public cache (Chromium Pixel 7)",
    async () => {
      const child = spawn(process.execPath, ["scripts/test-pwa.mjs"], {
        cwd: root,
        env: { ...process.env, TEST_BASE_URL: origin },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (c) => (output += c));
      child.stderr.on("data", (c) => (output += c));
      const code = await new Promise((r) => child.on("exit", r));
      assert.equal(code, 0, output.slice(-2000));
    },
  );
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--use-fake-device-for-media-stream"],
    headless: true,
  });
  for (const device of ["Pixel 7", "iPhone 13"]) {
    const context = await browser.newContext({
      ...devices[device],
      defaultBrowserType: undefined,
      serviceWorkers: "allow",
    });
    await context.route("**/*", (r) =>
      new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
    );
    const page = await context.newPage();
    await record(`${device}: native local login and mobile administration navigation`, async () => {
      await page.goto(origin + "/auth", { waitUntil: "networkidle" });
      await page.locator("input[type=email]").fill(credentials.email);
      await page.locator("input[type=password]").fill(credentials.password);
      await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
      await page.waitForURL(origin + "/");
      await page.getByRole("heading", { name: "Associazione Demo", exact: true }).waitFor();
      await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
      await page.getByRole("link", { name: "Cuotas e ingresos", exact: true }).click();
      await page.getByRole("heading", { name: "Cuotas e ingresos", exact: true }).waitFor();
      for (const path of ["/soci/nuovo", "/soci/gestisci", "/cuotas", "/ajustes/colaboradores"]) {
        await page.goto(origin + path, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Abrir menú", exact: true }).waitFor();
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${device}: overflow at ${path}`,
        );
      }
      await mkdir(join(work, "acceptance"), { recursive: true });
      await page.screenshot({
        path: join(work, "acceptance", `${device.replaceAll(" ", "-")}.png`),
        fullPage: true,
      });
    });
    await record(`${device}: camera denial and manual member search remain usable`, async () => {
      await page.goto(origin + "/soci/gestisci", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException("Synthetic camera denied", "NotAllowedError");
        };
      });
      await page.getByRole("button", { name: "Escanear QR", exact: true }).click();
      await page.getByRole("alert").waitFor();
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page.getByPlaceholder("Buscar por nº socio, nombre, DNI o ciudad...").fill("Demo");
      assert.equal(
        await page.getByPlaceholder("Buscar por nº socio, nombre, DNI o ciudad...").inputValue(),
        "Demo",
      );
    });
    await record(`${device}: synthetic camera grant, preview and track cleanup`, async () => {
      await page.goto(origin + "/soci/gestisci", { waitUntil: "networkidle" });
      await context.grantPermissions(["camera"], { origin });
      await page.getByRole("button", { name: "Escanear QR", exact: true }).click();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("video")).some((v) =>
          v.srcObject?.getVideoTracks().some((t) => t.readyState === "live"),
        ),
      );
      await page.evaluate(() => {
        window.__syntheticCameraTracks = Array.from(document.querySelectorAll("video")).flatMap(
          (v) => v.srcObject?.getTracks() ?? [],
        );
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > visualViewport.width + 1),
        false,
        "QR dialog fits mobile viewport",
      );
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await page.waitForFunction(() =>
        window.__syntheticCameraTracks.every((t) => t.readyState === "ended"),
      );
    });
    if (device === "iPhone 13")
      await record("iPhone layout: Apple metadata and Safari installation guidance", async () => {
        assert.equal(
          await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute("content"),
          "yes",
        );
        assert.equal(await page.locator('link[rel="apple-touch-icon"]').count(), 1);
        await page.getByText("Instalar en iPhone / Installa su iPhone", { exact: true }).click();
        await page.getByText(/Safari: Compartir/).waitFor();
      });
    await record(`${device}: offline page and recovery to authenticated online app`, async () => {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
      await context.setOffline(true);
      await page.goto(origin + "/cuotas");
      await page.getByText(/Nessuna connessione/).waitFor();
      await context.setOffline(false);
      await page.goto(origin + "/cuotas", { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Cuotas e ingresos", exact: true }).waitFor();
    });
    if (device === "Pixel 7")
      await record("PWA update waits for explicit consent and preserves active form", async () => {
        await page.getByLabel("Importe (€)", { exact: true }).fill("88,88");
        version = "test-v3";
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration()).update();
        });
        await page
          .getByRole("button", { name: "Actualizar app / Aggiorna app", exact: true })
          .waitFor();
        assert.equal(await page.getByLabel("Importe (€)", { exact: true }).inputValue(), "88,88");
        page.once("dialog", (d) => d.dismiss());
        await page
          .getByRole("button", { name: "Actualizar app / Aggiorna app", exact: true })
          .click();
        assert.equal(await page.getByLabel("Importe (€)", { exact: true }).inputValue(), "88,88");
        page.once("dialog", (d) => d.accept());
        await page
          .getByRole("button", { name: "Actualizar app / Aggiorna app", exact: true })
          .click();
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
        await page.waitForFunction(
          async () => !(await navigator.serviceWorker.getRegistration()).waiting,
        );
        await page.getByRole("heading", { name: "Cuotas e ingresos", exact: true }).waitFor();
        const keys = await page.evaluate(() => caches.keys());
        assert.ok(keys.includes("clubhub-public-test-v3"));
        assert.ok(!keys.includes(`clubhub-public-${originalCacheVersion}`));
      });
    await context.close();
  }
  results.push({
    name: "Physical Android / iPhone installation, actual Safari/WebKit and hardware microphone/camera",
    status: "BLOCKED",
    detail:
      "No physical devices connected; WebKit executable absent. iPhone case is Chromium viewport/user-agent emulation, not Safari certification.",
  });
} finally {
  if (browser) await browser.close();
  app?.kill("SIGTERM");
  proxy.closeAllConnections();
  await new Promise((r) => proxy.close(r));
  await mkdir(join(work, "acceptance"), { recursive: true });
  await writeFile(join(work, "acceptance/mobile-results.json"), JSON.stringify(results, null, 2), {
    mode: 0o600,
  });
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
