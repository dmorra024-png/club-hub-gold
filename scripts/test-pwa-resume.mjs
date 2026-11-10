import { cashBrowserFixture } from "./lib/cash-browser-fixture.mjs";
import { fromJSON } from "seroval";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const configured =
  process.env.TEST_SUPABASE_URL ||
  (process.env.TEST_BASE_URL
    ? (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1]
    : "/sandbox-api");
const api = new URL(configured, base),
  prefix = api.pathname.replace(/\/$/, "");
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  cat = "20000000-0000-4000-8000-000000000001",
  pid = "30000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
  exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const engines = [["Android", chromium, devices["Pixel 7"]]];
if (process.env.TEST_WEBKIT === "true")
  engines.push(["iPhone WebKit", webkit, devices["iPhone 13"]]);
for (const [label, engine, device] of engines) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? {
          executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
          args: ["--no-sandbox"],
        }
      : {}),
  });
  let fail = false,
    permitted = true;
  const queries = [];
  async function mock(context) {
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        isApi = url.origin === api.origin && (!prefix || url.pathname.startsWith(prefix + "/"));
      if (url.origin !== new URL(base).origin && !isApi) return route.abort();
      if (
        url.pathname.includes("_serverFn") &&
        req.method() === "POST" &&
        "day" in fromJSON(JSON.parse(req.postData())).data
      )
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            result: cashBrowserFixture({
              userId: uid,
              orders: [
                { id: "same-order", total_cents: 700 },
                { id: "same-order", total_cents: 700 },
              ],
              fees: [
                {
                  id: "synthetic-receipt",
                  amount_cents: 300,
                  recorded_by: uid,
                  payment_method: "cash",
                },
              ],
            }),
            context: {},
          }),
        });
      if (url.pathname.includes("_serverFn"))
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            result: { available: false, documents: false, browserSpeech: false },
            context: {},
          }),
        });
      if (!isApi) return route.continue();
      let data = [],
        status = 200;
      if (url.pathname.endsWith("/auth/v1/user")) data = user;
      else if (url.pathname.endsWith("/rpc/snoop_access_context")) {
        if (fail) {
          status = 503;
          data = { message: "Synthetic transient access failure" };
        } else
          data = {
            role: "admin",
            status: "active",
            clubId: club,
            clubName: "Club Sintetico Realista",
            permissions: permitted
              ? [
                  "manage_members",
                  "manage_products",
                  "manage_collaborators",
                  "use_cash",
                  "view_reports",
                ]
              : ["manage_members"],
          };
      } else if (url.pathname.endsWith("/rpc/current_club_id")) data = club;
      else if (url.pathname.endsWith("/product_categories"))
        data = [
          {
            id: cat,
            club_id: club,
            name: "Synthetic resources",
            unit_type: "unit",
            is_smokeable: false,
          },
        ];
      else if (url.pathname.endsWith("/products"))
        data = [
          {
            id: pid,
            club_id: club,
            category_id: cat,
            name: "Synthetic Cup",
            stock: 10,
            buy_price: 0,
            sell_price: 0,
            active: true,
          },
        ];
      else if (url.pathname.endsWith("/orders")) {
        queries.push(url);
        data = [
          { id: "same-order", total_cents: 700 },
          { id: "same-order", total_cents: 700 },
        ];
      } else if (url.pathname.endsWith("/membership_receipts")) {
        queries.push(url);
        data = [
          { id: "synthetic-receipt", amount_cents: 300, recorded_by: uid, payment_method: "cash" },
        ];
      } else if (url.pathname.endsWith("/clubs"))
        data = [{ id: club, name: "Club Sintetico Realista" }];
      if (url.pathname.endsWith("/orders")) {
        const at = new Date().toISOString();
        data = data.map((o) => ({ created_at: at, status: "completed", created_by: uid, ...o }));
      }
      if (url.pathname.endsWith("/membership_receipts")) {
        const at = new Date().toISOString();
        data = data.map((r) => ({ recorded_at: at, ...r }));
      }
      if (req.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(data))
        data = data[0] ?? null;
      return route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(data),
      });
    });
  }
  try {
    let context = await browser.newContext({
      ...device,
      timezoneId: "America/Los_Angeles",
      serviceWorkers: "block",
    });
    await mock(context);
    await context.addInitScript(
      ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    let page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + "/productos", { waitUntil: "networkidle" });
    await page.getByLabel("Motivo de la corrección").fill("Synthetic unsaved count");
    if (engine === chromium) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
      await new Promise((r) => setTimeout(r, 200));
      await cdp.send("Page.setWebLifecycleState", { state: "active" });
    }
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.getByLabel("Motivo de la corrección").waitFor({ state: "visible" });
    assert.equal(
      await page.getByLabel("Motivo de la corrección").inputValue(),
      "Synthetic unsaved count",
    );
    assert.equal(new URL(page.url()).pathname, "/productos");
    fail = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("alert").first().waitFor();
    assert.equal(new URL(page.url()).pathname, "/productos");
    fail = false;
    await page.getByRole("button", { name: "Reintentar acceso", exact: true }).click();
    await page.getByLabel("Motivo de la corrección").waitFor({ state: "visible" });
    assert.equal(
      await page.getByLabel("Motivo de la corrección").inputValue(),
      "Synthetic unsaved count",
    );
    const state = await context.storageState();
    await context.close();
    context = await browser.newContext({
      ...device,
      timezoneId: "America/Los_Angeles",
      serviceWorkers: "block",
      storageState: state,
    });
    await mock(context);
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + "/auth", { waitUntil: "networkidle" });
    await page.waitForURL(base + "/productos");
    await page.getByLabel("Producto para ajustar stock").waitFor();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const summary = page.getByRole("region", { name: "Caja de hoy" });
    await summary.getByText(/10,00/).waitFor();
    assert.equal(
      await page
        .getByRole("navigation", { name: "Navegación principal" })
        .getByRole("link")
        .count(),
      3,
    );
    assert.match(
      await page.getByRole("region", { name: "Bienvenida al club" }).innerText(),
      /Club Sintetico Realista/,
    );
    assert.doesNotMatch(await summary.innerText(), /\d+ socios|\d+ productos/i);
    await page.goto(base + "/caja", { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
    await page.getByText(/10,00/).first().waitFor();
    permitted = false;
    queries.length = 0;
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("navigation", { name: "Navegación principal" }).waitFor();
    assert.equal(await page.locator(".premium-cash-amount").count(), 0);
    assert.equal(queries.length, 0);
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    const menu = page.getByRole("dialog", { name: "Menú principal" });
    assert.equal(await menu.getByRole("link", { name: "Productos", exact: true }).count(), 0);
    assert.equal(await menu.getByRole("link", { name: "Caja", exact: true }).count(), 0);
    console.log(
      "PASS " +
        label +
        ": warm resume/freeze; draft retained; network error/retry; cold context restores route; home and Caja agree; club name; three buttons; cash permission fence (synthetic APIs, not a physical OS test)",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
