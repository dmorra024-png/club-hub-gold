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

const reports = JSON.parse(await readFile(".sandbox/cash/reports.json", "utf8"));
const outcomes = [];
await mkdir("docs/screenshots", { recursive: true });
for (const [name, engine, device] of [
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
    let downgraded = false;
    let staff = false,
      writes = 0;
    await context.addInitScript(
      ({ key, auth }) => localStorage.setItem(key, JSON.stringify(auth)),
      { key: `sb-${api.hostname.split(".")[0]}-auth-token`, auth },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        isApi = u.origin === api.origin && (!prefix || u.pathname.startsWith(prefix + "/"));
      if (u.origin !== new URL(base).origin && !isApi) return route.abort();
      if (u.pathname.includes("_serverFn")) {
        const payload = req.method() === "POST" ? fromJSON(JSON.parse(req.postData())).data : null;
        const result =
          payload && "day" in payload
            ? {
                available: true,
                report: downgraded ? reports.downgraded : staff ? reports.staff : reports.admin,
              }
            : { available: false, documents: false, browserSpeech: false };
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      let data = [];
      if (!["GET", "HEAD"].includes(req.method()) && !u.pathname.includes("/rpc/")) writes++;
      if (u.pathname.endsWith("/auth/v1/user"))
        data = staff ? { ...user, id: reports.staff.user_id } : user;
      else if (u.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role: staff || downgraded ? "collaborator" : "admin",
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
    for (const role of ["admin", "staff"]) {
      staff = role === "staff";
      if (staff) {
        const staffAuth = {
          ...auth,
          user: { ...user, id: reports.staff.user_id },
          access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: reports.staff.user_id, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
        };
        await page.addInitScript(
          ({ key, auth }) => localStorage.setItem(key, JSON.stringify(auth)),
          { key: `sb-${api.hostname.split(".")[0]}-auth-token`, auth: staffAuth },
        );
      }
      await page.goto(base + "/caja", { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "Turnos administrativos", exact: true }).click();
      const region = page.getByRole("region", { name: "Caja administrativa por turnos" });
      await region.getByText(staff ? /TOTAL PROPIO DEL DÍA/ : /TOTAL DÍA/).waitFor();
      const text = await region.innerText();
      assert.match(text, staff ? /15,00/ : /38,00/);
      if (!staff) {
        assert.match(text, /20,00/);
        assert.match(text, /3,00/);
        assert.match(text, /33,00/);
        assert.match(text, /5,00/);
      } else assert.doesNotMatch(text, /38,00|20,00|Admin sintético|Sin responsable registrado/);
      assert.match(text, /fondo inicial no es un ingreso/i);
      await region.getByText("Movimientos administrativos y atribución").click();
      assert.match(await region.innerText(), /Método de pago no registrado/);
      await page.screenshot({
        path: `docs/screenshots/caja-unified-${name}-${role}.png`,
        fullPage: true,
        scale: "css",
      });
      if (!staff) {
        downgraded = true;
        await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
        await region.getByText(/TOTAL PROPIO DEL DÍA.*20,00/).waitFor();
        assert.doesNotMatch(await region.innerText(), /38,00|15,00|3,00|Verified staff/);
        downgraded = false;
        await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
        await region.getByText(/TOTAL DÍA.*38,00/).waitFor();
      }
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        "No horizontal overflow",
      );
    }
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    outcomes.push({
      device: name,
      result: "PASS",
      checks: [
        "actual report component with SQL-produced synthetic rows",
        "admin combined sources/shift/day",
        "own collaborator only",
        "no opening funds",
        "unknown order payment is explicit",
        "responsive",
      ],
      physical: false,
    });
    console.log("PASS unified Caja " + name);
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile("docs/CAJA_BROWSER_RESULTS.json", JSON.stringify({ outcomes }, null, 2));
