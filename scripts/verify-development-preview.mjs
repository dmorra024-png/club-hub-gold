import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import process from "node:process";

const origin = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname));
const fixture = new URL("../.sandbox/dev-access-check.json", import.meta.url);
await mkdir(new URL("../.sandbox/", import.meta.url), { recursive: true });
await writeFile(fixture, '{"synthetic_access_check":true}', { flag: "wx", mode: 0o600 });
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
  headless: true,
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const response = await page.goto(new URL("/auth", origin).href, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.locator('input[type="email"]').waitFor();
  await page.locator('input[type="password"]').waitFor();
  assert.equal(await page.title(), "Acceso | SNOOP");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    await caches.open("clubhub-public-obsolete-dev-test");
    await caches.open("unrelated-dev-test");
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    async () =>
      !(await navigator.serviceWorker.getRegistrations()).some(
        (registration) =>
          new URL(registration.active?.scriptURL || location.href).pathname === "/sw.js",
      ) && !(await caches.keys()).some((key) => key.startsWith("clubhub-public-")),
  );
  assert.ok(await page.evaluate(async () => (await caches.keys()).includes("unrelated-dev-test")));
  const denied = await page.request.get(new URL("/.sandbox/dev-access-check.json", origin).href);
  assert.ok([403, 404].includes(denied.status()), "Sandbox files must not be served");
  await page.screenshot({ path: "/tmp/club-development-login.png", fullPage: true });
  console.log(
    "PASS real development login, mobile rendering, stale offline-worker cleanup, unrelated-cache preservation and private sandbox-file denial.",
  );
  await context.close();
} finally {
  await browser.close();
  await unlink(fixture);
}
