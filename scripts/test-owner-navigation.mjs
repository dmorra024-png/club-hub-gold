import assert from "node:assert/strict";
import { chromium, devices } from "playwright-core";
const base = "http://127.0.0.1:3000";
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "owner@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const encode = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: uid, exp, aud: "authenticated", role: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
let checks = 0;
try {
  for (const device of ["Pixel 7", "iPhone 13"]) {
    for (const hasClub of [true, false]) {
      const context = await browser.newContext({ ...devices[device], serviceWorkers: "block" });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (!url.pathname.startsWith("/sandbox-api/")) return route.continue();
        let body = [];
        if (url.pathname.endsWith("/auth/v1/user")) body = user;
        else if (url.pathname.endsWith("/rpc/current_club_id")) body = hasClub ? club : null;
        else if (url.pathname.endsWith("/user_roles"))
          body = [
            { user_id: uid, role: "super_admin", club_id: null, permissions: [] },
            ...(hasClub ? [{ user_id: uid, role: "admin", club_id: club, permissions: [] }] : []),
          ];
        else if (url.pathname.endsWith("/clubs"))
          body = hasClub ? [{ id: club, name: "Synthetic Pilot", logo_url: null }] : [];
        else if (url.pathname.endsWith("/rpc/membership_receipt_report")) body = [];
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
      await page.getByRole("button", { name: "Abrir menú" }).click();
      await page
        .locator("nav")
        .getByRole("link", { name: "Snoop Admin", exact: true })
        .waitFor({ state: "visible" });
      checks++;
      if (hasClub) {
        for (const label of ["Socios", "Ajustes", "Cuotas e ingresos"]) {
          await page
            .locator("nav")
            .getByRole("link", { name: label, exact: true })
            .waitFor({ state: "visible" });
          checks++;
        }
        assert.ok(await page.getByText("Synthetic Pilot", { exact: true }).count());
        checks++;
        await page.goto(base + "/cuotas", { waitUntil: "networkidle" });
        assert.equal(
          await page
            .locator("select")
            .filter({ has: page.locator(`option[value="${club}"]`) })
            .inputValue(),
          club,
        );
        checks++;
      } else {
        assert.equal(
          await page.locator("nav").getByRole("link", { name: "Socios", exact: true }).count(),
          0,
        );
        checks++;
      }
      // Original missing logo must fall back accessibly instead of broken image.
      await page
        .getByRole("img", { name: "Snoop", exact: true })
        .first()
        .waitFor({ state: "visible" });
      checks++;
      assert.equal(await page.locator("body").evaluate((e) => e.scrollWidth > innerWidth), false);
      checks++;
      console.log("PASS", device, hasClub ? "owner + club" : "platform-only owner");
      await context.close();
    }
  }
  console.log(
    "PASS",
    checks,
    "browser assertions. Synthetic API only; iPhone uses Chromium emulation, not Safari.",
  );
} finally {
  await browser.close();
}
