import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui=readFileSync("src/components/FinancialRecordDialog.tsx","utf8");
const fn=readFileSync("src/lib/member-order-history.functions.ts","utf8");
const server=readFileSync("src/lib/member-order-history.server.ts","utf8");
test("refund button is not mysteriously disabled by a four-character reason",()=>{
 assert.ok(ui.includes("disabled={busy || !refundConfirmed || !refundMethod}"));
 assert.ok(ui.includes("Escribe al menos 5 caracteres en el motivo del reembolso."));
 assert.ok(ui.includes("El motivo necesita al menos 5 caracteres"));
});
test("refund is still refused until all original safeguards are satisfied",()=>{
 for(const marker of ["sending.current","refundRecorded","!order?.canRefund","walletPayment !== false","!refundConfirmed || !refundMethod","refundReason.trim().length < 5","confirmed: true"])assert.ok(ui.includes(marker),marker);
 assert.ok(fn.includes("z.string().trim().min(5).max(2000)"));
 assert.ok(server.includes("reason.trim().length < 5"));
});
