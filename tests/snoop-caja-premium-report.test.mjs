import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const caja = readFileSync("src/routes/_authenticated/caja.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const sessions = readFileSync("src/lib/cash-sessions.ts", "utf8");
const server = readFileSync("src/lib/cash-sessions.server.ts", "utf8");

test("premium report displays real shift operators, dates and lifecycle", () => {
  for (const marker of ["name(s.user_id)", "name(s.closed_by ?? s.user_id)", "hour(s.opened_at)", "hour(s.closed_at)", "Activa", "Cerrada", "sessionRevenue(s, data.movements)", "reconcileCash(s, data.movements)"]) {
    assert.ok(caja.includes(marker), marker);
  }
  assert.ok(styles.includes(".snoop-caja-overview"));
  assert.ok(styles.includes(".snoop-caja-shift"));
});

test("existing payment operations, views, and server calls remain", () => {
  for (const marker of ["getCashReport({ data: { day } })", "openCash({ data: { openingCash: cents } })", "closeCash({ data: { sessionId: session.id, closingCash: cents, notes } })", 'value="mia"', 'value="informe"', "paymentMethodLabel(r.method)", "cashDaySummary(result.movements, result.sessions, result.start, result.end)"]) assert.ok(caja.includes(marker), marker);
  assert.ok(sessions.includes('m.payment_method === "cash"'));
  assert.ok(sessions.includes('m.payment_method === "wallet"'));
  assert.ok(server.includes('payment_method:walletEvidence.walletOrderIds.has(order.id)?"wallet":(order.payment_method??null)'));
});

test("unverified payment methods are not silently presented as cash", () => {
  assert.ok(caja.includes("daily!.unidentifiedCents > 0"));
  assert.ok(caja.includes("sin método de pago identificado"));
  assert.ok(caja.includes("No se clasifica automáticamente como efectivo"));
});
