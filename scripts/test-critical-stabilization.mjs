import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fromJSON } from "seroval";
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

const results = [];
await mkdir("docs/screenshots", { recursive: true });
for (const [label, engine, device] of [
  ["samsung", chromium, { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } }],
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
    const context = await browser.newContext({
      ...device,
      timezoneId: "America/Los_Angeles",
      serviceWorkers: "block",
    });
    let fail = false,
      accesses = 0,
      writes = 0,
      staff = false,
      mailState = "pending",
      activeClub = club;
    await context.addInitScript(
      ({ auth, key }) => {
        localStorage.setItem(key, JSON.stringify(auth));
        const viewport = new EventTarget();
        viewport.height = innerHeight;
        viewport.width = innerWidth;
        viewport.offsetTop = 0;
        viewport.offsetLeft = 0;
        viewport.scale = 1;
        Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
      },
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        isApi = u.origin === api.origin && (!prefix || u.pathname.startsWith(prefix + "/"));
      if (u.origin !== new URL(base).origin && !isApi) return route.abort();
      if (u.pathname.includes("_serverFn")) {
        let result = req.headers().referer?.includes("/ajustes/")
          ? []
          : { available: false, documents: false, browserSpeech: false };
        if (req.method() === "POST") {
          const payload = fromJSON(JSON.parse(req.postData())).data;
          if (payload.memberId)
            return route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                result: { status: mailState, attempts: 1, error_code: null },
                context: {},
              }),
            });
          // The RPC itself is tested against isolated PostgreSQL; this fixture exercises the real report component.
          result = {
            available: true,
            report: {
              day: "2026-01-10",
              server_now: "2026-01-10T11:00:00Z",
              user_id: uid,
              operator_name: "Operador sintético A",
              admin: !staff,
              rows: [
                {
                  id: "r1",
                  recorded_at: "2026-01-10T10:00:00Z",
                  recorded_by: uid,
                  operator_name: "Operador sintético A",
                  member_name: "Socio sintético",
                  member_number: "1001",
                  amount_cents: 1000,
                  shift: 1,
                  shift_day: "2026-01-10",
                  type: "Cuota",
                  payment_method: "cash",
                },
                {
                  id: "r2",
                  recorded_at: "2026-01-10T11:00:00Z",
                  recorded_by: "operator-b",
                  operator_name: "Operador sintético B",
                  member_name: "Socio sintético",
                  amount_cents: 2500,
                  shift: 1,
                  shift_day: "2026-01-10",
                  type: "Cuota",
                  payment_method: "card",
                },
                {
                  id: "r3",
                  recorded_at: "2026-01-10T16:00:00Z",
                  recorded_by: uid,
                  operator_name: "Operador sintético A",
                  member_name: "Socio sintético",
                  amount_cents: 500,
                  shift: 2,
                  shift_day: "2026-01-10",
                  type: "Renovación",
                  payment_method: "cash",
                },
                {
                  id: "r4",
                  recorded_at: "2026-01-10T22:00:00Z",
                  recorded_by: uid,
                  operator_name: "Operador sintético A",
                  member_name: "Socio sintético",
                  amount_cents: 250,
                  shift: null,
                  shift_day: "2026-01-10",
                  type: "Cuota",
                  payment_method: "cash",
                },
              ].filter((r) => !staff || r.recorded_by === uid),
            },
          };
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      let data = [],
        status = 200;
      if (req.method() !== "GET" && !u.pathname.includes("/rpc/") && !u.pathname.includes("/auth/"))
        writes++;
      if (u.pathname.endsWith("/auth/v1/user")) data = user;
      else if (u.pathname.endsWith("/rpc/snoop_access_context")) {
        accesses++;
        if (fail) {
          status = 503;
          data = { message: "Synthetic temporary failure" };
        } else
          data = {
            role: staff ? "collaborator" : "admin",
            status: "active",
            clubId: activeClub,
            clubName: "Club sintético",
            permissions: [
              "use_cash",
              "manage_members",
              "manage_products",
              "manage_collaborators",
              "view_reports",
            ],
          };
      } else if (u.pathname.endsWith("/rpc/current_club_id")) data = activeClub;
      else if (u.pathname.endsWith("/members"))
        data = [
          {
            id: pid,
            club_id: club,
            first_name: "Socio",
            last_name: "Sintético",
            member_number: "0001001",
            birth_date: "2000-01-01",
            email: "synthetic@example.test",
            dni_number: "TEST-ONLY",
            joined_at: "2026-01-01",
            expires_at: "2030-01-01",
            contract_version: "synthetic",
          },
        ];
      else if (u.pathname.endsWith("/clubs")) data = [{ id: club, name: "Club sintético" }];
      else if (u.pathname.endsWith("/product_categories"))
        data = [
          { id: cat, club_id: club, name: "Material", unit_type: "unit", is_smokeable: false },
        ];
      else if (u.pathname.endsWith("/products"))
        data = [
          {
            id: pid,
            club_id: club,
            category_id: cat,
            name: "Libreta sintética",
            stock: 25,
            buy_price: 0,
            sell_price: 0,
            active: true,
          },
        ];
      if (req.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(data))
        data = data[0] ?? null;
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    if (!process.env.CRITICAL_CASE || process.env.CRITICAL_CASE === "reload") {
      await page.goto(base + "/caja", { waitUntil: "networkidle" });
      const input = page.locator('input[inputmode="decimal"]').first();
      await input.fill("123.45");
      const node = await input.elementHandle();
      let documentRequests = 0;
      page.on("request", (r) => {
        if (r.isNavigationRequest() && r.frame() === page.mainFrame()) documentRequests++;
      });
      for (const event of ["focus", "online", "pageshow"]) {
        const before = accesses;
        await page.evaluate((event) => window.dispatchEvent(new Event(event)), event);
        await page.waitForFunction(() => true);
        await page.waitForTimeout(500);
        assert.ok(accesses > before, "Access was actually revalidated");
        assert.ok(
          await node.evaluate((n) => n.isConnected),
          "Same draft input must stay mounted during access refresh",
        );
        assert.equal(await input.inputValue(), "123.45");
      }
      await page.clock.install();
      await page.clock.runFor(31000);
      assert.equal(await input.inputValue(), "123.45");
      await page.clock.resume();
      assert.equal(documentRequests, 0, "No document reload on refresh events");
      // Same-identity refresh token notification must not reset the route or draft.
      await page.evaluate(
        ({ key, auth }) => {
          const c = new BroadcastChannel(key);
          c.postMessage({ event: "TOKEN_REFRESHED", session: auth });
          c.close();
        },
        { key: `sb-${api.hostname.split(".")[0]}-auth-token`, auth },
      );
      await page.waitForTimeout(400);
      assert.equal(await input.inputValue(), "123.45");
      fail = true;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByRole("button", { name: "Reintentar acceso", exact: true }).waitFor();
      assert.equal(await input.inputValue(), "123.45");
      assert.equal(await input.isDisabled(), true);
      fail = false;
      await page.getByRole("button", { name: "Reintentar acceso", exact: true }).click();
      await page.waitForFunction(() => !document.querySelector("fieldset")?.disabled);
      assert.equal(await input.inputValue(), "123.45");
      assert.ok(await node.evaluate((n) => n.isConnected));
      activeClub = "10000000-0000-4000-8000-000000000002";
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForFunction(
        () => document.querySelector('input[inputmode="decimal"]')?.value === "0",
      );
      assert.equal(
        await node.evaluate((n) => n.isConnected),
        false,
        "Actual club change clears the prior club draft",
      );
      activeClub = club;
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(300);
      results.push({
        device: label,
        case: "same-user refresh, focus/online/pageshow, transient failure/retry preserve the same draft node",
        result: "PASS",
      });
    }
    if (!process.env.CRITICAL_CASE || process.env.CRITICAL_CASE === "keyboard") {
      for (const [path, labelText] of [
        ["/soci/nuovo", "Nombre *"],
        ["/soci/nuovo", "Ciudad"],
        ["/perfil", "Nueva contraseña (mínimo 12 caracteres)"],
        ["/caja", null],
        ["/productos", "Motivo de la corrección"],
        ["/ajustes/colaboradores", "Apellidos"],
      ]) {
        await page.goto(base + path, { waitUntil: "networkidle" });
        let input = labelText
          ? page.getByLabel(labelText === "Ciudad" ? /^Ciudad/ : labelText, { exact: true })
          : page.locator('input[inputmode="decimal"]').first();
        await input.waitFor({ state: "visible" });
        await input.fill("Synthetic draft");
        await input.focus();
        await page.evaluate(() => {
          window.visualViewport.height = 300;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(250);
        assert.equal(await input.evaluate((n) => document.activeElement === n), true);
        assert.equal(await input.inputValue(), "Synthetic draft");
        const nav = page.getByRole("navigation", { name: "Navegación principal" });
        assert.equal(await nav.isVisible(), false, "Bottom navigation hides for overlay keyboard");
        const box = await input.boundingBox();
        assert.ok(
          box.y >= 0 && box.y + box.height <= 300,
          `${path} active field must be above keyboard, got ${JSON.stringify(box)}`,
        );
        await page.screenshot({
          path: `docs/screenshots/critical-keyboard-${label}-${path.split("/").pop()}.png`,
          scale: "css",
        });
        await input.blur();
        await page.evaluate(() => {
          window.visualViewport.height = innerHeight;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(200);
        assert.equal(await nav.isVisible(), true);
        // Resize-content keyboards (Chromium) and a VisualViewport scroll/pan event.
        await input.focus();
        const size = page.viewportSize();
        await page.setViewportSize({ width: size.width, height: 450 });
        await page.evaluate(() => {
          window.visualViewport.height = 450;
          window.visualViewport.offsetTop = 10;
          window.visualViewport.dispatchEvent(new Event("scroll"));
        });
        await page.waitForTimeout(200);
        assert.equal(await nav.isVisible(), false);
        const shrunk = await input.boundingBox();
        assert.ok(shrunk.y >= 10 && shrunk.y + shrunk.height <= 460);
        await input.blur();
        await page.setViewportSize(size);
        await page.evaluate(() => {
          window.visualViewport.height = innerHeight;
          window.visualViewport.offsetTop = 0;
          window.visualViewport.dispatchEvent(new Event("resize"));
        });
        await page.waitForTimeout(200);
        assert.equal(await nav.isVisible(), true);
      }
      await page.goto(base + "/caja", { waitUntil: "networkidle" });
      const fallbackInput = page.locator('input[inputmode="decimal"]').first();
      await page.evaluate(() =>
        Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined }),
      );
      await fallbackInput.focus();
      await page.waitForTimeout(200);
      assert.equal(
        await page.getByRole("navigation", { name: "Navegación principal" }).isVisible(),
        false,
        "No VisualViewport fallback hides dock on mobile edit",
      );
      await fallbackInput.blur();
      await page.waitForTimeout(200);
      assert.equal(
        await page.getByRole("navigation", { name: "Navegación principal" }).isVisible(),
        true,
      );
      results.push({
        device: label,
        case: "overlay keyboard hides nav, scrolls actual member/profile/cash fields, preserves focus/text, restores nav",
        result: "PASS",
      });
    }
    if (!process.env.CRITICAL_CASE) {
      await page.goto(base + "/caja", { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Turnos administrativos", exact: true }).click();
      const report = page.getByRole("region", { name: "Caja administrativa por turnos" });
      await report.getByText(/TOTAL DÍA.*42,50/).waitFor();
      assert.match(await report.innerText(), /35,00/);
      assert.match(await report.innerText(), /5,00/);
      assert.match(await report.innerText(), /2,50/);
      await report.getByText("Movimientos administrativos y atribución").click();
      assert.match(await report.innerText(), /Nombre del socio/);
      assert.match(await report.innerText(), /Colaborador responsable/);
      await page.screenshot({
        path: `docs/screenshots/critical-shifts-${label}.png`,
        fullPage: true,
        scale: "css",
      });
      staff = true;
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Turnos administrativos", exact: true }).click();
      await report.getByText(/TOTAL PROPIO DEL DÍA.*17,50/).waitFor();
      assert.doesNotMatch(await report.innerText(), /42,50|Operador sintético B/);
      staff = false;
      await page.goto(base + "/soci/" + pid, { waitUntil: "networkidle" });
      for (const state of ["pending", "accepted", "delivered", "error", "unknown"]) {
        mailState = state;
        await page
          .getByRole("button", { name: "Consultar estado del email QR", exact: true })
          .click();
        const status = page.getByRole("status").filter({
          hasText:
            state === "pending"
              ? "Pendiente"
              : state === "accepted"
                ? "no confirmada"
                : state === "delivered"
                  ? "confirmado"
                  : state === "error"
                    ? "Error de envío"
                    : "Resultado incierto",
        });
        await status.waitFor();
      }
      await page.screenshot({
        path: `docs/screenshots/critical-mail-${label}.png`,
        fullPage: true,
        scale: "css",
      });
      results.push({
        device: label,
        case: "actual member QR email status UI: pending/accepted/delivered/error/unknown remain distinct",
        result: "PASS",
      });
      results.push({
        device: label,
        case: "real shift report rendering: admin 42.50, own collaborator 17.50, member/operator separated, server Madrid day",
        result: "PASS",
      });
    }
    assert.equal(writes, 0, "No automatic saves");
    assert.deepEqual(errors, []);
    console.log("PASS critical browser " + label);
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile(
  "docs/CRITICAL_BROWSER_RESULTS.json",
  JSON.stringify({ physical: false, externalServices: false, results }, null, 2),
);
