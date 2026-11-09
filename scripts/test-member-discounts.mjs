import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3091";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
);
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  mid = "20000000-0000-4000-8000-000000000001",
  did = "30000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "discounts@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
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
for (const [label, engine, device] of [
  ["samsung", chromium, { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } }],
  ["iphone-webkit", webkit, devices["iPhone 13"]],
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
    for (const mode of ["admin", "staff", "missing-schema"]) {
      const context = await browser.newContext({ ...device, serviceWorkers: "block" });
      await context.addInitScript(
        ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
        { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
      );
      let discount = null,
        assigned = null,
        writes = 0,
        failedOnce = false;
      const errors = [];
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url());
        if (u.origin !== api.origin) {
          if (u.origin !== new URL(base).origin) return route.abort();
          if (u.pathname.includes("_serverFn"))
            return route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({ result: { available: false, documents: false }, context: {} }),
            });
          return route.continue();
        }
        const headers = {
          "access-control-allow-origin": new URL(base).origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers":
            req.headers()["access-control-request-headers"] ||
            "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        };
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        let data = [],
          status = 200;
        const object = req.headers().accept?.includes("vnd.pgrst.object+json");
        if (u.pathname.endsWith("/auth/v1/user")) data = user;
        else if (u.pathname.endsWith("/rpc/snoop_access_context"))
          data = {
            role: mode === "staff" ? "collaborator" : "admin",
            status: "active",
            clubId: club,
            clubName: "Club sintético",
            permissions: ["manage_members", "use_cash"],
          };
        else if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
        else if (u.pathname.endsWith("/rpc/is_super_admin")) data = false;
        else if (u.pathname.endsWith("/members"))
          data = {
            id: mid,
            club_id: club,
            member_number: "TEST-01",
            first_name: "Persona",
            last_name: "Sintética",
            birth_date: "1990-01-01",
            dni_number: "TEST",
            joined_at: "2026-01-01",
            expires_at: "2026-12-31",
            email: "",
            phone: "",
            city: "",
          };
        else if (u.pathname.endsWith("/member_discounts")) {
          assert.equal(
            u.searchParams.get("club_id") || req.postDataJSON()?.club_id,
            req.method() === "POST" ? club : `eq.${club}`,
          );
          if (mode === "missing-schema") {
            status = 404;
            data = { code: "PGRST205", message: "synthetic unavailable" };
          } else if (req.method() === "GET") data = discount ? [discount] : [];
          else {
            assert.equal(mode, "admin");
            writes++;
            if (!failedOnce) {
              failedOnce = true;
              status = 500;
              data = { message: "synthetic failure" };
            } else {
              discount = { ...discount, ...req.postDataJSON(), id: did };
              data = object ? discount : [discount];
            }
          }
        } else if (u.pathname.endsWith("/member_discount_assignments")) {
          if (req.method() === "GET") {
            assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
            assert.equal(u.searchParams.get("member_id"), `eq.${mid}`);
            data = assigned ? { discount_id: assigned } : null;
          } else {
            assert.equal(mode, "admin");
            writes++;
            if (req.method() === "DELETE") {
              assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
              assert.equal(u.searchParams.get("member_id"), `eq.${mid}`);
              assigned = null;
              data = null;
            } else {
              const p = req.postDataJSON();
              assert.equal(p.club_id, club);
              assert.equal(p.member_id, mid);
              assigned = p.discount_id;
              data = { discount_id: assigned };
            }
          }
        } else if (!["GET"].includes(req.method()) && !u.pathname.includes("/rpc/"))
          throw new Error(`Unexpected write: ${u.pathname}`);
        return route.fulfill({
          status,
          headers,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      if (mode === "admin") {
        await page.goto(base + "/ajustes/socios");
        await page.getByRole("button", { name: "Nuevo descuento", exact: true }).click();
        await page.getByLabel("Nombre", { exact: true }).fill("Participación");
        await page.getByLabel("Porcentaje (%)", { exact: true }).fill("12,50");
        await page.getByLabel("Válido desde").fill("2026-01-01");
        await page.getByLabel("Válido hasta").fill("2027-12-31");
        await page.getByRole("button", { name: "Guardar descuento", exact: true }).click();
        await page
          .getByText("No se pudo guardar el descuento. Se conserva el formulario.")
          .waitFor();
        assert.equal(
          await page.getByLabel("Nombre", { exact: true }).inputValue(),
          "Participación",
        );
        assert.equal(
          await page.getByLabel("Porcentaje (%)", { exact: true }).inputValue(),
          "12,50",
        );
        await page.getByRole("button", { name: "Guardar descuento", exact: true }).click();
        await page.getByText("Participación · 12.5%", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Editar", exact: true }).click();
        await page.getByLabel("Activo", { exact: true }).uncheck();
        await page.getByRole("button", { name: "Guardar descuento", exact: true }).click();
        await page.getByText(/Inactivo ·/).waitFor();
        await page.getByRole("button", { name: "Editar", exact: true }).click();
        await page.getByLabel("Activo", { exact: true }).check();
        await page.getByRole("button", { name: "Guardar descuento", exact: true }).click();
        await page.getByText(/Activo ·/).waitFor();
        await page
          .locator("[data-sonner-toast]")
          .evaluateAll((nodes) => nodes.forEach((n) => n.remove()));
        await page.screenshot({
          path: `docs/discounts-${label}-settings.png`,
          fullPage: true,
          scale: "css",
        });
        await page.waitForLoadState("networkidle");
      }
      await page.goto(base + `/soci/${mid}`);
      await page.getByRole("heading", { name: "Descuento del socio", exact: true }).waitFor();
      if (mode === "admin") {
        await page.getByLabel("Descuento asignado").selectOption(did);
        await page.getByRole("button", { name: "Guardar asignación", exact: true }).click();
        await page.getByText("Participación · 12.5% · Activo", { exact: true }).first().waitFor();
        assert.equal(assigned, did);
        await page.getByLabel("Descuento asignado").selectOption("");
        await page.getByRole("button", { name: "Guardar asignación", exact: true }).click();
        await page.getByText("Sin descuento asignado", { exact: true }).waitFor();
        assert.equal(assigned, null);
        await page.getByLabel("Descuento asignado").selectOption(did);
        await page.getByRole("button", { name: "Guardar asignación", exact: true }).click();
        await page.getByText("Participación · 12.5% · Activo", { exact: true }).first().waitFor();
      } else if (mode === "staff") {
        await page.getByText("Sin descuento asignado", { exact: true }).waitFor();
        assert.equal(
          await page.getByRole("button", { name: "Guardar asignación", exact: true }).count(),
          0,
        );
        assert.equal(writes, 0);
      } else {
        await page.getByText("Descuentos pendientes de activación en la base de datos.").waitFor();
        assert.equal(writes, 0);
      }
      await page.getByText("Historial de pedidos", { exact: true }).waitFor();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      );
      assert.deepEqual(errors, []);
      if (mode === "admin") {
        await page
          .locator("[data-sonner-toast]")
          .evaluateAll((nodes) => nodes.forEach((n) => n.remove()));
        await page.screenshot({
          path: `docs/discounts-${label}-member.png`,
          fullPage: true,
          scale: "css",
        });
      }
      results.push({ browser: label, mode, status: "PASS", writes });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  "docs/MEMBER_DISCOUNTS_BROWSER_RESULTS.json",
  JSON.stringify({ synthetic: true, physicalDevice: false, results }, null, 2) + "\n",
);
console.log(JSON.stringify(results));
