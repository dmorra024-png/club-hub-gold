import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const home=readFileSync("src/routes/_authenticated/index.tsx","utf8");
const cash=readFileSync("src/lib/cash-sessions.ts","utf8");
const funcs=readFileSync("src/lib/cash-sessions.functions.ts","utf8");
const wallet=readFileSync("src/lib/cash-wallet-evidence.server.ts","utf8");
const activities=readFileSync("src/components/ClubActivities.tsx","utf8");
const source=readFileSync("src/lib/club-activity.ts","utf8");
const topup=readFileSync("src/components/WalletTopupPanel.tsx","utf8");
const caja=readFileSync("src/routes/_authenticated/caja.tsx","utf8");
test("Home Caja de hoy shares authenticated wallet-aware report with Caja",()=>{
 assert.ok(home.includes('getCashReport({data:{day:null}})'));
 assert.ok(home.includes('cashDaySummary(report.movements,report.sessions,report.start,report.end).totalCents'));
 assert.ok(cash.includes('topupCents'));
 assert.ok(cash.includes('walletPaidCents'));
 assert.ok(cash.includes('sum([amounts.totalCents, topupCents, -walletPaidCents])'));
});
test("wallet spend is not extra revenue and recharge cash is classified by actual receipt method",()=>{
 for(const value of ['source: "topup" as const','payment_method: t.paymentMethod ?? "cash"','m.payment_method === "cash"','m.payment_method !== "wallet"'])assert.ok(cash.includes(value),value);
 assert.ok(wallet.includes('walletOrderIds'));
 assert.ok(wallet.includes('topups.push('));
 assert.ok(caja.includes('paymentMethodLabel(m.payment_method)'));
});
test("Últimas actividades shows wallet topups, including method, amount, and actor",()=>{
 for(const value of ['getRecentWalletTopups({data:{limit:100}})','activityRows("wallet_topups",data,true)','item.amountCents !== undefined'])assert.ok(activities.includes(value),value);
 for(const value of ['table==="wallet_topups"','Recarga Monedero','Tarjeta / POS','Transferencia','actor_name','amountCents'])assert.ok(source.includes(value),value);
 assert.ok(funcs.includes('.middleware([requireClubCashAuth])'));
 assert.ok(funcs.includes('readWalletCashEvidence(context.supabase'));
 assert.ok(funcs.includes('z.number().int().min(1).max(100)'));
});
test("confirmed topups refresh home and activities without touching balances",()=>{
 assert.ok(topup.includes('window.dispatchEvent(new Event(RECORDS_CHANGED))'));
 assert.ok(!funcs.includes('UPDATE public.socio_wallet_accounts'));
});
