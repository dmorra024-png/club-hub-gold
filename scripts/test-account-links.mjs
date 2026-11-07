import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const configured =
  process.env.TEST_SUPABASE_URL ||
  (process.env.TEST_BASE_URL
    ? (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1]
    : "/sandbox-api");
const api = new URL(configured, base),
  prefix = api.pathname.replace(/\/$/, "");
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  role = "20000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const exp = Math.floor(Date.now() / 1000) + 3600,
  enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const engines = [
  ["Android", chromium, devices["Pixel 7"]],
  ["iPhone Chromium", chromium, devices["iPhone 13"]],
];
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
  try {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    let regen = 0,
      otp = 0,
      updates = 0,
      mutations = 0;
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        isApi = url.origin === api.origin && (!prefix || url.pathname.startsWith(prefix + "/"));
      if (url.origin !== new URL(base).origin && !isApi) return route.abort();
      if (url.pathname.includes("_serverFn")) {
        let result = [
          {
            id: role,
            user_id: uid,
            role: "collaborator",
            full_name: "Persona Sintetica",
            email: "synthetic@example.test",
            permissions: ["manage_members"],
          },
        ];
        if (req.method() === "POST") {
          const data = fromJSON(JSON.parse(req.postData())).data;
          assert.equal(data.role_id, role);
          regen++;
          result = {
            ok: true,
            recovery_url:
              "https://snoop-pilot.dmorra024.workers.dev/reset-password#token_hash=synthetic-" +
              regen +
              "&type=recovery",
          };
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      let result = [],
        status = 200;
      if (url.pathname.endsWith("/auth/v1/verify")) {
        otp++;
        const body = req.postDataJSON();
        if (body.token_hash === "expired") {
          status = 403;
          result = { msg: "Enlace caducado", error_code: "otp_expired" };
        } else result = auth;
      } else if (url.pathname.endsWith("/auth/v1/user")) {
        if (req.method() === "PUT") updates++;
        result = user;
      } else if (url.pathname.endsWith("/rpc/snoop_access_context"))
        result = {
          role: "admin",
          status: "active",
          clubId: club,
          clubName: "Synthetic",
          permissions: [
            "manage_members",
            "manage_products",
            "manage_collaborators",
            "use_cash",
            "view_reports",
          ],
        };
      else if (url.pathname.endsWith("/rpc/current_club_id")) result = club;
      else if (url.pathname.endsWith("/clubs")) result = [{ id: club, name: "Synthetic" }];
      else if (url.pathname.endsWith("/user_roles"))
        result = [{ id: role, user_id: uid, club_id: club, role: "admin", permissions: [] }];
      else if (req.method() !== "GET" && req.method() !== "OPTIONS") mutations++;
      if (req.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(result))
        result = result[0] ?? null;
      return route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
        body: JSON.stringify(result),
      });
    });
    await context.addInitScript(
      ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("dialog", (d) => d.accept());
    await page.goto(base + "/ajustes/colaboradores", { waitUntil: "networkidle" });
    for (let n = 1; n <= 2; n++) {
      await page
        .getByRole("button", { name: "Regenerar enlace para Persona Sintetica", exact: true })
        .click();
      await page.waitForFunction(
        (n) =>
          document
            .querySelector('input[aria-label="Enlace de un solo uso"]')
            ?.value.includes("synthetic-" + n),
        n,
      );
      const value = await page.getByLabel("Enlace de un solo uso", { exact: true }).inputValue();
      const link = new URL(value);
      assert.equal(link.origin, "https://snoop-pilot.dmorra024.workers.dev");
      assert.equal(link.search, "");
      assert.equal(link.pathname, "/reset-password");
    }
    assert.equal(regen, 2);
    assert.equal(mutations, 0);
    assert.equal(updates, 0);
    for (const type of ["invite", "recovery"]) {
      const before = otp;
      await page.goto(base + "/reset-password#token_hash=synthetic-" + type + "&type=" + type, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("button", { name: "Actualizar", exact: true })
        .waitFor({ state: "visible" });
      await page
        .getByPlaceholder("Nueva contraseña (mínimo 8 caracteres)")
        .fill("Synthetic-only-2026!");
      await page.getByPlaceholder("Repite contraseña").fill("Synthetic-only-2026!");
      await page.getByRole("button", { name: "Actualizar", exact: true }).click();
      await page.waitForURL(base + "/");
      await page.waitForLoadState("networkidle");
      assert.equal(otp, before + 1, "consume OTP exactly once");
      assert.equal(await page.evaluate(() => location.hash), "");
    }
    const before = updates;
    await page.goto(base + "/reset-password#token_hash=expired&type=recovery", {
      waitUntil: "networkidle",
    });
    await page.getByText("Enlace no válido", { exact: true }).waitFor();
    assert.equal(updates, before);
    assert.equal(updates, 2);
    assert.equal(mutations, 0);
    console.log(
      "PASS " +
        label +
        ": regenerate direct canonical link; invite/recovery password setup; one-use consumption; expired link; zero account/role database mutations (isolated APIs)",
    );
  } finally {
    await browser.close();
  }
}
