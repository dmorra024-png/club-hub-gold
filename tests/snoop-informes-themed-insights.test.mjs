import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync("src/routes/_authenticated/ajustes.informes.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const cash = readFileSync("src/routes/_authenticated/caja.tsx", "utf8");

test("insights belong to Informes not Caja", () => {
  for (const marker of ["Indicadores útiles", "Actividad por hora · pedidos", "Media por pedido", "Hora con más pedidos", "Lo importante, de un vistazo"])
    assert.ok(view.includes(marker), marker);
  assert.ok(!cash.includes("cashReportInsights"));
  assert.ok(!cash.includes("Resumen inteligente"));
});
test("analytics use club palette and do not hardcode old neon chart colors", () => {
  assert.ok(view.includes('const NEON = "var(--snoop-accent)"'));
  assert.ok(view.includes("var(--snoop-border)"));
  assert.ok(styles.includes(".snoop-informes-premium .snoop-informes-quick-grid"));
  assert.ok(!view.includes("#39FF14"));
  assert.ok(!view.includes("#ef4444"));
});
test("existing reports, stock and access features stay in place", () => {
  for (const marker of ["Control de acceso", "Entradas y salidas por día", "Ingresos por día", "Top productos por ingresos", "Movimientos de stock por día", "Histórico diario por producto", "Lista completa de movimientos", "Ingresos por categoría", "Stock bajo (menos de 10)", "can(\"view_reports\")"])
    assert.ok(view.includes(marker), marker);
});
test("completed orders are counted within authorized club and range, never written", () => {
  assert.ok(view.includes('.eq("club_id", clubId)'));
  assert.ok(view.includes('.eq("status", "completed")'));
  assert.ok(view.includes("completedIds.size"));
  assert.ok(!view.includes(".insert("));
  assert.ok(!view.includes(".update("));
  assert.ok(!view.includes(".delete("));
});
