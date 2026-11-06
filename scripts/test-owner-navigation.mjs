import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import { chromium, devices } from "playwright-core";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost","127.0.0.1"].includes(new URL(base).hostname),"Local synthetic test server only");
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
  exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: uid, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
  headless: true,
  args: ["--no-sandbox"],
});
let checks = 0;
const scenarios = [
  { role: "super_admin", status: "platform", permissions: [], clubId: null },
  {
    role: "admin",
    status: "active",
    permissions: [
      "manage_members",
      "manage_products",
      "manage_collaborators",
      "view_reports",
      "use_cash",
    ],
    clubId: club,
  },
  { role: "collaborator", status: "active", permissions: ["view_reports"], clubId: club },
  { role: "admin", status: "suspended", permissions: [], clubId: club },
  { role: "admin", status: "expired", permissions: [], clubId: club },
];
try {
  for (const device of ["Pixel 7", "iPhone 13"])
    for (const access of scenarios) {
      const context = await browser.newContext({ ...devices[device], serviceWorkers: "block" });
      let privateRequests = 0;
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname.includes("_serverFn"))
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ result: [], context: {} }),
          });
        if (!url.pathname.startsWith("/sandbox-api/")) return route.continue();
        let body = [];
        if (url.pathname.endsWith("/auth/v1/user")) body = user;
        else if (url.pathname.endsWith("/rpc/snoop_access_context"))
          body = { ...access, clubName: "Synthetic Pilot", clubLogo: null };
        else if (url.pathname.endsWith("/rpc/current_club_id"))
          body = access.status === "active" ? club : null;
        else if (url.pathname.endsWith("/clubs"))
          body = [{ id: club, name: "Synthetic Pilot", logo_url: null }];
        else if (
          /\/(members|products|membership_receipts|stock_movements|check_ins)$/.test(url.pathname)
        )
          privateRequests++;
        if (
          route.request().headers().accept?.includes("vnd.pgrst.object+json") &&
          Array.isArray(body)
        )
          body = body[0] ?? null;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": "0-0/0" },
          body: JSON.stringify(body),
        });
      });
      await context.addInitScript(
        ({ auth }) => localStorage.setItem("sb-127-auth-token", JSON.stringify(auth)),
        { auth },
      );
      const page = await context.newPage();
      await page.goto(base + "/", { waitUntil: "networkidle" });
      if (access.role === "super_admin") {
        assert.equal(new URL(page.url()).pathname, "/snoop-admin");
        checks++;
        await page.getByText("Administración de la plataforma", { exact: true }).waitFor();
        checks++;
        assert.equal(await page.getByRole("button", { name: "Abrir menú" }).count(), 0);
        checks++;
        assert.equal(privateRequests, 0);
        checks++;
        await page.goto(base + "/soci", { waitUntil: "networkidle" });
        assert.equal(new URL(page.url()).pathname, "/snoop-admin");
        checks++;
      } else if (access.status !== "active") {
        assert.equal(new URL(page.url()).pathname, "/club-status");
        checks++;
        await page.getByRole("status").waitFor();
        checks++;
        await page.getByRole("link", { name: "Recuperar acceso a la cuenta" }).waitFor();
        checks++;
        assert.equal(privateRequests, 0);
        checks++;
      } else {
        await page.getByRole("button", { name: "Abrir menú" }).click();
        const nav = page.locator("nav");
        if (access.role === "admin")
          for (const label of ["Socios", "Ajustes", "Cuotas e ingresos", "Informes"]) {
            await nav.getByRole("link", { name: label, exact: true }).waitFor();
            checks++;
          }
        else {
          await nav.getByRole("link", { name: "Informes", exact: true }).waitFor();
          checks++;
          assert.equal(await nav.getByRole("link", { name: "Socios", exact: true }).count(), 0);
          checks++;
          assert.equal(await nav.getByRole("link", { name: "Ajustes", exact: true }).count(), 0);
          checks++;
          await page.goto(base + "/soci", { waitUntil: "networkidle" });
          assert.equal(new URL(page.url()).pathname, "/");
          checks++;
        }
        assert.equal(
          await page.locator("nav").getByRole("link", { name: "Snoop Admin", exact: true }).count(),
          0,
        );
        checks++;
      }
      assert.equal(await page.locator("body").evaluate((e) => e.scrollWidth > innerWidth), false);
      checks++;
      console.log("PASS", device, access.role, access.status);
      await context.close();
    }
  console.log(
    "PASS",
    checks,
    "browser assertions; synthetic API only; iPhone is Chromium emulation, not Safari.",
  );
} finally {
  await browser.close();
}
