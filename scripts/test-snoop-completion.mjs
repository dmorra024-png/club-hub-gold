import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const configured =
  process.env.TEST_SUPABASE_URL ||
  (process.env.TEST_BASE_URL
    ? (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)?.[1]
    : "/sandbox-api");
const api = new URL(configured, base),
  apiPrefix = api.pathname.replace(/\/$/, "");
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const catId = "20000000-0000-4000-8000-000000000001",
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
const picture = await readFile("public/icons/app-192.png");
const engines = [
  [
    "Android Chromium",
    chromium,
    devices["Pixel 7"],
    {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  ],
  [
    "iPhone Chromium emulation",
    chromium,
    devices["iPhone 13"],
    {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
  ],
];
if (process.env.TEST_WEBKIT === "true")
  engines.push(["iPhone WebKit", webkit, devices["iPhone 13"], {}]);
const results = [];
for (const [label, engine, device, options] of engines) {
  const browser = await engine.launch({ ...options, headless: true });
  const context = await browser.newContext({
    ...device,
    serviceWorkers: "block",
  });
  let role = "admin",
    permissions = [
      "manage_members",
      "manage_products",
      "view_reports",
      "use_cash",
      "manage_collaborators",
    ];
  let categories = [
      {
        id: catId,
        club_id: club,
        name: "Synthetic resources",
        unit_type: "unit",
        is_smokeable: false,
        archived: false,
      },
    ],
    products = [
      {
        id: pid,
        club_id: club,
        category_id: catId,
        name: "Synthetic Cup",
        stock: 10,
        buy_price: 0,
        sell_price: 0,
        notes: "",
        strain: null,
        active: true,
        image_url: null,
        description: null,
      },
    ],
    history = [],
    invites = [],
    writes = [],
    passwordUpdates = 0,
    otp = 0;
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const isApi =
      url.origin === api.origin && (!apiPrefix || url.pathname.startsWith(apiPrefix + "/"));
    if (url.origin !== base && !isApi) {
      if (url.hostname === "upload.wikimedia.org")
        return route.fulfill({ contentType: "image/png", body: picture });
      return route.abort();
    }
    if (url.pathname.includes("_serverFn")) {
      let result = [];
      if (req.method() === "POST") {
        const data = fromJSON(JSON.parse(req.postData())).data;
        if (data.email && data.full_name) {
          invites.push(data);
          result = {
            user_id: uid,
            email: data.email,
            invited: true,
            email_accepted: invites.length === 1,
            invitation_url:
              invites.length === 1
                ? null
                : base + "/reset-password#token_hash=synthetic-invite&type=invite",
          };
        } else if (data.name)
          result = {
            description: "Ficha informativa sintética; detalles pendientes de verificación.",
            image_url: "",
            images: [
              {
                url: "https://upload.wikimedia.org/test/Synthetic_Cup.jpg",
                source: "https://commons.wikimedia.org/wiki/File:Synthetic_Cup.jpg",
                title: "Synthetic Cup",
                author: "Synthetic Author",
                license: "CC BY-SA 4.0",
                license_url: "https://creativecommons.org/licenses/by-sa/4.0/",
              },
            ],
            warning: "Comprueba la coincidencia exacta.",
          };
        else result = { available: false, documents: false, browserSpeech: false };
      }
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ result, context: {} }),
      });
    }
    if (!isApi) return route.continue();
    let result = [],
      status = 200;
    if (url.pathname.endsWith("/auth/v1/user")) {
      if (req.method() === "PUT") {
        passwordUpdates++;
        assert.equal(typeof req.postDataJSON().password, "string");
      }
      result = user;
    } else if (url.pathname.endsWith("/auth/v1/verify")) {
      otp++;
      assert.equal(req.postDataJSON().token_hash, "synthetic-invite");
      result = auth;
    } else if (url.pathname.endsWith("/auth/v1/logout")) result = {};
    else if (url.pathname.endsWith("/rpc/snoop_access_context"))
      result = {
        role,
        status: "active",
        clubId: club,
        clubName: "Synthetic Club",
        permissions,
      };
    else if (url.pathname.endsWith("/rpc/current_club_id")) result = club;
    else if (url.pathname.endsWith("/rpc/is_super_admin")) result = false;
    else if (url.pathname.endsWith("/user_roles"))
      result = [{ id: "role", user_id: uid, club_id: club, role, permissions }];
    else if (url.pathname.endsWith("/clubs")) result = [{ id: club, name: "Synthetic Club" }];
    else if (url.pathname.endsWith("/product_categories")) {
      if (req.method() === "DELETE") {
        const id = url.searchParams.get("id")?.slice(3);
        result = categories.filter((c) => c.id === id).map((c) => ({ id: c.id }));
        categories = categories.filter((c) => c.id !== id);
        writes.push("delete_category");
      } else result = categories;
    } else if (url.pathname.endsWith("/products")) {
      if (req.method() === "PATCH") {
        const patch = req.postDataJSON();
        Object.assign(products[0], patch);
        writes.push("product_patch");
        result = [products[0]];
      } else
        result = products.filter(
          (p) =>
            !url.searchParams.has("category_id") ||
            p.category_id === url.searchParams.get("category_id").slice(3),
        );
    } else if (url.pathname.endsWith("/stock_movements")) result = history;
    else if (url.pathname.endsWith("/rpc/manage_administrative_category")) {
      const d = req.postDataJSON();
      Object.assign(
        categories.find((c) => c.id === d.p_id),
        { name: d.p_name, archived: d.p_archived },
      );
      writes.push("category_update");
      result = null;
    } else if (url.pathname.endsWith("/rpc/adjust_administrative_stock")) {
      const d = req.postDataJSON();
      assert.equal(d.p_expected, products[0].stock);
      products[0].stock += d.p_delta;
      history.push({
        id: "synthetic-movement",
        product_id: pid,
        delta: d.p_delta,
        notes: d.p_notes,
        created_by: uid,
        created_at: new Date().toISOString(),
        reason: "administrative_adjustment",
      });
      writes.push("stock");
      result = products[0].stock;
    } else if (url.pathname.endsWith("/rpc/save_administrative_product_checked")) {
      const d = req.postDataJSON();
      assert.equal(d.p_expected, products[0].stock);
      assert.equal(d.p_values.stock, products[0].stock);
      Object.assign(products[0], d.p_values);
      writes.push("product_save");
      result = pid;
    } else if (url.pathname.endsWith("/rpc/membership_receipt_report"))
      result = [
        {
          period: "2026-11-07",
          payment_method: "cash",
          receipts: 1,
          total_cents: 1000,
        },
      ];
    else if (url.pathname.endsWith("/membership_receipts"))
      result = [
        {
          id: "synthetic-receipt",
          member_id: uid,
          member_name: "Persona Sintetica",
          member_number: "TEST-001",
          amount_cents: 1000,
          payment_method: "cash",
          recorded_at: new Date().toISOString(),
          operator_name: "Synthetic Operator",
          description: "Inscripción sintética",
        },
      ];
    if (req.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(result))
      result = result[0] ?? null;
    return route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "content-range": `0-${Math.max(result?.length - 1, 0)}/${result?.length ?? 1}`,
      },
      body: JSON.stringify(result),
    });
  });
  const authKey = `sb-${api.hostname.split(".")[0]}-auth-token`;
  await context.addInitScript(
    ({ auth, authKey }) => localStorage.setItem(authKey, JSON.stringify(auth)),
    { auth, authKey },
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  try {
    await page.goto(base + "/productos", { waitUntil: "networkidle" });
    await page.getByLabel("Producto para ajustar stock").waitFor();
    assert.equal(
      await page
        .locator('img[src="/icons/snoop-commercial.svg"]')
        .last()
        .evaluate((img) => img.complete && img.naturalWidth > 0),
      true,
    );
    assert.equal(
      await page.getByRole("link", { name: "Cuotas e ingresos", exact: true }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      "mobile overflow",
    );
    await page.getByRole("button", { name: "Crear categoría", exact: true }).first().click();
    assert.equal(
      await page.getByRole("button", { name: "Eliminar", exact: true }).isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page.getByLabel("Nuevo nombre de categoría").fill("Synthetic renamed");
    await page.getByRole("button", { name: "Guardar categoría", exact: true }).click();
    await page.getByText("Synthetic renamed", { exact: true }).waitFor();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Archivar", exact: true }).click();
    await page.getByText("Synthetic renamed (archivada)", { exact: true }).waitFor();
    assert.equal(products.length, 1);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Reactivar", exact: true }).click();
    await page.getByText("Synthetic renamed", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stock", exact: true }).click();
    await page.getByLabel("Producto para ajustar stock").selectOption(pid);
    await page.getByLabel("Cantidad final de stock").fill("7");
    await page.getByLabel("Motivo de la corrección").fill("Synthetic physical count");
    await page.getByRole("button", { name: "Preparar corrección", exact: true }).click();
    assert.equal(products[0].stock, 10);
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await page.waitForFunction(() => document.body.innerText.includes("Stock actual") === false);
    await page
      .getByLabel("Producto para ajustar stock")
      .getByText("Synthetic Cup — actual: 7", { exact: true })
      .waitFor({ state: "attached" });
    assert.equal(history.length, 1);
    await page.getByLabel("Editar Synthetic Cup").click();
    await page.getByLabel("Descripción manual").fill("Descripción manual sintética");
    await page.getByLabel("Cargar imagen propia").setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: picture,
    });
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.getByLabel("Editar Synthetic Cup").waitFor();
    assert.equal(products[0].description, "Descripción manual sintética");
    assert.ok(products[0].image_url.startsWith("data:image/jpeg"));
    const before = writes.length;
    await page.getByTitle("Proponer descripción e imágenes con licencia").click();
    await page
      .getByText("Propuesta de ficha — revisa antes de guardar", {
        exact: true,
      })
      .waitFor();
    assert.equal(writes.length, before, "AI must not save before confirmation");
    await page.getByRole("radio").check();
    await page.getByRole("button", { name: "Confirmar ficha", exact: true }).click();
    await page.getByText("Synthetic Author · CC BY-SA 4.0", { exact: true }).waitFor();
    assert.ok(products[0].image_attribution);
    page.once("dialog", (d) => d.accept());
    await page.getByLabel("Archivar Synthetic Cup").click();
    await page.getByRole("button", { name: "Reactivar producto", exact: true }).waitFor();
    assert.equal(products[0].active, false);
    assert.equal(history.length, 1);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Reactivar producto", exact: true }).click();
    await page.getByLabel("Editar Synthetic Cup").waitFor();
    await page.goto(base + "/caja", { waitUntil: "networkidle" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
      "Caja mobile overflow",
    );
    await page.getByRole("tab", { name: "Historial de cuotas", exact: true }).click();
    await page.getByTestId("cash-membership-summary").getByText(/10.00/).waitFor();
    await page.goto(base + "/ajustes/colaboradores", {
      waitUntil: "networkidle",
    });
    for (let n = 1; n <= 2; n++) {
      await page.getByLabel("Nombre", { exact: true }).fill("Persona");
      await page.getByLabel("Apellidos", { exact: true }).fill("Sintetica");
      await page.getByLabel("Email", { exact: true }).fill(`synthetic-${n}@example.test`);
      assert.equal(await page.locator("input[type=password]").count(), 0);
      await page.getByRole("button", { name: "Crear acceso / invitar", exact: true }).click();
      if (n === 1) {
        await page.getByText(/El proveedor de correo aceptó/).waitFor();
        assert.equal(await page.getByLabel("Enlace de un solo uso", { exact: true }).count(), 0);
      } else await page.getByLabel("Enlace de un solo uso", { exact: true }).waitFor();
    }
    assert.equal(invites[0].full_name, "Persona Sintetica");
    assert.deepEqual(invites[0].permissions, ["manage_members", "use_cash"]);
    await page.goto(base + "/reset-password#token_hash=synthetic-invite&type=invite", {
      waitUntil: "networkidle",
    });
    await page
      .getByPlaceholder("Nueva contraseña (mínimo 8 caracteres)")
      .fill("Synthetic-only-2026!");
    await page.getByPlaceholder("Repite contraseña").fill("Synthetic-only-2026!");
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await page.waitForURL(base + "/");
    assert.equal(otp, 1, "one-use link must be consumed exactly once");
    assert.equal(passwordUpdates, 1, "password must be updated exactly once");
    await page.evaluate(
      ({ auth, authKey }) => localStorage.setItem(authKey, JSON.stringify(auth)),
      { auth, authKey },
    );
    role = "collaborator";
    permissions = ["manage_members"];
    await page.goto(base + "/productos", { waitUntil: "networkidle" });
    await page.waitForURL(base + "/");
    assert.equal(await page.getByLabel("Producto para ajustar stock").count(), 0);
    await page.goto(base + "/ajustes/colaboradores", {
      waitUntil: "networkidle",
    });
    await page.waitForURL(base + "/");
    assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0);
    assert.deepEqual(pageErrors, []);
    await mkdir(".sandbox/screenshots", { recursive: true });
    await page.screenshot({
      path: ".sandbox/screenshots/completion-" + label.replaceAll(" ", "-") + ".png",
      fullPage: true,
    });
    const result = {
      device: label,
      status: "PASS",
      tests: [
        "logo, navigation, responsive",
        "category rename/archive/restore",
        "stock confirmation/history",
        "manual description/image upload",
        "AI proposal/license/explicit confirmation",
        "product archive/history/restore",
        "Caja membership report",
        "invitation acceptance/manual fallback",
        "owner password setup",
        "staff permission navigation",
      ],
      transport: "isolated HTTP doubles; SQL authorization tested separately",
    };
    results.push(result);
    console.log("PASS " + label + ": " + result.tests.join("; "));
  } catch (e) {
    console.error("FAIL " + label, e.message);
    await mkdir(".sandbox/screenshots", { recursive: true });
    await page.screenshot({
      path: ".sandbox/screenshots/failure-completion.png",
      fullPage: true,
    });
    throw e;
  } finally {
    await browser.close();
  }
}
await writeFile(".sandbox/completion-mobile-results.json", JSON.stringify(results, null, 2));
