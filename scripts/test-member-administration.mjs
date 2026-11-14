import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import process from "node:process";

const origin = new URL(process.env.TEST_BASE_URL || "http://127.0.0.1:3001");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
const publicUrl =
  process.env.TEST_SUPABASE_URL ||
  readFileSync(new URL("../.env", import.meta.url), "utf8").match(
    /^VITE_SUPABASE_URL=["']?([^\s"']+)/m,
  )?.[1];
assert.ok(publicUrl, "Public Supabase URL needed to match the browser's configured endpoint");
const apiUrl = new URL(publicUrl, origin);
const apiOrigin = apiUrl.origin;
const apiPrefix = apiUrl.pathname.replace(/\/$/, "");
const userId = "00000000-0000-4000-8000-000000000001";
const clubId = "10000000-0000-4000-8000-000000000001";
const planId = "20000000-0000-4000-8000-000000000001";
const user = {
  id: userId,
  email: "admin@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const exp = Math.floor(Date.now() / 1000) + 3600;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: userId, exp, aud: "authenticated", role: "authenticated" })}.synthetic-signature`;
const session = {
  user,
  access_token: token,
  refresh_token: "synthetic-refresh-token",
  expires_in: 3600,
  expires_at: exp,
  token_type: "bearer",
};
const isWebkit = process.env.TEST_WEBKIT === "true";
const browser = await (isWebkit ? webkit : chromium).launch({
  ...(!isWebkit
    ? {
        executablePath:
          process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
          (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
        args: ["--no-sandbox"],
      }
    : {}),
  headless: true,
});
try {
  const context = await browser.newContext({
    ...(isWebkit ? devices["iPhone 13"] : {}),
    serviceWorkers: "block",
  });
  const created = [];
  const updated = [];
  let requireSignature = false;
  const plan = {
    id: planId,
    name: "Cuota Demo",
    duration_days: 30,
    price_cents: 1000,
    active: true,
  };
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const isApi =
      url.origin === apiOrigin && (!apiPrefix || url.pathname.startsWith(apiPrefix + "/"));
    if (url.origin === origin.origin && !isApi) return route.continue();
    // The only nonlocal origin is fully mocked. Never pass through to real data.
    if (!isApi) return route.abort();
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        },
      });
    let body = [];
    let status = 200;
    if (url.pathname.endsWith("/auth/v1/user")) body = user;
    else if (url.pathname.endsWith("/rpc/snoop_access_context"))
      body = {
        role: "admin",
        status: "active",
        clubId,
        clubName: "Associazione Demo",
        clubLogo: null,
        permissions: [
          "manage_members",
          "manage_products",
          "manage_collaborators",
          "view_reports",
          "use_cash",
        ],
      };
    else if (url.pathname.endsWith("/rpc/current_club_id")) body = clubId;
    else if (url.pathname.endsWith("/user_roles"))
      body = [
        {
          id: "role",
          user_id: userId,
          role: "admin",
          club_id: clubId,
          permissions: ["manage_members"],
        },
      ];
    else if (url.pathname.endsWith("/clubs"))
      body = [{ id: clubId, name: "Associazione Demo", logo_url: null }];
    else if (url.pathname.endsWith("/membership_plans")) body = [plan];
    else if (url.pathname.endsWith("/club_member_field_config"))
      body = ["dni_photo", "signature", "address", "postal_code", "email", "dni_number"].map(
        (field_key) => ({
          field_key,
          visible: field_key === "signature" && requireSignature,
          required: field_key === "signature" && requireSignature,
        }),
      );
    else if (
      url.pathname.endsWith("/rpc/save_membership_with_receipt") ||
      url.pathname.endsWith("/rpc/confirm_membership_with_receipt")
    ) {
      const payload = request.postDataJSON();
      if (url.pathname.endsWith("/rpc/confirm_membership_with_receipt")) {
        assert.deepEqual(Object.keys(payload).sort(), [
          "p_confirmed_cents",
          "p_expected",
          "p_member",
          "p_method",
          "p_plan_id",
          "p_renew",
          "p_request",
        ]);
        assert.equal(payload.p_confirmed_cents, plan.price_cents);
      }
      if (payload.p_renew) {
        const previous = created[0];
        const expiry = new Date(previous.expires_at + "T12:00:00Z");
        expiry.setUTCDate(expiry.getUTCDate() + plan.duration_days);
        const patch = {
          plan_id: payload.p_plan_id,
          expires_at: expiry.toISOString().slice(0, 10),
        };
        updated.push(patch);
        Object.assign(previous, patch);
      } else created.push({ ...payload.p_member, plan_id: payload.p_plan_id });
      body = payload.p_member.id;
    } else if (url.pathname.endsWith("/members")) {
      if (request.method() === "POST") {
        const record = request.postDataJSON();
        created.push(record);
        body = null;
        status = 201;
      } else if (request.method() === "PATCH") {
        const patch = request.postDataJSON();
        updated.push(patch);
        Object.assign(created[0], patch);
        body = null;
      } else
        body = created.map((record) => ({
          ...record,
          member_number: "0000123",
          membership_plans: plan,
        }));
    }
    if (request.headers().accept?.includes("vnd.pgrst.object+json") && Array.isArray(body))
      body = body[0] ?? null;
    return route.fulfill({
      status,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(body),
    });
  });
  await context.addInitScript(({ key, auth }) => localStorage.setItem(key, JSON.stringify(auth)), {
    key: `sb-${new URL(publicUrl).hostname.split(".")[0]}-auth-token`,
    auth: session,
  });
  const page = await context.newPage();
  await page.goto(new URL("/soci/nuovo", origin).href, {
    waitUntil: "networkidle",
  });
  const input = (name) => page.getByLabel(name, { exact: true });
  await input("Nombre *").fill("Persona");
  await input("Apellidos *").fill("Demo");
  await input("Fecha de nacimiento *").fill("2000-02-29");
  await input("Ciudad *").fill("Lugar Demo");
  await input("Teléfono *").fill("000000000");
  await page.getByRole("button", { name: /Cuota Demo/ }).click();
  await page.getByRole("button", { name: "Crear socio", exact: true }).dblclick();
  await page.getByRole("dialog").waitFor();
  assert.equal(created.length, 0, "Opening payment review must not save");
  await page.getByLabel("Dinero recibido (€)").fill("9,99");
  assert.equal(
    await page.getByRole("button", { name: "Confirmar aportación", exact: true }).isDisabled(),
    true,
  );
  await page.getByLabel("Dinero recibido (€)").fill("20");
  await page.getByLabel("Cambio", { exact: true }).getByText(/10,00/).waitFor();
  await page.getByRole("button", { name: "Confirmar aportación", exact: true }).dblclick();
  await page.waitForURL("**/soci/gestisci");
  assert.equal(created.length, 1, "Double-click must create only one record");
  assert.equal(created[0].club_id, clubId);
  assert.equal(created[0].birth_date, "2000-02-29");
  assert.equal(created[0].first_name, "Persona");
  assert.equal(created[0].plan_id, planId);
  assert.equal(created[0].dni_photo_path, "");
  const initialExpiry = created[0].expires_at;
  await page.goto(new URL(`/soci/${created[0].id}`, origin).href, {
    waitUntil: "networkidle",
  });
  await page.getByRole("button", { name: "Renovar", exact: true }).waitFor();
  await page.locator('img[src^="data:image/png"]').first().waitFor({ state: "visible" });

  await page.getByRole("button", { name: "Renovar", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.equal(updated.length, 0, "Cancelled renewal cannot update the member");

  const renewal = page.waitForResponse(
    (response) =>
      response.url().startsWith(apiOrigin) &&
      response.url().endsWith("/rpc/confirm_membership_with_receipt"),
  );
  await page.getByRole("button", { name: "Renovar", exact: true }).click();
  await page.getByLabel("Dinero recibido (€)").fill("10");
  await page.getByRole("button", { name: "Confirmar aportación", exact: true }).click();
  await renewal;
  assert.equal(updated.length, 1);
  assert.ok(updated[0].expires_at > initialExpiry);
  assert.equal(updated[0].plan_id, planId);
  await page.evaluate(() =>
    sessionStorage.setItem(
      "snoop:member-draft",
      JSON.stringify({
        at: Date.now(),
        fields: {
          first_name: "Persona Draft",
          last_name: "Demo",
          birth_date: "2000-02-29",
          city: "Lugar Demo",
          plan_name: "Cuota Demo",
        },
      }),
    ),
  );
  await page.goto(new URL("/soci/nuovo", origin).href, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() =>
    [...document.querySelectorAll("input")].some((input) => input.value === "Persona Draft"),
  );
  assert.equal(created.length, 1, "Opening an AI draft must not register a member automatically");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("snoop:member-draft")), null);
  // Regression: iPhone/Safari canvas resizing must not erase a captured signature.
  // It must be impossible to continue without a signature when one is required.
  requireSignature = true;
  await page.goto(new URL("/soci/nuovo", origin).href, { waitUntil: "networkidle" });
  await page.getByText("Firma del socio", { exact: true }).waitFor();
  await page.getByLabel("Nombre *").fill("Firma");
  await page.getByLabel("Apellidos *").fill("Prueba");
  await page.getByLabel("Fecha de nacimiento *").fill("2000-02-29");
  await page.getByLabel("Ciudad *").fill("Lugar Demo");
  await page.getByLabel("Teléfono *").fill("000000000");
  await page.getByRole("button", { name: /Cuota Demo/ }).click();
  await page.getByRole("button", { name: "Crear socio", exact: true }).click();
  await page.locator('section[role="alert"]').getByText("Marca que has leído el contrato").waitFor();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Crear socio", exact: true }).click();
  await page.locator('section[role="alert"]').getByText("Falta la firma del socio").waitFor();
  const canvas = page.locator('canvas[aria-label="Firma del socio"]');
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width > 100 && bounds.height > 100);
  await page.mouse.move(bounds.x + 20, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 85, bounds.y + 100, { steps: 8 });
  await page.mouse.up();
  const ink = async () => canvas.evaluate((el) => {
    const c = el;
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
    return painted;
  });
  const beforeResize = await ink();
  assert.ok(beforeResize > 5, "A drawn signature must contain actual ink");
  await page.evaluate(() => window.dispatchEvent(new Event("resize")));
  assert.ok((await ink()) > 5, "Safari resize must preserve signature strokes");
  await page.setViewportSize({ width: 375, height: 700 });
  assert.ok((await ink()) > 5, "Real iPhone viewport resize must preserve signature");
  await page.getByRole("button", { name: "Borrar" }).click();
  assert.equal(await ink(), 0, "Borrar must erase all retina canvas pixels");
  await page.getByRole("button", { name: "Crear socio", exact: true }).click();
  await page.locator('section[role="alert"]').getByText("Falta la firma del socio").waitFor();
  assert.equal(created.length, 1, "Validation and signature interactions must not save a member");
  console.log(
    "PASS member administration: synthetic registration, duplicate guard, cancelled/confirmed renewal, QR view and AI draft without automatic writes (mock Supabase)",
  );
  await context.close();
} finally {
  await browser.close();
}
