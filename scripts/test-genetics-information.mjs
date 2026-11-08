import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3030";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);

const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
};
const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
  exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, role: "authenticated", aud: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_at: exp,
  expires_in: 3600,
  token_type: "bearer",
};
const results = [];
for (const [label, engine, device] of [
  ["samsung", chromium, devices["Galaxy S9+"]],
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
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    let archiveCalls = 0,
      lookupCalls = 0,
      writes = 0;
    await context.addInitScript(
      ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        isApi = u.origin === api.origin;
      if (u.origin !== new URL(base).origin && !isApi) return route.abort();
      if (u.pathname.includes("_serverFn") && req.method() === "POST") {
        const data = fromJSON(JSON.parse(req.postData())).data;
        assert.equal(data.name, "Genética sintética");
        assert.equal(data.strain, "");
        lookupCalls++;
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            result: {
              description: "Descripción informativa sintética",
              images: [],
              descriptions: [],
              image_url: "",
              warning: "",
            },
            context: {},
          }),
        });
      }
      if (u.pathname.includes("_serverFn")) {
        archiveCalls++;
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result: { available: false }, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      let data = [];
      if (req.method() !== "GET" && !u.pathname.includes("/rpc/")) writes++;
      if (u.pathname.endsWith("/auth/v1/user")) data = user;
      else if (u.pathname.endsWith("/product_categories"))
        data = [
          { id: club, club_id: club, name: "Botánica", unit_type: "unit", is_smokeable: false },
        ];
      else if (u.pathname.endsWith("/products"))
        data = [
          {
            id: club,
            club_id: club,
            category_id: club,
            name: "Genética sintética",
            strain: "sativa",
            stock: 0,
            buy_price: 0,
            sell_price: 0,
            active: true,
          },
        ];
      else if (u.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role: "admin",
          status: "active",
          clubId: club,
          clubName: "Club sintético",
          permissions: ["manage_products"],
        };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    await page.goto(base + "/geneticas", { waitUntil: "networkidle" });
    await page.waitForURL(base + "/productos");
    await page.getByRole("heading", { name: "Productos", exact: true }).waitFor();
    await page.getByTitle("Proponer descripción e imágenes con licencia").click();
    await page.getByLabel("Descripción propuesta").fill("Descripción corregida sin guardar");
    assert.equal(lookupCalls, 1);
    assert.equal(writes, 0);
    await page.getByRole("button", { name: "Cancelar propuesta", exact: true }).click();
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    assert.doesNotMatch(
      await page.getByRole("dialog", { name: "Menú principal" }).innerText(),
      /Archivo informativo|Genéticas/,
    );
    assert.equal(writes, 0);
    assert.equal(archiveCalls, 0);
    results.push({
      device: label,
      result: "PASS",
      checks: [
        "old archive link redirects to existing Products",
        "no archive menu or API calls",
        "zero database writes",
        "same-product AI uses product name, not classification; editable/cancellable preview",
      ],
      physical: false,
    });
    console.log("PASS archive removed " + label);
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile("docs/GENETICS_BROWSER_RESULTS.json", JSON.stringify({ results }, null, 2));
