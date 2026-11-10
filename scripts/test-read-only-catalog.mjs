import { checkOrderKeyboard, installOrderViewport } from "./order-keyboard-checks.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3081";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  process.env.TEST_SUPABASE_URL ||
    (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  member = "20000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "catalog-test@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
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
const cats = [
  { id: "office", club_id: club, name: "Material de oficina", unit_type: "unit", archived: false },
  { id: "paper", club_id: club, name: "Papel", unit_type: "unit", archived: false },
  { id: "empty", club_id: club, name: "Sin artículos", unit_type: "unit", archived: false },
];
const rows = [
  {
    id: "notebook",
    club_id: club,
    category_id: "office",
    name: "Cuaderno sintético",
    stock: 0,
    sell_price: 0,
    active: true,
  },
  {
    id: "sheet",
    club_id: club,
    category_id: "paper",
    name: "Hoja de prueba",
    stock: 2,
    sell_price: 0,
    active: true,
  },
];
const keyboard = process.argv.includes("--keyboard");
if (keyboard) {
  cats[1].unit_type = "gr";
  rows[1].sell_price = 10;
  rows[1].stock = 20;
  for (let i = 0; i < 8; i++)
    rows.push({
      ...rows[1],
      id: `paper-${i}`,
      name: `Muestra administrativa sintética ${i} con nombre largo`,
    });
}
const outcomes = [];
for (const [label, engine, device] of [
  ["samsung", chromium, { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } }],
  ["iphone-webkit", webkit, devices["iPhone 13"]],
  ...(keyboard ? [["iphone-pwa-webkit", webkit, devices["iPhone 13"]]] : []),
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
    for (const scenario of keyboard
      ? ["loaded"]
      : [
          "loaded",
          "error",
          "empty",
          "inactive",
          "forbidden",
          "category-error",
          "scope-error",
          "denied",
        ]) {
      let mode = scenario,
        writes = 0,
        productReads = 0;
      let release;
      const held = new Promise((resolve) => (release = resolve));
      const context = await browser.newContext({
        ...device,
        ...(keyboard ? { viewport: { width: 390, height: 844 } } : {}),
        serviceWorkers: "block",
      });
      if (keyboard) await context.addInitScript(installOrderViewport);
      if (label === "iphone-pwa-webkit")
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
          const native = window.matchMedia.bind(window);
          window.matchMedia = (q) =>
            q === "(display-mode: standalone)" ? { ...native(q), matches: true } : native(q);
        });
      await context.addInitScript(
        ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
        { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
      );
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url()),
          isApi = u.origin === api.origin;
        if (u.origin !== new URL(base).origin && !isApi) return route.abort();
        if (u.pathname.includes("_serverFn")) {
          if (req.method() === "POST") {
            const payload = fromJSON(JSON.parse(req.postData())).data;
            assert.ok(
              payload == null || Object.keys(payload).length === 0,
              "only the read-only AI availability check is expected",
            );
          }
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ result: { available: false, documents: false }, context: {} }),
          });
        }
        if (!isApi) return route.continue();
        const headers = {
          "access-control-allow-origin": new URL(base).origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers":
            req.headers()["access-control-request-headers"] ||
            "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        };
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        let data = [],
          status = 200;
        if (u.pathname.endsWith("/auth/v1/user")) data = user;
        else if (u.pathname.endsWith("/rpc/snoop_access_context"))
          data = {
            role: "collaborator",
            status: "active",
            clubId: club,
            clubName: "Club de prueba",
            permissions:
              scenario === "denied" ? ["manage_members"] : ["manage_members", "use_cash"],
          };
        else if (u.pathname.endsWith("/members")) {
          // The existing parent member route also performs its own RLS-bound lookup.
          // Scope assertions here target the child catalog screen's limited lookup.
          if (u.searchParams.get("select") === "first_name,last_name,member_number") {
            assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
            data = { first_name: "Persona", last_name: "de prueba", member_number: "TEST" };
          } else data = null;
        } else if (u.pathname.endsWith("/products") || u.pathname.endsWith("/product_categories")) {
          assert.equal(req.method(), "GET", "catalog must be read-only");
          assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
          assert.doesNotMatch(u.searchParams.get("select"), /\(|buy_price/);
          if (u.pathname.endsWith("/products")) {
            productReads++;
            if (mode === "loaded") await held;
            if (mode === "error" || mode === "forbidden") {
              status = 400;
              data = {
                code: mode === "forbidden" ? "42501" : "PGRST201",
                message: "Synthetic database detail that must stay hidden",
              };
            } else
              data =
                mode === "empty"
                  ? []
                  : rows.map((p) => ({
                      ...p,
                      ...(mode === "inactive" ? { active: false } : {}),
                      ...(mode === "scope-error" ? { club_id: "foreign" } : {}),
                    }));
          } else data = mode === "category-error" ? [] : cats;
        } else if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
        else if (
          u.pathname.endsWith("/rpc/is_super_admin") ||
          u.pathname.endsWith("/rpc/is_current_user_club_admin")
        )
          data = false;
        else if (req.method() !== "GET") {
          writes++;
          throw new Error("Unexpected database write");
        }
        return route.fulfill({
          status,
          headers,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/soci/${member}/pedido`, { waitUntil: "domcontentloaded" });
      const catalog = page.getByTestId("catalogo-lectura");
      if (scenario === "loaded") {
        await catalog.getByText("Cargando catálogo…", { exact: true }).waitFor();
        assert.equal(await catalog.getByText(/No hay productos/).count(), 0);
        release();
        await catalog.getByText("Cuaderno sintético", { exact: true }).waitFor();
        await catalog.getByText("Hoja de prueba", { exact: true }).waitFor();
        if (keyboard) {
          if (process.argv.includes("--baseline-pan"))
            await page.addStyleTag({
              content: "input { font-size:16px!important; min-width:0!important; }",
            });
          await checkOrderKeyboard(page, catalog, label);
          assert.equal(writes, 0);
          assert.deepEqual(errors, []);
          await context.close();
          outcomes.push({
            device: label,
            result: "PASS",
            physical: false,
            keyboard: "synthetic VisualViewport; not physical iOS keyboard",
            standalone: label === "iphone-pwa-webkit",
            databaseWrites: writes,
          });
          console.log("PASS order keyboard", label);
          continue;
        }
        const search = catalog.getByPlaceholder("Buscar producto por nombre…");
        await search.fill("sintetico");
        await catalog.getByText("Cuaderno sintético", { exact: true }).waitFor();
        assert.equal(await catalog.getByText("Hoja de prueba", { exact: true }).count(), 0);
        await search.fill("");
        await catalog.getByRole("button", { name: "Papel", exact: true }).click();
        await catalog.getByText("Hoja de prueba", { exact: true }).waitFor();
        assert.equal(await catalog.getByText("Cuaderno sintético", { exact: true }).count(), 0);
        await catalog.getByRole("button", { name: "Sin artículos", exact: true }).click();
        await catalog.getByText(/No hay coincidencias/).waitFor();
        await catalog.getByRole("button", { name: "Limpiar filtros", exact: true }).click();
        await catalog.getByText("Cuaderno sintético", { exact: true }).waitFor();
        await mkdir("docs/screenshots", { recursive: true });
        await catalog.screenshot({ path: `docs/screenshots/catalog-read-only-${label}.png` });
      } else if (scenario === "error") {
        await catalog
          .getByRole("alert")
          .getByText(/PGRST201/)
          .waitFor();
        assert.doesNotMatch(
          await catalog.innerText(),
          /Synthetic database detail|No hay productos/,
        );
        mode = "recovered";
        await catalog.getByRole("button", { name: "Reintentar catálogo", exact: true }).click();
        await catalog.getByText("Cuaderno sintético", { exact: true }).waitFor();
      } else if (scenario === "empty")
        await catalog
          .getByText("No hay productos visibles en el catálogo de este club.", { exact: true })
          .waitFor();
      else if (scenario === "inactive")
        await catalog
          .getByText("No hay productos activos en las categorías disponibles.", { exact: true })
          .waitFor();
      else if (scenario === "forbidden")
        await catalog.getByRole("alert").getByText(/42501/).waitFor();
      else if (scenario === "category-error")
        await catalog
          .getByRole("alert")
          .getByText(/CATALOG_CATEGORY/)
          .waitFor();
      else if (scenario === "scope-error")
        await catalog
          .getByRole("alert")
          .getByText(/CATALOG_SCOPE/)
          .waitFor();
      else {
        await catalog
          .getByRole("alert")
          .getByText("No tienes permiso para consultar este catálogo.", { exact: true })
          .waitFor();
        assert.equal(productReads, 0);
      }
      assert.equal(writes, 0);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.waitForLoadState("networkidle");
      await context.close();
      outcomes.push({
        device: label,
        scenario,
        result: "PASS",
        physical: false,
        transport: "synthetic read-only API responses",
        databaseWrites: writes,
      });
      console.log(`PASS catalog read-only ${label}: ${scenario}`);
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  keyboard ? "docs/ORDER_KEYBOARD_RESULTS.json" : "docs/CATALOG_READ_BROWSER_RESULTS.json",
  JSON.stringify({ outcomes }, null, 2),
);
