import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3095";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
);
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  mid = "20000000-0000-4000-8000-000000000001",
  oid = "30000000-0000-4000-8000-000000000001",
  second = "30000000-0000-4000-8000-000000000002";
const user = {
  id: uid,
  email: "annulment@example.test",
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
    for (const mode of ["admin", "staff", "restricted", "foreign", "missing-migration"]) {
      const context = await browser.newContext({ ...device, serviceWorkers: "block" });
      await context.addInitScript(
        ({ auth, key }) => localStorage.setItem(key, JSON.stringify(auth)),
        { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
      );
      const errors = [],
        records = [oid, second].map((id, n) => ({
          id,
          reference: `REG-00000000000${n + 1}`,
          at: "2026-11-09T11:00:00Z",
          cents: n ? 500 : 1500,
          status: "completed",
          operator: "Operador sintético",
          cancelledAt: null,
          cancelledBy: null,
          reason: null,
          reversal: null,
          canCancel: mode === "admin" || (mode === "staff" && n === 0),
          canRefund: false,
          annulmentAvailable: mode !== "missing-migration",
        }));
      let writes = 0,
        attempts = 0,
        failOnce = mode === "admin" || mode === "staff",
        refundWrites = 0;
      const requests = [];
      const effectiveClub = mode === "foreign" ? "10000000-0000-4000-8000-000000000002" : club;
      const member = {
        id: mid,
        club_id: club,
        member_number: "TEST-AUDIT",
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
      await context.route("**/*", async (route) => {
        const req = route.request(),
          u = new URL(req.url());
        if (u.origin !== api.origin) {
          if (u.origin !== new URL(base).origin) return route.abort();
          if (!u.pathname.includes("_serverFn")) return route.continue();
          const d = req.method() === "POST" ? fromJSON(JSON.parse(req.postData())).data : null;
          let result = { available: false, documents: false };
          if (d?.confirmed) {
            assert.ok(["admin", "staff"].includes(mode));
            assert.deepEqual(Object.keys(d).sort(), [
              "confirmed",
              "memberId",
              "method",
              "orderId",
              "reason",
            ]);
            assert.equal(d.method, "cash");
            assert.equal(d.memberId, mid);
            assert.equal(d.orderId, oid);
            const r = records.find((r) => r.id === d.orderId);
            assert.equal(r.status, "cancelled");
            assert.ok(!r.reversal.refund);
            refundWrites++;
            r.reversal.refund = {
              reference: "DEV-1",
              cents: r.cents,
              method: d.method,
              by: mode === "staff" ? "Operador sintético" : "Administrador sintético",
              at: "2026-11-09T12:30:00Z",
              reason: d.reason,
            };
            r.canRefund = false;
            result = oid;
          } else if (d?.reason) {
            assert.ok(["admin", "staff"].includes(mode));
            if (mode === "staff") assert.equal(d.orderId, oid);
            assert.deepEqual(Object.keys(d).sort(), ["memberId", "orderId", "reason"]);
            assert.equal(d.memberId, mid);
            assert.ok(d.reason.length >= 5);
            attempts++;
            requests.push(d);
            if (failOnce) {
              failOnce = false;
              return route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({ error: { message: "Fallo sintético antes de registrar" } }),
              });
            }
            const r = records.find((r) => r.id === d.orderId);
            assert.equal(r.status, "completed", "no second cancellation request");
            writes++;
            Object.assign(r, {
              status: "cancelled",
              canCancel: false,
              canRefund: true,
              reason: d.reason,
              cancelledAt: "2026-11-09T12:00:00Z",
              cancelledBy: mode === "staff" ? "Operador sintético" : "Administrador sintético",
              reversal: {
                reference: `REC-${writes}`,
                cents: -r.cents,
                at: "2026-11-09T12:00:00Z",
                by: "Administrador sintético",
                reason: d.reason,
              },
            });
            result = r.id;
          } else if (d?.memberId || d?.orderId) {
            assert.ok(["admin", "staff", "missing-migration"].includes(mode));
            if (d.memberId) assert.equal(d.memberId, mid);
            result = {
              memberId: mid,
              orders: d.orderId
                ? records.filter((r) => r.id === d.orderId)
                : records.map((r) => ({ ...r })),
              items: d.orderId
                ? [
                    {
                      id: "line",
                      product_name: "Cuaderno de prueba",
                      quantity: 1,
                      unit_type: "unit",
                      line_total_cents: records.find((r) => r.id === d.orderId).cents,
                    },
                  ]
                : [],
              hasMore: false,
              ownOnly: false,
            };
          } else if (d && Object.hasOwn(d, "day")) {
            const original = records.filter((r) => r.status === "cancelled");
            result = {
              day: "2026-11-09",
              start: "2026-11-08T23:00:00Z",
              end: "2026-11-09T23:00:00Z",
              sessions: [],
              movements: records
                .filter((r) => r.status === "completed")
                .map((r) => ({
                  id: r.id,
                  source: "order",
                  at: r.at,
                  by: uid,
                  cents: r.cents,
                  session_id: null,
                  payment_method: null,
                })),
              auditRecords: original.map((r) => ({ ...r, by: uid })),
              refunds: records
                .filter((r) => r.reversal?.refund)
                .map((r) => ({
                  id: r.id,
                  at: r.reversal.refund.at,
                  by: uid,
                  cents: r.cents,
                  method: r.reversal.refund.method,
                  reason: r.reversal.refund.reason,
                  session_id: null,
                })),
              profiles: [{ id: uid, full_name: "Operador sintético" }],
              admin: true,
              userId: uid,
            };
          }
          return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ result, context: {} }),
          });
        }
        const headers = {
          "access-control-allow-origin": new URL(base).origin,
          "access-control-allow-credentials": "true",
          "access-control-allow-headers":
            req.headers()["access-control-request-headers"] ||
            "authorization,apikey,content-type,x-client-info,x-supabase-api-version",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        };
        if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
        let data = [];
        if (u.pathname.endsWith("/auth/v1/user")) data = user;
        else if (u.pathname.endsWith("/rpc/snoop_access_context"))
          data = {
            role: ["admin", "missing-migration", "foreign"].includes(mode)
              ? "admin"
              : "collaborator",
            status: "active",
            clubId: effectiveClub,
            clubName: "Club sintético",
            permissions:
              mode === "restricted" ? ["use_cash"] : ["manage_members", "use_cash", "view_reports"],
          };
        else if (u.pathname.endsWith("/rpc/current_club_id")) data = effectiveClub;
        else if (u.pathname.endsWith("/rpc/is_super_admin")) data = false;
        else if (u.pathname.endsWith("/members")) data = u.searchParams.has("id") ? member : [];
        else if (u.pathname.endsWith("/orders")) {
          assert.equal(u.searchParams.get("club_id"), `eq.${effectiveClub}`);
          data =
            mode === "foreign"
              ? []
              : records.map((r) => ({
                  id: r.id,
                  club_id: club,
                  created_at: r.at,
                  total_cents: r.cents,
                  status: r.status,
                  created_by: r.id === oid ? uid : "00000000-0000-4000-8000-000000000002",
                }));
          if (u.searchParams.has("created_by")) {
            assert.equal(u.searchParams.get("created_by"), `eq.${uid}`);
            data = data.filter((r) => r.created_by === uid);
          }
        } else if (u.pathname.endsWith("/order_items")) {
          assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
          data = records.map((r) => ({
            id: r.id,
            order_id: r.id,
            club_id: club,
            product_id: "fixture",
            product_name: "Cuaderno de prueba",
            line_total_cents: r.cents,
            quantity: 1,
            created_at: r.at,
          }));
        } else if (req.method() !== "GET" && !u.pathname.includes("/rpc/"))
          throw new Error("Unexpected direct write");
        return route.fulfill({
          headers,
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => errors.push(e.message));
      if (["admin", "staff"].includes(mode)) {
        await page.goto(base + `/soci/${mid}`);
        await page.getByText("Historial de pedidos", { exact: true }).click();
        await page.getByRole("button", { name: "Anular operación", exact: true }).first().click();
        let dialog = page.getByRole("dialog");
        await dialog.getByText("Cuaderno de prueba", { exact: false }).waitFor();
        const confirm = dialog.getByRole("button", {
          name: "Confirmar anulación contable",
          exact: true,
        });
        assert.ok(await confirm.isDisabled());
        await dialog.getByLabel("Motivo de anulación").fill("Registro duplicado comprobado");
        await confirm.click();
        await dialog.getByRole("alert").waitFor();
        assert.equal(writes, 0);
        assert.equal(
          await dialog.getByLabel("Motivo de anulación").inputValue(),
          "Registro duplicado comprobado",
        );
        await confirm.dblclick();
        await dialog.getByText("ANULADO", { exact: true }).waitFor();
        assert.equal(writes, 1);
        assert.equal(attempts, 2);
        assert.equal(records[0].cents, 1500);
        await dialog.getByText("Registrar reembolso ya realizado", { exact: true }).click();
        const refundButton = dialog.getByRole("button", {
          name: "Confirmar registro de reembolso",
          exact: true,
        });
        assert.ok(await refundButton.isDisabled());
        await dialog.getByLabel("Método real del reembolso").selectOption("cash");
        await dialog.getByLabel("Motivo del reembolso").fill("Dinero ya devuelto y verificado");
        await dialog.getByRole("checkbox").check();
        await refundButton.dblclick();
        await dialog.getByText("Reembolso registrado", { exact: true }).waitFor();
        assert.equal(refundWrites, 1);
        assert.equal(records[0].reversal.refund.cents, 1500);
        assert.equal(records[0].reversal.cents, -1500);

        await dialog.getByText(/Rectificación REC-1/).waitFor();
        await dialog.getByText(/Neto contable:.*0,00/).waitFor();
        await dialog.screenshot({
          path: `docs/annulment-${label}${mode === "admin" ? "" : "-owner"}-detail.png`,
          scale: "css",
        });
        assert.equal(
          await dialog
            .getByRole("button", { name: "Confirmar anulación contable", exact: true })
            .count(),
          0,
        );
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await page.getByText("ANULADO", { exact: true }).waitFor();
        const color = await page.getByText("ANULADO", { exact: true }).evaluate((el) => {
          const canvas = document.createElement("canvas"),
            ctx = canvas.getContext("2d");
          ctx.fillStyle = getComputedStyle(el).color;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        });
        assert.ok(
          color[0] > color[1] * 1.5 && color[0] > color[2] * 1.1,
          "Cancelled badge renders red",
        );
        await page.screenshot({
          path: `docs/annulment-${label}${mode === "admin" ? "" : "-owner"}-member.png`,
          fullPage: true,
          scale: "css",
        });
        await page.waitForLoadState("networkidle");
      }
      await page.goto(base + "/actividades");
      await page.getByRole("heading", { name: "Historial", exact: true }).waitFor();
      if (mode === "admin") {
        await page.getByText("ANULADO", { exact: true }).waitFor();
        assert.equal(
          await page.getByRole("button", { name: "Anular operación", exact: true }).count(),
          1,
        );
        await page.getByRole("button", { name: "Ver detalle", exact: true }).first().click();
        let dialog = page.getByRole("dialog");
        await dialog.getByText(/Rectificación REC-1/).waitFor();
        await dialog.getByText("Administrador sintético", { exact: false }).first().waitFor();
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await page.getByRole("button", { name: "Anular operación", exact: true }).click();
        dialog = page.getByRole("dialog");
        await dialog.getByLabel("Motivo de anulación").fill("Segunda operación comprobada");
        await dialog
          .getByRole("button", { name: "Confirmar anulación contable", exact: true })
          .dblclick();
        await dialog.getByText("ANULADO", { exact: true }).waitFor();
        assert.equal(writes, 2);
        await dialog.getByRole("button", { name: "Close", exact: true }).click();
        await page.waitForFunction(
          () => document.querySelectorAll(".premium-activity-copy strong").length === 2,
        );
        assert.equal(
          await page.getByRole("button", { name: "Anular operación", exact: true }).count(),
          0,
        );
        await page.screenshot({
          path: `docs/annulment-${label}-activity.png`,
          fullPage: true,
          scale: "css",
        });
        await page.waitForLoadState("networkidle");
        await page.goto(base + `/soci/${mid}`);
        await page.getByText("Historial de pedidos", { exact: true }).click();
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("strong")].filter((el) => el.textContent === "ANULADO")
              .length === 2,
        );
        assert.equal(
          await page.getByRole("button", { name: "Anular operación", exact: true }).count(),
          0,
        );
        await page.goto(base + "/caja");
        await page.getByRole("tab", { name: "Informe de caja", exact: true }).click();
        await page.getByLabel("Total del día").getByText(/0,00/).waitFor();
        await page.getByText(/Rectificación REC-1/).waitFor();
        await page.getByText(/Rectificación REC-2/).waitFor();
        await page.getByText(/Reembolso registrado:.*15,00/).waitFor();
        assert.equal(refundWrites, 1);
        assert.equal(writes, 2);
        await page.goto(base + "/ajustes/informes");
        await page.getByText("Ingresos", { exact: true }).waitFor();
        await page.waitForLoadState("networkidle");
        await page
          .getByText("Ingresos", { exact: true })
          .locator("..")
          .getByText("€0.00", { exact: true })
          .waitFor();
      } else if (mode === "staff") {
        await page.getByText("ANULADO", { exact: true }).waitFor();
        assert.equal(
          await page.getByRole("button", { name: "Anular operación", exact: true }).count(),
          0,
        );
        await page.getByRole("button", { name: "Ver detalle", exact: true }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.getByText("Reembolso registrado", { exact: true }).waitFor();
        await dialog.getByText("Anulado por: Operador sintético", { exact: true }).waitFor();
        assert.equal(
          await dialog
            .getByRole("button", { name: "Confirmar anulación contable", exact: true })
            .count(),
          0,
        );
        assert.equal(writes, 1);
        assert.equal(refundWrites, 1);
      } else {
        assert.equal(
          await page.getByRole("button", { name: "Anular operación", exact: true }).count(),
          mode === "missing-migration" ? 2 : 0,
        );
        if (["staff", "missing-migration"].includes(mode)) {
          await page.getByRole("button", { name: "Ver detalle", exact: true }).first().click();
          const dialog = page.getByRole("dialog");
          await dialog.getByText("Cuaderno de prueba", { exact: false }).waitFor();
          assert.equal(
            await dialog
              .getByRole("button", { name: "Confirmar anulación contable", exact: true })
              .count(),
            0,
          );
          assert.equal(writes, 0);
        }
        if (mode === "foreign")
          assert.equal(
            await page.getByRole("button", { name: "Ver detalle", exact: true }).count(),
            0,
          );
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      results.push({ browser: label, mode, status: "PASS", writes, attempts, refundWrites });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
await writeFile(
  "docs/FINANCIAL_ANNULMENT_BROWSER_RESULTS.json",
  JSON.stringify({ synthetic: true, physicalDevice: false, results }, null, 2) + "\n",
);
console.log(JSON.stringify(results));
