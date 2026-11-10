import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
import { cashDataset, cashBackend, actor, club } from "./lib/cash-totals-fixture.mjs";
import { loadCash } from "../src/lib/cash-sessions.server.ts";
import { madridToday } from "../src/lib/member-administration.ts";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3143";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
const exp = Math.floor(Date.parse("2026-11-12T00:00:00Z") / 1000),
  enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const user = {
  id: actor,
  email: "synthetic@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Persona sintética A" },
};
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: actor, exp, role: "authenticated", aud: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_at: exp,
  expires_in: 86400,
  token_type: "bearer",
};
const results = [];
for (const [device, engine, profile, standalone] of [
  ["android", chromium, devices["Pixel 7"], false],
  ["iphone-webkit", webkit, devices["iPhone 13"], false],
  ["iphone-pwa-webkit", webkit, devices["iPhone 13"], true],
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
    for (const admin of [true, false]) {
      const records = cashDataset();
      let fault = null,
        now = Date.parse("2026-11-10T18:00:00Z"),
        writes = 0;
      const backend = cashBackend(records, { admin }),
        context = await browser.newContext({
          ...profile,
          timezoneId: "America/Los_Angeles",
          serviceWorkers: "block",
        });
      await context.addInitScript(
        ({ auth, key, standalone, now }) => {
          localStorage.setItem(key, JSON.stringify(auth));
          const Native = Date;
          window.__cashNow = now;
          window.Date = class extends Native {
            constructor(...args) {
              super(...(args.length ? args : [window.__cashNow]));
            }
            static now() {
              return window.__cashNow;
            }
          };
          if (standalone)
            Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
        },
        { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token`, standalone, now },
      );
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url());
        if (u.origin !== new URL(base).origin && u.origin !== api.origin) return route.abort();
        const response = (value) =>
          route.fulfill({
            contentType: "application/json",
            headers: {
              "cache-control": "no-store",
              "access-control-allow-origin": new URL(base).origin,
            },
            body: JSON.stringify(value),
          });
        if (u.pathname.includes("_serverFn")) {
          let result = { available: false, documents: false, browserSpeech: false };
          if (req.method() === "POST") {
            const data = fromJSON(JSON.parse(req.postData())).data;
            if (data && "day" in data) {
              if (fault === "error") return route.abort("failed");
              result = await loadCash(
                backend,
                { userId: actor, clubId: club },
                data.day ?? madridToday(new Date(now)),
                () => new Date(now),
              );
              if (fault === "null") result = null;
              if (fault === "bounds")
                result = {
                  ...result,
                  start: "invalid",
                  end: "invalid",
                  movements: [],
                  sessions: [],
                };
            }
          }
          return response({ result, context: {} });
        }
        if (u.origin !== api.origin) return route.continue();
        if (req.method() === "OPTIONS")
          return route.fulfill({
            status: 204,
            headers: {
              "access-control-allow-origin": base,
              "access-control-allow-headers":
                "authorization,apikey,content-type,x-client-info,x-supabase-api-version,cache-control",
            },
          });
        if (u.pathname.endsWith("/auth/v1/user")) return response(user);
        if (u.pathname.endsWith("/auth/v1/token")) return response(auth);
        if (u.pathname.endsWith("/rpc/snoop_access_context"))
          return response({
            role: admin ? "admin" : "collaborator",
            status: "active",
            clubId: club,
            clubName: "Club sintético",
            permissions: ["manage_members", "use_cash", "view_reports"],
          });
        if (u.pathname.endsWith("/rpc/current_club_id")) return response(club);
        if (req.method() !== "GET") {
          writes++;
          throw new Error("Unexpected write");
        }
        const table = u.pathname.split("/").at(-1),
          query = backend.from(table);
        const isLedger =
          ["orders", "membership_receipts"].includes(table) &&
          u.searchParams
            .get("select")
            ?.includes(table === "orders" ? "cash_session_id" : "payment_method");
        if (isLedger) {
          // WebKit routing forces no-cache even when fetch supplies no-store.
          assert.match(req.headers()["cache-control"] ?? "", /no-store|no-cache/);
          assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
          if (!admin)
            assert.equal(
              u.searchParams.get(table === "orders" ? "created_by" : "recorded_by"),
              `eq.${actor}`,
            );
          if (fault === "error")
            return route.fulfill({
              status: 500,
              contentType: "application/json",
              body: '{"message":"Synthetic read failure"}',
            });
          if (fault === "null") return response(null);
        }
        for (const [key, value] of u.searchParams) {
          const split = value.indexOf("."),
            op = value.slice(0, split),
            v = value.slice(split + 1);
          if (op === "eq") query.eq(key, v);
          if (op === "gte") query.gte(key, v);
          if (op === "lt") query.lt(key, v);
        }
        const offset = Number(u.searchParams.get("offset") ?? 0),
          limit = Number(u.searchParams.get("limit") ?? 10000);
        query.range(offset, offset + limit - 1);
        const { data } = await query;
        return response(
          req.headers().accept?.includes("vnd.pgrst.object+json") ? (data[0] ?? null) : data,
        );
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const money = async (locator, cents) => {
        await locator
          .filter({
            hasText: (cents / 100).toLocaleString("es-ES", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          })
          .waitFor();
      };
      const home = () => page.locator(".premium-cash-amount");
      await page.goto(base + "/", { waitUntil: "networkidle" });
      await money(home(), admin ? 7200 : 3400);
      assert.equal(
        await page
          .getByRole("heading", { name: admin ? "Caja de hoy" : "Mi caja de hoy", exact: true })
          .count(),
        1,
      );
      fault = "error";
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await home().filter({ hasText: "No disponible" }).waitFor();
      fault = "null";
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await home().filter({ hasText: "No disponible" }).waitFor();
      assert.doesNotMatch(await home().innerText(), /0,00/);
      fault = null;
      records.membership_receipts.push({
        id: "new-fee",
        club_id: club,
        recorded_by: actor,
        recorded_at: "2026-11-10T15:00:00Z",
        amount_cents: 100,
        payment_method: "cash",
      });
      await page.getByRole("button", { name: "Reintentar caja", exact: true }).click();
      await money(home(), admin ? 7300 : 3500);
      await page.goto(base + "/caja", { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
      await money(page.getByLabel("Total del día", { exact: true }), admin ? 7300 : 3500);
      await mkdir("docs/screenshots", { recursive: true });
      await page.screenshot({
        path: `docs/screenshots/cash-consistency-report-${device}-${admin ? "admin" : "staff"}.png`,
        scale: "css",
      });
      fault = "bounds";
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      await page.getByRole("alert").filter({ hasText: "No se pudo cargar la caja" }).waitFor();
      assert.equal(await page.getByLabel("Total del día", { exact: true }).isVisible(), false);
      fault = null;
      await page.getByRole("button", { name: "Reintentar", exact: true }).click();
      await money(page.getByLabel("Total del día", { exact: true }), admin ? 7300 : 3500);
      await page.getByRole("tab", { name: "Mi caja", exact: true }).click();
      await page.getByText("Caja abierta", { exact: false }).waitFor();
      // Clock crosses Madrid midnight while the same open session remains active.
      now = Date.parse("2026-11-10T23:10:00Z");
      await page.evaluate((now) => {
        window.__cashNow = now;
        window.dispatchEvent(new Event("pageshow"));
      }, now);
      await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
      await money(page.getByLabel("Total del día", { exact: true }), 500);
      await page.getByLabel("Fecha del informe").filter({ visible: true }).waitFor();
      assert.equal(await page.getByLabel("Fecha del informe").inputValue(), "2026-11-11");
      await page.getByRole("link", { name: "Home", exact: true }).click();
      await money(home(), 500);
      assert.equal(writes, 0);
      assert.equal(backend.writes, 0);
      assert.deepEqual(errors, []);
      await mkdir("docs/screenshots", { recursive: true });
      await page.screenshot({
        path: `docs/screenshots/cash-consistency-${device}-${admin ? "admin" : "staff"}.png`,
        scale: "css",
      });
      results.push({
        device,
        role: admin ? "admin" : "collaborator",
        result: "PASS",
        physical: false,
        standaloneSimulation: standalone,
        dayTotal: admin ? 7200 : 3400,
        updatedTotal: admin ? 7300 : 3500,
        nextDay: 500,
        transport: "synthetic read-only API; actual shared server reader",
        databaseWrites: writes,
      });
      console.log("PASS cash consistency", device, admin ? "admin" : "staff");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
await writeFile("docs/CASH_CONSISTENCY_RESULTS.json", JSON.stringify({ results }, null, 2));
