import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
export async function checkOrderKeyboard(page, catalog, label) {
  const inputs = catalog.getByPlaceholder("g", { exact: true });
  await inputs.first().waitFor();
  assert.equal(await inputs.count(), 9);
  assert.ok(
    await inputs.first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize) >= 16),
    "iOS decimal controls must not trigger focus zoom (<16px)",
  );
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  const viewport = async (height, offset = 0, event = "resize") => {
    await page.evaluate(
      ({ height, offset, event }) => {
        Object.assign(window.visualViewport, { height, offsetTop: offset });
        window.visualViewport.dispatchEvent(new Event(event));
      },
      { height, offset, event },
    );
    await page.waitForTimeout(360);
  };
  const visible = async (input, height, offset = 0) => {
    const r = await input.boundingBox();
    assert.ok(
      r && r.y >= offset + 11 && r.y + r.height <= offset + height - 19,
      `active field outside viewport ${JSON.stringify(r)}`,
    );
    assert.equal(await input.evaluate((n) => document.activeElement === n), true);
  };
  const noOverlap = async () => {
    const result = await inputs.evaluateAll((nodes) => {
      const cards = nodes.map((n) => n.closest("div.rounded-lg.border"));
      const overlap = cards.some((card, i) =>
        cards.slice(i + 1).some((other) => {
          const a = card.getBoundingClientRect(),
            b = other.getBoundingClientRect();
          return (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
          );
        }),
      );
      const escaped = nodes.some((n) => {
        const a = n.getBoundingClientRect(),
          b = n.closest("div.rounded-lg.border").getBoundingClientRect();
        return a.left < b.left || a.right > b.right;
      });
      return { overlap, escaped, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.deepEqual(result, { overlap: false, escaped: false, overflow: false });
  };
  await inputs.evaluateAll((nodes) => {
    window.__orderCards = nodes.map((n) => n.closest("div.rounded-lg.border"));
    window.__orderFields = nodes;
  });
  for (const index of [0, 4, 8]) {
    const input = inputs.nth(index);
    await input.fill("1,25");
    await viewport(300);
    await visible(input, 300);
    assert.equal(await nav.isVisible(), false);
    await noOverlap();
    const snapshot = await catalog.locator("input").evaluateAll((ns) => ns.map((n) => n.value));
    for (let n = 0; n < 4; n++) await viewport(300 + (n % 2) * 4);
    assert.deepEqual(
      await catalog.locator("input").evaluateAll((ns) => ns.map((n) => n.value)),
      snapshot,
    );
    await viewport(844);
    await input.blur();
    assert.equal(await nav.isVisible(), true);
  }
  const input = inputs.first();
  await input.focus();
  await viewport(300);
  // User pans while editing. Do not counter-scroll Safari's VisualViewport scroll event.
  await page.evaluate(() => window.scrollBy(0, -220));
  const before = await page.evaluate(() => scrollY);
  await viewport(300, 20, "scroll");
  assert.ok(
    Math.abs((await page.evaluate(() => scrollY)) - before) <= 1,
    "visual viewport panning must not recenter the document",
  );
  await viewport(300, 20);
  await visible(input, 300, 20);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({ path: `docs/screenshots/order-keyboard-${label}.png`, scale: "css" });
  const saved = await catalog.locator("input").evaluateAll((ns) => ns.map((n) => n.value));
  // Safari may announce orientation before it reports the new layout size.
  await page.evaluate(() => {
    window.__orientation = "landscape-primary";
    window.dispatchEvent(new Event("orientationchange"));
  });
  await page.waitForTimeout(60);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    window.__orientation = "landscape-primary";
    Object.assign(window.visualViewport, { height: 390, offsetTop: 0 });
    window.dispatchEvent(new Event("orientationchange"));
  });
  await page.waitForTimeout(360);
  assert.equal(
    await nav.isVisible(),
    true,
    "old portrait height must not mark a closed landscape keyboard as open",
  );
  await viewport(180);
  await visible(input, 180);
  await noOverlap();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.__orientation = "portrait-primary";
    window.dispatchEvent(new Event("orientationchange"));
  });
  await viewport(844);
  await input.blur();
  await input.focus();
  await page.waitForTimeout(360);
  await page.evaluate(() => {
    window.__visible = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    window.visualViewport.height = 260;
    window.__visible = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
  await page.waitForTimeout(400);
  await visible(input, 260);
  assert.equal(await nav.isVisible(), false);
  await noOverlap();
  assert.deepEqual(
    await catalog.locator("input").evaluateAll((ns) => ns.map((n) => n.value)),
    saved,
  );
  assert.equal(
    await inputs.evaluateAll((ns) =>
      ns.every(
        (n, i) =>
          window.__orderCards[i] === n.closest("div.rounded-lg.border") &&
          window.__orderFields[i] === n,
      ),
    ),
    true,
    "keyboard/rotation/resume must retain the same DOM fields and cards",
  );
  await input.blur();
  await viewport(844);
  assert.equal(await nav.isVisible(), true);
}
export function installOrderViewport() {
  window.__orientation = "portrait-primary";
  window.__visible = "visible";
  Object.defineProperty(screen, "orientation", {
    configurable: true,
    get: () => ({ type: window.__orientation }),
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => window.__visible,
  });
  const viewport = new EventTarget();
  Object.assign(viewport, { height: 844, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
}
