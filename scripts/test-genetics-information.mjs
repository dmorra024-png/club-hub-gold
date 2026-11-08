import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3030";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
const reference = JSON.parse(
  await readFile("docs/GENETICS_LIVE_RESEARCH_RESULTS.json", "utf8"),
).rows.find((r) => r.name === "White Widow");
const photo = reference.images[0];
assert.ok(photo, "Live-verified image required; no invented fixture photo");
const bytes = await readFile("tests/fixtures/white-widow-public-domain.jpg");
const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "synthetic@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Persona Sintética" },
};
const club = "10000000-0000-4000-8000-000000000001",
  enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url"),
  exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: user.id, exp, role: "authenticated", aud: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_at: exp,
  expires_in: 3600,
  token_type: "bearer",
};
const results = [];
await mkdir("docs/screenshots", { recursive: true });
for (const [label, engine, device] of [
  ["samsung", chromium, { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } }],
  ["iphone-webkit", webkit, devices["iPhone 13"]],
]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] } : {}),
  });
  try {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    let role = "admin",
      lookup = 0,
      saves = 0,
      rows = [],
      unavailable = false;
    const errors = [];
    await context.addInitScript(
      ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.href === photo.url) return route.fulfill({ contentType: "image/jpeg", body: bytes });
      const isApi =
        u.origin === api.origin &&
        (!api.pathname.replace(/\/$/, "") ||
          u.pathname.startsWith(api.pathname.replace(/\/$/, "") + "/"));
      if (u.origin !== new URL(base).origin && !isApi) return route.abort();
      if (u.pathname.includes("_serverFn")) {
        let result = rows;
        if (req.method() === "POST") {
          const data = fromJSON(JSON.parse(req.postData())).data;
          if (data.confirmed) {
            assert.equal(data.name, "White Widow");
            assert.equal(data.confirmed, true);
            assert.equal(data.image.source, photo.source);
            assert.ok(!("price" in data));
            saves++;
            rows = [{ id: "synthetic-record", ...data, status: "reviewed" }];
            result = { saved: true };
          } else {
            assert.deepEqual(Object.keys(data), ["name"]);
            lookup++;
            result = {
              name: data.name,
              facts: unavailable ? [] : reference.verified_facts,
              images: unavailable ? [] : [photo],
              references: reference.references,
              warnings: unavailable
                ? ["Fuente no disponible. Puedes continuar manualmente."]
                : reference.warnings,
            };
          }
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      let data = [];
      if (u.pathname.endsWith("/auth/v1/user")) data = user;
      else if (u.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role,
          status: "active",
          clubId: club,
          clubName: "Club Sintético",
          permissions: [],
        };
      else if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
      else assert.equal(req.method(), "GET", "No economic/database mutation is permitted");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    await page.goto(base + "/geneticas", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Nueva ficha informativa", exact: true }).waitFor();
    await page.getByLabel("Nombre de la genética", { exact: true }).fill("White Widow");
    await page.getByRole("button", { name: "✨ Buscar foto y descripción", exact: true }).click();
    await page
      .getByRole("button", { name: "Seleccionar tras verificar correspondencia", exact: true })
      .waitFor();
    assert.equal(saves, 0);
    assert.equal(lookup, 1);
    await page
      .getByRole("button", { name: "Seleccionar tras verificar correspondencia", exact: true })
      .click();
    assert.match(await page.locator("textarea").inputValue(), /variedad de Cannabis/);
    assert.ok(
      await page.getByRole("button", { name: "Guardar ficha revisada", exact: true }).isDisabled(),
    );
    assert.equal(await page.locator("input[name*=price],input[name*=stock]").count(), 0);
    await page
      .getByRole("button", { name: "Guardar ficha revisada", exact: true })
      .scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/screenshots/genetics-${label}.png`,
      fullPage: true,
      scale: "css",
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Guardar ficha revisada", exact: true }).click();
    await page.getByRole("heading", { name: "White Widow", exact: true }).waitFor();
    assert.equal(saves, 1);
    await page
      .locator("input[type=file]")
      .setInputFiles({ name: "owned-photo.jpg", mimeType: "image/jpeg", buffer: bytes });
    await page.waitForFunction(() =>
      document.querySelector(".genetics-preview")?.src.startsWith("data:image/jpeg;base64,"),
    );
    assert.equal(saves, 1, "Own photo preview never saves automatically");
    unavailable = true;
    await page.getByLabel("Nombre de la genética", { exact: true }).fill("Amnesia Haze");
    await page.getByRole("button", { name: "✨ Buscar foto y descripción", exact: true }).click();
    await page
      .getByText("Fuente no disponible. Puedes continuar manualmente.", { exact: true })
      .waitFor();
    assert.ok(await page.locator("textarea").isEditable());
    assert.equal(saves, 1);
    await page.close();
    role = "collaborator";
    const staff = await context.newPage();
    await staff.goto(base + "/geneticas", { waitUntil: "networkidle" });
    await staff.getByRole("heading", { name: "White Widow", exact: true }).waitFor();
    assert.equal(
      await staff
        .getByRole("button", { name: "✨ Buscar foto y descripción", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    results.push({
      device: label,
      result: "PASS",
      physical: false,
      backend: "isolated intercepted APIs",
      image: "Live-verified Commons photograph; local captured bytes, not generated",
      checks: [
        "informational preview",
        "source attribution",
        "confirmation gate",
        "single explicit save",
        "unavailable source manual fallback",
        "collaborator read-only",
        "no economic writes",
      ],
    });
    console.log(
      "PASS",
      label,
      "informational archive, review, licensed photograph, source fallback and permissions",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile("docs/GENETICS_BROWSER_RESULTS.json", JSON.stringify({ results }, null, 2));
