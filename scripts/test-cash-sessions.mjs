import { cashBrowserFixture } from "./lib/cash-browser-fixture.mjs";
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
  club = "00000000-0000-4000-8000-000000000101",
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

const sessionA = "20000000-0000-4000-8000-000000000001",
  sessionB = "20000000-0000-4000-8000-000000000002",
  newSession = "20000000-0000-4000-8000-000000000003";
const other = "00000000-0000-4000-8000-000000000002";
const day = "2026-01-10";
const outcomes = [];
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
    let staff = false,
      opened = 0,
      closed = 0,
      rawWrites = 0;
    const sessions = [
      {
        id: sessionA,
        user_id: uid,
        opened_at: day + "T09:00:00Z",
        closed_at: day + "T11:00:00Z",
        closed_by: uid,
        opening_cash_cents: 999999,
        closing_cash_cents: 1000,
        status: "closed",
      },
      {
        id: sessionB,
        user_id: other,
        opened_at: day + "T11:00:00Z",
        closed_at: day + "T12:00:00Z",
        closed_by: other,
        opening_cash_cents: 888888,
        closing_cash_cents: 2000,
        status: "closed",
      },
    ];
    const orders = [
      {
        id: "o1",
        created_by: uid,
        created_at: day + "T10:00:00Z",
        cash_session_id: sessionA,
        status: "completed",
        total_cents: 1000,
      },
      {
        id: "o2",
        created_by: other,
        created_at: day + "T11:30:00Z",
        cash_session_id: sessionB,
        status: "completed",
        total_cents: 2000,
      },
      {
        id: "outside",
        created_by: uid,
        created_at: day + "T14:00:00Z",
        cash_session_id: null,
        status: "completed",
        total_cents: 300,
      },
      {
        id: "cancelled",
        created_by: uid,
        created_at: day + "T10:00:00Z",
        cash_session_id: sessionA,
        status: "cancelled",
        total_cents: 99999,
      },
    ];
    const fees = [
      {
        id: "r1",
        recorded_by: uid,
        recorded_at: day + "T13:00:00Z",
        payment_method: "cash",
        amount_cents: 500,
      },
    ];
    const context = await browser.newContext({
      ...device,
      timezoneId: "America/Los_Angeles",
      serviceWorkers: "block",
    });
    await context.addInitScript(
      ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        isApi = u.origin === api.origin && (!prefix || u.pathname.startsWith(prefix + "/"));
      if (u.origin !== new URL(base).origin && !isApi) return route.abort();
      if (u.pathname.includes("_serverFn")) {
        let result = { available: false, documents: false, browserSpeech: false };
        if (req.method() === "POST") {
          const d = fromJSON(JSON.parse(req.postData())).data;
          if ("day" in d)
            result = cashBrowserFixture({
              day,
              userId: staff ? other : uid,
              admin: !staff,
              orders,
              fees,
              sessions,
              profiles: [
                { id: uid, full_name: "Ana Sintética" },
                { id: other, full_name: "Bruno Sintético" },
              ],
            });
          else if ("openingCash" in d) {
            assert.deepEqual(Object.keys(d), ["openingCash"]);
            opened++;
            sessions.push({
              id: staff ? newSession.replace(/3$/, "4") : newSession,
              user_id: staff ? other : uid,
              opened_at: day + "T15:00:00Z",
              closed_at: null,
              closed_by: null,
              opening_cash_cents: d.openingCash,
              closing_cash_cents: null,
              status: "open",
            });
            result = { id: staff ? newSession.replace(/3$/, "4") : newSession };
          } else if ("closingCash" in d) {
            assert.deepEqual(Object.keys(d).sort(), ["closingCash", "notes", "sessionId"]);
            closed++;
            const session = sessions.find((s) => s.id === d.sessionId);
            assert.equal(session.user_id, staff ? other : uid);
            Object.assign(session, {
              closed_at: day + "T16:00:00Z",
              closed_by: staff ? other : uid,
              closing_cash_cents: d.closingCash,
              notes: d.notes,
              status: "closed",
            });
            result = { id: session.id };
          }
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      let data = [];
      if (!["GET", "HEAD"].includes(req.method()) && !u.pathname.includes("/rpc/")) rawWrites++;
      if (u.pathname.endsWith("/auth/v1/user")) data = staff ? { ...user, id: other } : user;
      else if (u.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role: staff ? "collaborator" : "admin",
          status: "active",
          clubId: club,
          clubName: "Club sintético",
          permissions: ["use_cash"],
        };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/caja", { waitUntil: "networkidle" });
    await page.getByLabel("Dinero inicial (€)").fill("100");
    await page.getByRole("button", { name: "Abrir caja", exact: true }).click();
    await page.getByLabel("Dinero contado (€)").waitFor();
    assert.equal(opened, 1);
    orders.push({
      id: "new-order",
      created_by: uid,
      created_at: day + "T15:10:00Z",
      cash_session_id: newSession,
      status: "completed",
      total_cents: 700,
    });
    fees.push({
      id: "new-fee",
      recorded_by: uid,
      recorded_at: day + "T15:15:00Z",
      payment_method: "cash",
      amount_cents: 200,
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByLabel("Dinero contado (€)").fill("20");
    await page.getByLabel("Notas de cierre").fill("Cierre sintético");
    await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
    await page.getByRole("button", { name: "Abrir caja", exact: true }).waitFor();
    assert.equal(closed, 1);
    await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
    await page.getByLabel("Total del día").getByText(/47,00/).waitFor();
    await page.getByLabel("Aportaciones del día").getByText(/7,00/).waitFor();
    await page.getByLabel("Efectivo del día").getByText(/7,00/).waitFor();
    assert.equal(await page.getByRole("tab").count(), 2);
    const text = await page.locator("main").innerText();
    assert.doesNotMatch(text, /Turnos|11:00–17:00|Archivo informativo|00000000-/);
    assert.match(text, /Cerrada por: Ana Sintética/);
    assert.match(text, /Bruno Sintético/);
    assert.match(text, /Sin sesión/);
    assert.match(text, /Ingresos: 9,00/);
    assert.match(text, /No determinable: hay pagos sin método identificado/);
    const detail = page
      .locator('section[aria-label="Sesiones de caja"]')
      .locator("details")
      .filter({ hasText: "2,00" });
    await detail.locator("summary").click();
    await detail.getByText(/Cuota asociativa.*2,00/).waitFor();
    assert.match(await detail.innerText(), /Ana Sintética/);
    await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, {
      timeout: 12000,
    });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `docs/screenshots/caja-simple-${label}.png`,
      fullPage: true,
      scale: "css",
    });
    staff = true;
    const staffAuth = {
      ...auth,
      user: { ...user, id: other },
      access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: other, exp, role: "authenticated", aud: "authenticated" })}.synthetic`,
    };
    await page.addInitScript(({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)), {
      auth: staffAuth,
      key: `sb-${api.hostname.split(".")[0]}-auth-token`,
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
    await page.getByLabel("Total del día").getByText(/20,00/).waitFor();
    assert.doesNotMatch(await page.locator("main").innerText(), /Ana Sintética|47,00/);
    await page.getByRole("tab", { name: "Mi caja", exact: true }).click();
    await page.getByLabel("Dinero inicial (€)").fill("0");
    await page.getByRole("button", { name: "Abrir caja", exact: true }).click();
    await page.getByLabel("Dinero contado (€)").waitFor();
    assert.equal(opened, 2);
    fees.push({
      id: "staff-associative-fee",
      recorded_by: other,
      recorded_at: day + "T15:30:00Z",
      payment_method: "cash",
      amount_cents: 35000,
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(/Efectivo esperado: 350,00/).waitFor();
    assert.equal(await page.getByLabel("Dinero contado (€)").inputValue(), "");
    await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
    assert.equal(closed, 1, "empty counted cash must not close a session");
    await page.getByLabel("Dinero contado (€)").fill("345");
    await page.getByLabel("Notas de cierre").fill("Faltan 5 euros: prueba sintética");
    await page.getByText(/Diferencia: -5,00/).waitFor();
    await page.getByRole("button", { name: "Cerrar caja", exact: true }).click();
    await page.getByRole("button", { name: "Abrir caja", exact: true }).waitFor();
    assert.equal(closed, 2);
    await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
    await page
      .getByLabel("Total del día")
      .getByText(/370,00/)
      .waitFor();
    await page
      .getByLabel("Aportaciones del día")
      .getByText(/350,00/)
      .waitFor();
    await page.getByText("Notas: Faltan 5 euros: prueba sintética", { exact: true }).waitFor();
    await page.getByText(/Diferencia: -5,00/).waitFor();
    await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"), null, {
      timeout: 12000,
    });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({
      path: `docs/screenshots/caja-reconciliation-${label}.png`,
      fullPage: true,
      scale: "css",
    });
    assert.equal(rawWrites, 0);
    assert.deepEqual(errors, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    outcomes.push({
      device: label,
      result: "PASS",
      physical: false,
      transport: "mocked server functions; session logic/SQL tested separately",
      checks: [
        "open/close/reopen by another employee",
        "automatic actor/time from response",
        "session and whole-day totals including outside sessions",
        "no opening fund/cancelled orders in income",
        "no fixed shifts/UUIDs",
        "own collaborator only",
        "associative receipts separated from other recorded income and unknown payment methods",
        "expandable session movements and closing reconciliation",
        "350 euro associative cash receipt, 345 counted, -5 difference, persisted notes",
        "blank counted input cannot close session",
      ],
    });
    console.log("PASS simple Caja " + label);
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile("docs/CAJA_BROWSER_RESULTS.json", JSON.stringify({ outcomes }, null, 2));
