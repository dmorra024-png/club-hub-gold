import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { chromium, webkit, devices } from "playwright-core";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3062";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
for (const [name, engine, device] of [
  ["samsung", chromium, devices["Galaxy S9+"]],
  ["iphone", webkit, devices["iPhone 13"]],
]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? {
          executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
          args: ["--no-sandbox"],
        }
      : {}),
  });
  try {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue()
        : route.abort(),
    );
    await context.addInitScript(() => {
      const sw = new EventTarget(),
        registration = new EventTarget();
      const waiting = {
        postMessage() {
          sw.posts++;
        },
      };
      registration.waiting = waiting;
      registration.update = async () => {};
      sw.posts = 0;
      sw.controller = {};
      sw.register = async () => registration;
      sw.getRegistrations = async () => [];
      window.__update = { sw, waiting };
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(base + "/auth", { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "Actualizar app / Aggiorna app", exact: true });
    await button.waitFor();
    let reloads = 0;
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) reloads++;
    });
    await page.evaluate(() => window.__update.sw.dispatchEvent(new Event("controllerchange")));
    await page.waitForTimeout(100);
    assert.equal(reloads, 0, "No unsolicited reload");
    page.once("dialog", (d) => d.dismiss());
    await button.click();
    assert.equal(
      await page.evaluate(() => window.__update.sw.posts),
      0,
      "Cancel must not activate worker",
    );
    await page.clock.install();
    page.once("dialog", (d) => d.accept());
    await button.click();
    assert.equal(await page.evaluate(() => window.__update.sw.posts), 1);
    await page.clock.runFor(31000);
    await page.clock.resume();
    await page.evaluate(() => {
      window.__update.sw.controller = {};
      window.__update.sw.dispatchEvent(new Event("controllerchange"));
    });
    await page.waitForTimeout(300);
    assert.equal(
      reloads,
      0,
      "Expired confirmation listener must not reload on an unrelated controller change",
    );
    page.once("dialog", (d) => d.accept());
    await button.click();
    await page.evaluate(() => {
      window.__update.sw.controller = window.__update.waiting;
      window.__update.sw.dispatchEvent(new Event("controllerchange"));
    });
    await page.waitForTimeout(500);
    assert.equal(reloads, 1, "Only explicitly accepted matching worker reloads once");
    console.log(
      "PASS update consent " +
        name +
        ": no automatic reload, cancellation, listener expiry, explicit matching controller",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
