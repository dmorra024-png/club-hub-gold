import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3001";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname), "Isolated local test only");
const api = new URL(
  process.env.TEST_SUPABASE_URL ||
    (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1],
  base,
);
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  user_metadata: { full_name: "Persona de prueba" },
  app_metadata: { provider: "email" },
  aud: "authenticated",
  role: "authenticated",
  created_at: "2026-01-01T00:00:00Z",
};
const fixtureNow = Date.parse("2026-11-07T18:00:00Z");
const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
  exp = Math.floor(fixtureNow / 1000) + 3600;
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const receiptTime = (hour) => {
  const date = new Date(fixtureNow);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};
const ago = (m) => new Date(fixtureNow - m * 60000).toISOString();
const tables = {
  members: [{ id: "synthetic-member", club_id: club, created_at: ago(12), member_number: "1042" }],
  orders: [{ id: "synthetic-order", club_id: club, created_at: ago(37), total_cents: 12000 }],
  membership_receipts: [
    { id: "synthetic-fee-a", club_id: club, recorded_at: receiptTime(8), amount_cents: 1000 },
    { id: "synthetic-fee-b", club_id: club, recorded_at: receiptTime(11), amount_cents: 1500 },
    { id: "synthetic-fee-c", club_id: club, recorded_at: receiptTime(14), amount_cents: 2500 },
  ],
  products: [
    {
      id: "synthetic-product",
      club_id: club,
      name: "Recurso de prueba",
      created_at: ago(900),
      updated_at: ago(120),
    },
  ],
  stock_movements: [{ id: "synthetic-inventory", club_id: club, created_at: ago(300), delta: 5 }],
};
const runs = [
  ["reference-content", chromium, { ...devices["Pixel 7"], viewport: { width: 390, height: 780 } }],
  ["android-pixel", chromium, { ...devices["Pixel 7"], viewport: { width: 393, height: 852 } }],
  [
    "android-samsung",
    chromium,
    { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } },
  ],
  ["small-screen", chromium, { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } }],
];
if (process.env.TEST_WEBKIT === "true")
  runs.push(
    ["iphone-webkit", webkit, { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } }],
    [
      "iphone-large",
      webkit,
      { ...devices["iPhone 13 Pro Max"], viewport: { width: 430, height: 932 } },
    ],
  );
const results = [];
for (const [label, engine, device] of runs) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? {
          executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
          args: [
            "--no-sandbox",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        }
      : {}),
  });
  let role = "admin",
    clubName = "Club Principal",
    permissions = [
      "manage_members",
      "manage_products",
      "manage_collaborators",
      "use_cash",
      "view_reports",
    ],
    privateRequests = [],
    updates = 0,
    reauth = 0,
    mutations = 0,
    empty = false,
    activeClub = club,
    logouts = 0;
  try {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    await context.addInitScript(
      ({ auth, key }) => {
        if (!sessionStorage.getItem("snoop-test-signed-out"))
          localStorage.setItem(key, JSON.stringify(auth));
      },
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const isApi =
        url.origin === api.origin &&
        (!api.pathname.replace(/\/$/, "") ||
          url.pathname.startsWith(api.pathname.replace(/\/$/, "") + "/"));
      if (url.origin !== new URL(base).origin && !isApi) return route.abort();
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
      if (url.pathname.endsWith("/auth/v1/logout")) {
        logouts++;
        data = {};
      } else if (url.pathname.endsWith("/auth/v1/token")) {
        reauth++;
        assert.equal(request.postDataJSON().email, user.email);
        assert.equal(request.postDataJSON().password, "Synthetic-current-2026!");
        data = auth;
      } else if (url.pathname.endsWith("/auth/v1/user")) {
        if (request.method() === "PUT") {
          updates++;
          assert.ok(
            Object.keys(request.postDataJSON()).every((key) =>
              ["password", "code_challenge", "code_challenge_method"].includes(key),
            ),
          );
        }
        data = user;
      } else if (url.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role,
          status: role === "super_admin" ? "platform" : "active",
          clubId: role === "super_admin" ? null : activeClub,
          clubName,
          permissions,
        };
      else if (url.pathname.endsWith("/rpc/current_club_id")) data = activeClub;
      else {
        const name = url.pathname.split("/").pop();
        if (name in tables) {
          privateRequests.push(name);
          assert.equal(
            url.searchParams.get("club_id"),
            `eq.${activeClub}`,
            "Every activity/cash read is club-scoped",
          );
          assert.ok(
            !url.searchParams.get("select")?.includes("first_name"),
            "Home does not fetch member names/documents",
          );
          if (request.method() !== "GET") mutations++;
          if (["orders", "membership_receipts"].includes(name) && role !== "admin")
            assert.equal(
              url.searchParams.get(name === "orders" ? "created_by" : "recorded_by"),
              `eq.${uid}`,
            );
          data = empty ? [] : tables[name].filter((row) => row.club_id === activeClub);
        }
      }
      if (request.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(data))
        data = data[0] || null;
      return route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          ...(url.pathname.endsWith("/membership_receipts") &&
          request.headers().prefer?.includes("count=exact")
            ? {
                "content-range": `${Array.isArray(data) && data.length ? "0-" + (data.length - 1) : "*"}/${Array.isArray(data) ? data.length : 0}`,
                "access-control-expose-headers": "content-range",
              }
            : {}),
        },
        body: JSON.stringify(data),
      });
    });
    let page = await context.newPage();
    await page.clock.setFixedTime(new Date(fixtureNow));
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Club Principal", exact: true }).waitFor();
    await page
      .locator(".premium-cash-amount")
      .getByText(/170,00/)
      .waitFor();
    await page.getByText("Nuevo socio registrado", { exact: true }).waitFor();
    await page
      .getByRole("img", { name: "Evolución real de las cuotas asociativas de hoy", exact: true })
      .waitFor();
    assert.equal(await page.locator(".premium-activity").count(), 3);
    assert.equal(await page.getByRole("img", { name: "SNOOP", exact: true }).count(), 1);
    assert.equal(await page.locator(".premium-waves").count(), 2);
    const nav = page.getByRole("navigation", { name: "Navegación principal" });
    assert.equal(await nav.locator(":scope > *").count(), 3);
    assert.equal(await nav.getByRole("link", { name: "Home", exact: true }).count(), 1);
    assert.equal(await nav.getByRole("link", { name: "Perfil", exact: true }).count(), 1);
    assert.equal(
      await page
        .locator(".premium-welcome")
        .getByText(/Welcome|Pilot|Club Management/i)
        .count(),
      0,
    );
    assert.equal(await page.locator(".premium-shell-home [class*=rotate-]").count(), 0);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "No horizontal scrolling",
    );
    await page.evaluate(() => document.fonts.ready);
    await mkdir(".sandbox/screenshots/premium", { recursive: true });
    const geometry = await page.evaluate(() =>
      Object.fromEntries(
        [
          ".snoop-lettering",
          ".snoop-brand-orbit",
          ".premium-eyebrow",
          ".premium-club-name",
          ".premium-waves",
          ".premium-cash",
          ".premium-cash-amount",
          ".premium-section-heading",
          ".premium-activity",
          ".premium-footer-waves",
          ".premium-bottom-nav",
          ".premium-qr",
        ].map((selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return [selector, { x: r.x, y: r.y, width: r.width, height: r.height }];
        }),
      ),
    );
    await writeFile(
      `.sandbox/screenshots/premium/${label}-geometry.json`,
      JSON.stringify(geometry, null, 2),
    );
    await page.screenshot({
      path: `.sandbox/screenshots/premium/${label}.png`,
      fullPage: false,
      scale: "css",
    });

    await page.getByRole("link", { name: /Ver todas/ }).click();
    await page.getByRole("heading", { name: "Actividad del club", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".premium-activity").length === 7);
    await nav.getByRole("link", { name: "Home", exact: true }).click();
    await page.getByRole("heading", { name: "Club Principal", exact: true }).waitFor();
    // QR destination/dispensing is outside this administrative visual verification.
    await nav.getByRole("link", { name: "Perfil", exact: true }).click();
    await page.getByRole("heading", { name: "Mi perfil", exact: true }).waitFor();
    await page.getByText(user.email, { exact: true }).waitFor();
    assert.equal(await page.locator("select[name=role],input[name=role]").count(), 0);
    await page.getByLabel("Contraseña actual", { exact: true }).fill("Synthetic-current-2026!");
    await page
      .getByLabel("Nueva contraseña (mínimo 12 caracteres)", { exact: true })
      .fill("Synthetic-new-2026!");
    await page.getByLabel("Repetir nueva contraseña", { exact: true }).fill("Synthetic-new-2026!");
    await page.getByRole("button", { name: "Guardar contraseña", exact: true }).click();
    await page.getByText("Contraseña actualizada de forma segura.", { exact: true }).waitFor();
    assert.equal(reauth, 1);
    assert.equal(updates, 1);
    assert.equal(mutations, 0);
    const before = { ...device.viewport };
    await page.getByLabel("Contraseña actual", { exact: true }).focus();
    await page.setViewportSize({ width: before.width, height: Math.max(320, before.height - 260) });
    await page.waitForFunction(
      () => document.querySelector(".premium-shell")?.getAttribute("data-keyboard-open") === "true",
    );
    assert.ok(await nav.isHidden(), "Keyboard does not compete with bottom navigation");
    await page.setViewportSize(before);
    await page.getByRole("heading", { name: "Mi perfil", exact: true }).click();
    await nav.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Menú principal" })
      .getByRole("link", { name: "Productos", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.ok(
      await page
        .getByRole("button", { name: "Abrir menú", exact: true })
        .evaluate((el) => el === document.activeElement),
    );
    // Server access changes are checked on fresh page loads; no cached permission bypass.
    role = "collaborator";
    permissions = ["manage_products"];
    privateRequests = [];
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Lector QR no autorizado", exact: true }).waitFor();
    assert.ok(
      await page.getByRole("button", { name: "Lector QR no autorizado", exact: true }).isDisabled(),
    );
    assert.equal(await page.locator(".premium-cash-amount").count(), 0);
    assert.equal(await page.locator(".premium-membership-chart").count(), 0);
    assert.ok(
      privateRequests.every((name) => ["products", "stock_movements"].includes(name)),
      "No member/cash read without permission",
    );
    assert.equal(await page.getByText("Nuevo socio registrado", { exact: true }).count(), 0);
    permissions = ["view_reports"];
    privateRequests = [];
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page
      .locator(".premium-cash-amount")
      .getByText(/170,00/)
      .waitFor();
    assert.ok(
      privateRequests.every((name) => ["orders", "membership_receipts"].includes(name)),
      "Report-only access never reads member/catalog tables",
    );
    empty = true;
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page
      .getByText("Aún no hay actividades disponibles para tu acceso.", { exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".premium-activity").count(),
      0,
      "Empty club has no fabricated activity",
    );
    // The empty activity list may finish before the independent cash effect.
    // Finish and close this document before changing the server fixture's club.
    await page.locator(".premium-cash-amount").getByText(/0,00/).waitFor();
    await page.waitForLoadState("networkidle");
    await page.close();
    empty = false;
    activeClub = "10000000-0000-4000-8000-000000000002";
    clubName = "Otro Club de Prueba";
    page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: clubName, exact: true }).waitFor();
    assert.equal(
      await page.getByRole("heading", { name: "Club Principal", exact: true }).count(),
      0,
    );
    // Complete the previous club's independent cash/activity effects before
    // measuring requests belonging to the platform profile navigation.
    await page
      .getByText("Aún no hay actividades disponibles para tu acceso.", { exact: true })
      .waitFor();
    await page.locator(".premium-cash-amount").getByText(/0,00/).waitFor();
    await page.waitForLoadState("networkidle");
    // Stop the old account document before changing the server-side fixture.
    // Its visibility/access refresh may otherwise redirect the new navigation.
    await page.close();
    role = "super_admin";
    permissions = [];
    page = await context.newPage();
    // The fixed clock init script is already installed for this browser context.
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => errors.push(error.message));
    privateRequests = [];
    await page.goto(base + "/perfil", { waitUntil: "networkidle" });
    try {
      await page.getByRole("heading", { name: "Mi perfil", exact: true }).waitFor();
    } catch (error) {
      console.error(
        "Platform profile failure",
        page.url(),
        await page.locator("body").innerText(),
        errors,
      );
      throw error;
    }
    await page.getByText("Super Admin", { exact: true }).waitFor();
    assert.equal(privateRequests.length, 0, "Platform profile reads no private club tables");
    await page.evaluate(() => sessionStorage.setItem("snoop-test-signed-out", "true"));
    await page.getByRole("button", { name: "Salir de mi cuenta", exact: true }).click();
    await page.waitForURL(base + "/auth");
    await page.locator('input[type="email"]').waitFor();
    assert.equal(logouts, 1);
    assert.deepEqual(errors, []);
    results.push({
      device: label,
      result: "PASS",
      physical: false,
      fixtures: "synthetic, intercepted local API",
      screenshot: `.sandbox/screenshots/premium/${label}.png`,
    });
    console.log(
      `PASS ${label}: rendered premium home, live-query fixtures, permissions, activity navigation, own profile/password, keyboard, responsive and platform separation`,
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile(".sandbox/PREMIUM_HOME_RESULTS.json", JSON.stringify({ results }, null, 2));
