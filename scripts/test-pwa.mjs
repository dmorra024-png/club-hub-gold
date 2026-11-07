import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright-core";
import process from "node:process";

const origin = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3001");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname), "Local test server only");
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const profile = await mkdtemp(join(tmpdir(), "clubhub-pwa-test-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
  ...devices["Pixel 7"],
  serviceWorkers: "allow",
});
try {
  // No requests to real Supabase or other third parties during browser tests.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("/auth", origin).href, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => "serviceWorker" in navigator && navigator.serviceWorker.controller !== null,
  );
  await page.evaluate(() => navigator.serviceWorker.ready);
  const session = await context.newCDPSession(page);
  const { errors: manifestErrors, data } = await session.send("Page.getAppManifest");
  assert.deepEqual(manifestErrors, [], "Manifest validation");
  const manifest = JSON.parse(data);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/auth");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
  const { installabilityErrors } = await session.send("Page.getInstallabilityErrors");
  assert.deepEqual(installabilityErrors, [], "Chromium installation criteria");
  for (const icon of manifest.icons) {
    if (icon.type === "image/svg+xml") {
      assert.equal(icon.sizes, "any", "Vector icons must advertise arbitrary sizes");
      const valid = await page.evaluate(async (src) => {
        const response = await fetch(src);
        if (!response.ok) return false;
        const document = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
        return (
          document.documentElement.tagName.toLowerCase() === "svg" &&
          !document.querySelector("parsererror") &&
          !!document.documentElement.getAttribute("viewBox")
        );
      }, icon.src);
      assert.ok(valid, "SVG icon is well-formed and has a viewBox");
      continue;
    }
    const dimensions = await page.evaluate(async (src) => {
      const image = await createImageBitmap(await (await fetch(src)).blob());
      return `${image.width}x${image.height}`;
    }, icon.src);
    assert.equal(dimensions, icon.sizes);
  }
  assert.ok(await page.locator('input[type="email"]').isVisible(), "Login renders after hydration");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "Mobile viewport fits",
  );
  // Exercise install prompt UI without installing anything on the host.
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt: async () => {},
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Instalar app / Installa app" }).click();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt");
    Object.assign(event, {
      prompt: async () => {
        throw new Error("Synthetic unavailable prompt");
      },
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    });
    window.dispatchEvent(event);
  });
  await page.getByRole("button", { name: "Instalar app / Installa app" }).click();
  await page
    .getByRole("button", { name: "Instalar app / Installa app" })
    .waitFor({ state: "hidden" });
  await context.setOffline(true);
  await page.goto(new URL("/soci/gestisci", origin).href);
  assert.ok((await page.textContent("body")).includes("Nessuna connessione"), "Offline fallback");
  const cached = await page.evaluate(async () => {
    const entries = [];
    for (const key of await caches.keys()) {
      if (key.startsWith("clubhub-public-"))
        entries.push(
          ...(await (await caches.open(key)).keys()).map((entry) => new URL(entry.url).pathname),
        );
    }
    return entries.sort();
  });
  assert.deepEqual(
    cached,
    [
      "/icons/app-192.png",
      "/icons/app-512.png",
      "/icons/app-maskable-512.png",
      "/icons/snoop-commercial.svg",
      "/manifest.webmanifest",
      "/offline.html",
    ].sort(),
    "No private resources cached",
  );
  assert.deepEqual(errors, [], "No JavaScript page errors");
  console.log(
    "PASS PWA: mobile hydration, manifest, installability, icons, prompt, offline fallback and public-only cache",
  );
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
