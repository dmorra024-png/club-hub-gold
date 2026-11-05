import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import process from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
const workdir = resolve(process.env.SANDBOX_WORKDIR || join(root, ".sandbox"));
const settings = await readFile(join(root, ".env.sandbox.local"), "utf8");
assert.ok(settings.includes("VITE_SUPABASE_URL=/sandbox-api"), "Sandbox configuration required");
const credentials = JSON.parse(await readFile(join(workdir, "test-credentials.json"), "utf8"));
assert.equal(credentials.email, "admin.demo@example.test");
const origin = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost"].includes(origin.hostname), "Local sandbox server only");
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  args: ["--no-sandbox"],
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const response = await page.goto(new URL("/auth", origin).href, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.locator('input[type="email"]').waitFor();
  const screenshots = join(workdir, "screenshots");
  await mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: join(screenshots, "login.png"), fullPage: true });
  await page.locator('input[type="email"]').fill(credentials.email);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(origin.href);
  await page.getByRole("heading", { name: "Associazione Demo", exact: true }).waitFor();
  assert.ok(!(await page.textContent("body")).includes("Nessuna connessione"));
  await page.screenshot({ path: join(screenshots, "home.png"), fullPage: true });
  console.log(
    "PASS: native local Supabase login and authenticated application home, mobile viewport; no mock backend or external requests.",
  );
  console.log(`Screenshots saved privately in ${screenshots}`);
  await context.close();
} finally {
  await browser.close();
}
