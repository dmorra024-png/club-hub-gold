import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3082";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const api = new URL(
  process.env.TEST_SUPABASE_URL ||
    (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  mid = "20000000-0000-4000-8000-000000000001",
  planId = "30000000-0000-4000-8000-000000000001",
  oid = "40000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "records@example.test",
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
    for (const mode of ["admin", "staff", "no-finance"]) {
      const context = await browser.newContext({ ...device, serviceWorkers: "block" });
      await context.addInitScript(
        ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
        { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
      );
      let historyReads = 0,
        annuls = 0,
        receipts = 0,
        orderWrites = 0,
        failPayment = true;
      const requestIds = [];
      const order = {
        id: oid,
        reference: "REG-000000000001",
        at: "2026-11-08T11:00:00Z",
        cents: 7500,
        status: "completed",
        operator: "Operador de prueba",
        cancelledAt: null,
        cancelledBy: null,
        reason: null,
        canCancel: mode === "admin",
      };
      const member = {
        id: mid,
        club_id: club,
        member_number: "TEST-01",
        first_name: "Persona",
        last_name: "Sintética",
        birth_date: "1990-01-01",
        dni_number: "SYNTHETIC",
        joined_at: "2026-01-01",
        expires_at: "2026-12-31",
        plan_id: planId,
        signature_path: "",
        dni_photo_path: "",
        contract_version: "",
        email: "",
        phone: "",
        city: "",
      };
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url()),
          isApi = u.origin === api.origin;
        if (u.origin !== new URL(base).origin && !isApi) return route.abort();
        if (u.pathname.includes("_serverFn")) {
          let result = { available: false, documents: false };
          const d = req.method() === "POST" ? fromJSON(JSON.parse(req.postData())).data : null;
          if (d?.memberId) {
            assert.equal(d.memberId, mid);
            historyReads++;
            if (d.reason) {
              assert.equal(mode, "admin");
              assert.deepEqual(Object.keys(d).sort(), ["memberId", "orderId", "reason"]);
              annuls++;
              assert.equal(d.orderId, oid);
              Object.assign(order, {
                status: "cancelled",
                canCancel: false,
                cancelledAt: "2026-11-08T12:00:00Z",
                cancelledBy: "Administrador de prueba",
                reason: d.reason,
              });
              result = oid;
            } else
              result = {
                orders: [{ ...order }],
                items: d.orderId
                  ? [
                      {
                        id: "line",
                        product_name: "Notebook",
                        quantity: 1,
                        unit_type: "unit",
                        line_total_cents: 7500,
                      },
                    ]
                  : [],
                hasMore: false,
                ownOnly: mode === "staff",
              };
          }
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ result, context: {} }),
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
            role: mode === "admin" ? "admin" : "collaborator",
            status: "active",
            clubId: club,
            clubName: "Club de prueba",
            permissions:
              mode === "no-finance" ? ["manage_members"] : ["manage_members", "use_cash"],
          };
        else if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
        else if (u.pathname.endsWith("/rpc/is_super_admin")) data = false;
        else if (u.pathname.endsWith("/members"))
          data = req.headers().accept?.includes("vnd.pgrst.object+json") ? member : [member];
        else if (u.pathname.endsWith("/membership_plans"))
          data = [
            {
              id: planId,
              club_id: club,
              name: "Aportación de prueba",
              duration_days: 30,
              price_cents: 7500,
              active: true,
              sort_order: 1,
            },
          ];
        else if (u.pathname.endsWith("/rpc/confirm_membership_with_receipt")) {
          const p = req.postDataJSON();
          assert.deepEqual(Object.keys(p).sort(), [
            "p_confirmed_cents",
            "p_expected",
            "p_member",
            "p_method",
            "p_plan_id",
            "p_renew",
            "p_request",
          ]);
          assert.equal(p.p_member.id, mid);
          assert.equal(p.p_confirmed_cents, 7500);
          assert.equal(p.p_method, "cash");
          assert.ok(!("receivedCents" in p) && !("changeCents" in p));
          requestIds.push(p.p_request);
          if (failPayment) {
            failPayment = false;
            status = 400;
            data = { code: "SYNTHETIC", message: "Error temporal de prueba" };
          } else {
            receipts++;
            data = mid;
            member.expires_at = "2027-01-30";
          }
        } else if (u.pathname.endsWith("/products") || u.pathname.endsWith("/product_categories"))
          data = [];
        else if (req.method() !== "GET" && !u.pathname.includes("/rpc/")) {
          orderWrites++;
          throw new Error("Unexpected write");
        }
        if (u.pathname.endsWith("/rpc/create_order_with_items")) {
          orderWrites++;
          throw new Error("Order creation is outside this test");
        }
        return route.fulfill({
          status,
          headers,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      async function keyboard(field) {
        await field.focus();
        await page.evaluate(() => {
          const v = window.visualViewport;
          Object.defineProperty(v, "height", { configurable: true, value: 300 });
          v.dispatchEvent(new Event("resize"));
        });
        try {
          await page.waitForFunction(() => {
            const r = document.activeElement?.getBoundingClientRect();
            return (
              document.body.dataset.snoopKeyboard === "true" && r && r.top >= 0 && r.bottom <= 300
            );
          });
        } catch (error) {
          console.error(
            "Keyboard geometry",
            await page.evaluate(() => ({
              active: document.activeElement?.tagName,
              rect: document.activeElement?.getBoundingClientRect().toJSON(),
              keyboard: document.body.dataset.snoopKeyboard,
              dialog: Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => ({
                rect: d.getBoundingClientRect().toJSON(),
                scroll: d.scrollTop,
                scrollHeight: d.scrollHeight,
                height: d.clientHeight,
                cssTop: getComputedStyle(d).top,
                maxHeight: getComputedStyle(d).maxHeight,
              })),
              height: visualViewport.height,
              offset: visualViewport.offsetTop,
            })),
          );
          await page.screenshot({ path: "/tmp/snoop-records-keyboard-failure.png" });
          throw error;
        }
        assert.equal(await page.locator(".premium-bottom-nav").isVisible(), false);
        await field.evaluate((el) => el.blur());
        await page.evaluate(() => {
          const v = window.visualViewport;
          delete v.height;
          v.dispatchEvent(new Event("resize"));
        });
        await page.waitForFunction(() => document.body.dataset.snoopKeyboard !== "true");
      }

      await page.goto(`${base}/soci/${mid}`, { waitUntil: "networkidle" });
      if (mode === "admin") {
        await page.getByRole("button", { name: "Renovar", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.equal(receipts, 0);
        await page.getByLabel("Dinero recibido (€)").fill("74,99");
        assert.equal(
          await dialog
            .getByRole("button", { name: "Confirmar aportación", exact: true })
            .isDisabled(),
          true,
        );
        await page.getByLabel("Dinero recibido (€)").fill("100");
        await keyboard(page.getByLabel("Dinero recibido (€)"));
        assert.equal(await page.getByLabel("Dinero recibido (€)").inputValue(), "100");
        await page.getByLabel("Cambio", { exact: true }).getByText(/25,00/).waitFor();
        await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
        assert.equal(receipts, 0);
        await page.getByRole("button", { name: "Renovar", exact: true }).click();
        await page.getByLabel("Dinero recibido (€)").fill("100");
        await dialog.getByRole("button", { name: "Confirmar aportación", exact: true }).click();
        await page.getByText("Error temporal de prueba", { exact: true }).waitFor();
        assert.equal(await page.getByLabel("Dinero recibido (€)").inputValue(), "100");
        await dialog.getByRole("button", { name: "Confirmar aportación", exact: true }).dblclick();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(receipts, 1);
        assert.equal(requestIds.length, 2);
        assert.equal(requestIds[0], requestIds[1]);
      }
      const summary = page.locator("summary").filter({ hasText: "Historial de pedidos" });
      if (mode === "no-finance") {
        assert.equal(await summary.count(), 0);
        assert.equal(historyReads, 0);
      } else {
        assert.equal(historyReads, 0, "history loads only on request");
        await summary.click();
        await page.getByText("COMPLETADO", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Ver detalle", exact: true }).click();
        const detail = page.getByRole("dialog");
        await detail.getByText(/Notebook/).waitFor();
        if (mode === "admin") {
          const cancel = detail.getByRole("button", {
            name: "Confirmar anulación contable",
            exact: true,
          });
          assert.equal(await cancel.isDisabled(), true);
          await page.getByLabel("Motivo de anulación").fill("Registro duplicado de prueba");
          await keyboard(page.getByLabel("Motivo de anulación"));
          assert.equal(
            await page.getByLabel("Motivo de anulación").inputValue(),
            "Registro duplicado de prueba",
          );
          await cancel.dblclick();
          await detail.getByText(/ANULADO/).waitFor();
          assert.equal(annuls, 1);
          assert.equal(order.cents, 7500);
          await detail.getByText(/Registro duplicado de prueba/).waitFor();
          await mkdir("docs/screenshots", { recursive: true });
          await page.evaluate(() => window.getSelection()?.removeAllRanges());
          await page.waitForFunction(() => !document.querySelector("[data-sonner-toast]"));
          await page.screenshot({
            path: `docs/screenshots/administrative-records-${label}.png`,
            scale: "css",
          });
          await detail.getByRole("button", { name: "Close", exact: true }).click();
          await page.getByRole("button", { name: "Hacer pedido", exact: true }).click();
          const draft = page.locator("textarea").first();
          await draft.fill("Borrador sin registrar");
          await page.evaluate(() =>
            window.dispatchEvent(
              new CustomEvent("snoop:member-action", { detail: { action: "renew" } }),
            ),
          );
          await page.getByRole("link", { name: "Cancelar borrador", exact: true }).click();
          await page.getByRole("button", { name: "Seguir editando", exact: true }).click();
          assert.equal(await draft.inputValue(), "Borrador sin registrar");
          await page.getByRole("link", { name: "Cancelar borrador", exact: true }).click();
          await page.getByRole("button", { name: "Descartar y volver", exact: true }).click();
          await page.waitForURL(`${base}/soci/${mid}`);
          assert.equal(
            await page.getByRole("dialog").count(),
            0,
            "member actions must not leak into the nested draft",
          );
          assert.equal(orderWrites, 0, "discarding a draft must not record an order");
        } else
          assert.equal(
            await detail
              .getByRole("button", { name: "Confirmar anulación contable", exact: true })
              .count(),
            0,
          );
      }
      assert.equal(orderWrites, 0);
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.waitForLoadState("networkidle");
      await context.close();
      results.push({
        device: label,
        mode,
        result: "PASS",
        physical: false,
        transport: "synthetic APIs; SQL separately tested",
        orderWrites,
      });
      console.log(`PASS administrative records ${label} ${mode}`);
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  "docs/ADMINISTRATIVE_RECORDS_BROWSER_RESULTS.json",
  JSON.stringify({ results }, null, 2),
);
