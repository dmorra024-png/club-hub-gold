import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=p=>readFileSync(p,"utf8");
const dialog=file("src/components/FinancialRecordDialog.tsx");
const wallet=file("src/lib/wallet-management.functions.ts");
const activities=file("src/components/ClubActivities.tsx");
const voidDialog=file("src/components/WalletTopupVoidDialog.tsx");
const source=file("src/lib/club-activity.ts");
const evidence=file("src/lib/cash-wallet-evidence.server.ts");
const cash=file("src/lib/cash-sessions.functions.ts");
const sql=file("docs/sql/SNOOP_WALLET_TOPUP_VOID_REVIEW.sql");
test("wallet orders always use verified settlement, never a build-time flag",()=>{
 assert.ok(!dialog.includes("VITE_SNOOP_WALLET_OPERATIONS_ENABLED"));
 assert.ok(dialog.includes("walletOrderPaymentState({data:{orderId}})"));
 assert.ok(dialog.includes("walletCancel({data:{memberId:memberId||data.memberId,orderId,"));
 assert.ok(dialog.includes("annulMemberFinancialRecord"));
});
test("topup void is atomically recorded as an audited reversal only once",()=>{
 for(const part of ["CREATE UNIQUE INDEX IF NOT EXISTS snoop_wallet_one_topup_reversal",
  "kind='topup_reversal'","v_account<v_original.delta_cents",
  "v_balance:=v_account-v_original.delta_cents",
  "p_refund_confirmed IS DISTINCT FROM true",
  "v_original.actor_id=v_actor","status='open'",
  "WALLET_CREDITS_ALREADY_USED","GRANT EXECUTE","TO authenticated"])assert.ok(sql.includes(part),part);
 assert.ok(sql.includes("UPDATE public.socio_wallet_accounts"));
 assert.ok(sql.includes("INSERT INTO public.socio_wallet_ledger"));
 assert.ok(!sql.includes("DELETE FROM public.socio_wallet_ledger"));
});
test("wallet activity and Caja show negative actual money reversal without double-counting",()=>{
 assert.ok(sql.includes("l.kind IN ('topup','topup_reversal')"));
 assert.ok(evidence.includes('row.kind==="topup_reversal"&&row.amountCents>=0'));
 assert.ok(cash.includes("kind:t.kind,voided:t.voided,member_id:t.memberId"));
 assert.ok(source.includes('title:r.kind==="topup_reversal"?"Anulación de recarga"'));
 assert.ok(source.includes("amountCents:Number.isSafeInteger(cents)&&cents!==0"));
});
test("void UI requires explicit actual refund and reason, never initiates a POS transfer",()=>{
 assert.ok(activities.includes("Anular recarga"));
 assert.ok(activities.includes("<WalletTopupVoidDialog"));
 assert.ok(voidDialog.includes("Confirmo que ya he devuelto"));
 assert.ok(voidDialog.includes("reason.trim().length<5"));
 assert.ok(voidDialog.includes("setUncertain(true)"));
 assert.ok(wallet.includes('walletVoidTopup=createServerFn'));
 assert.ok(wallet.includes('requireOperationalClub(context,"manage_members")'));
 assert.ok(wallet.includes('current_open_cash_session'));
 assert.ok(wallet.includes('p_refund_confirmed:true'));
 assert.ok(!wallet.includes("service_role"));
});
