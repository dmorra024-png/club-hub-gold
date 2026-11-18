import test from "node:test";
import assert from "node:assert/strict";
import {cashMovements,cashDaySummary,reconcileCash} from "../src/lib/cash-sessions.ts";
import {readWalletCashEvidence} from "../src/lib/cash-wallet-evidence.server.ts";
const start="2026-11-17T23:00:00.000Z",end="2026-11-18T23:00:00.000Z";
const club="4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc";
const user="7dbe4ead-c904-4c52-9fc1-51a9018aeb22";
const session="56565656-1111-4222-8333-444444444444";
const date="2026-11-18T11:00:00.000Z";
const shift={id:session,user_id:user,opened_at:"2026-11-18T08:00:00.000Z",
 closed_at:"2026-11-18T19:00:00.000Z",opening_cash_cents:10000,
 closing_cash_cents:15200,status:"closed"};
test("wallet-paid orders are turnover, not physical cash; wallet topups enter cash exactly once",()=>{
 const orders=[
  {id:"a",status:"completed",total_cents:1200,created_at:date,created_by:user,cash_session_id:session,payment_method:"cash"},
  {id:"b",status:"completed",total_cents:900,created_at:date,created_by:user,cash_session_id:session,payment_method:"wallet"}
 ];
 const fees=[{id:"f",amount_cents:500,recorded_at:date,recorded_by:user,payment_method:"cash"}];
 const topups=[{id:"topup",actorId:user,amountCents:3500,cashSessionId:session,at:date}];
 const movements=cashMovements(orders,fees,[shift],topups);
 const daily=cashDaySummary(movements,[shift],start,end);
 assert.equal(daily.orderCents,2100);
 assert.equal(daily.walletPaidCents,900);
 assert.equal(daily.topupCents,3500);
 assert.equal(daily.cashCents,5200);
 assert.equal(daily.totalCents,6100);
 assert.equal(daily.unidentifiedCents,0);
 assert.equal(reconcileCash(shift,movements).expected,15200);
 assert.equal(reconcileCash(shift,movements).difference,0);
});
test("historical orders with no payment method are never assumed cash",()=>{
 const movements=cashMovements([
  {id:"old",status:"completed",total_cents:1200,created_at:date,created_by:user,cash_session_id:session}
 ],[],[shift]);
 const daily=cashDaySummary(movements,[shift],start,end);
 assert.equal(daily.cashCents,0);
 assert.equal(daily.unidentifiedCents,1200);
 assert.equal(reconcileCash(shift,movements).expected,null);
});
test("wallet cash evidence requires verified RPC rows, not guessed method or arbitrary IDs",async()=>{
 const previous=process.env.SNOOP_WALLET_OPERATIONS_ENABLED;
 process.env.SNOOP_WALLET_OPERATIONS_ENABLED="true";
 try{
  let calls=0;
  const client={rpc:async(name:string,args:any)=>{
   calls++;
   assert.equal(name,"socio_wallet_cash_evidence");
   assert.equal(args.p_start,start);assert.equal(args.p_end,end);
   return {error:null,data:{
    walletOrders:[{orderId:club,amountCents:900,paymentMethod:"wallet"}],
    topups:[{id:user,amountCents:3500,cashSessionId:session,actorId:user,at:date}]
   }};
  }};
  const result=await readWalletCashEvidence(client,start,end);
  assert(result.walletOrderIds.has(club));
  assert.equal(result.topups[0].amountCents,3500);
  assert.equal(calls,1);
  await assert.rejects(readWalletCashEvidence({
    rpc:async()=>({error:null,data:{walletOrders:[
      {orderId:club,amountCents:900,paymentMethod:"cash"}],topups:[]}})
  },start,end),/inválido/);
 }finally{
  if(previous===undefined)delete process.env.SNOOP_WALLET_OPERATIONS_ENABLED;
  else process.env.SNOOP_WALLET_OPERATIONS_ENABLED=previous;
 }
});
