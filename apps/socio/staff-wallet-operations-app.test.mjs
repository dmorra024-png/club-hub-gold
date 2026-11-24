import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffWalletOperationsApp} from './staff-wallet-operations-app.mjs';
const origin='https://staff.example.test';
const clubId='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const memberId='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const operationId='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const userId='9d5d3ca0-de23-467b-8ad4-211fce9003b9';
const orderId='56565656-1111-4222-8333-444444444444';
const cashSessionId='f78e650f-66e1-40af-b1cd-4f8151cfda96';
const reversalOf='11111111-2222-4333-8444-555555555555';
const staff={accountType:'staff',verified:true,userId,clubId,accessToken:'verified-staff-jwt',permissions:['wallet_topup','wallet_spend','wallet_refund']};
const common={clubId,memberId,operationId,amountCents:1500,confirmed:true};
const request=(action,payload)=>new Request(origin+'/api/snoop-wallet/'+action,{
 method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
 body:JSON.stringify(payload)
});
test('all staff operations bind to verified JWT and map to distinct atomic RPC',async()=>{
 const calls=[];
 const app=createStaffWalletOperationsApp({
  origin,supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test',
  authenticateStaff:async()=>staff,
  fetcher:async(url,opts)=>{calls.push({url,opts});return Response.json({status:'applied',operationId,balanceCents:3000})}
 });
 for(const [action,payload,expected] of [
  ['topup',{...common,cashSessionId},'socio_wallet_topup'],
  ['spend',{...common,orderId},'socio_wallet_order_spend'],
  ['refund',{...common,orderId,reversalOf},'socio_wallet_order_refund']
 ]){
  const r=await app(request(action,payload));
  assert.equal(r.status,200);
  assert.equal((await r.json()).balanceCents,3000);
  const entry=calls.at(-1);
  assert.match(entry.url,new RegExp('/rpc/'+expected+'$'));
  assert.equal(entry.opts.headers.authorization,'Bearer verified-staff-jwt');
 }
 assert.equal(calls.length,3);
});
test('wrong club, insufficient verified permissions, and unexpected fields never invoke SQL RPC',async()=>{
 let calls=0;
 const app=createStaffWalletOperationsApp({
  origin,supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test',
  authenticateStaff:async()=>({...staff,permissions:['wallet_topup']}),
  fetcher:async()=>{calls++;return Response.json({status:'applied',operationId,balanceCents:1500})}
 });
 assert.equal((await app(request('spend',{...common,orderId}))).status,403);
 assert.equal((await app(request('topup',{...common,cashSessionId,actorId:userId}))).status,400);
 assert.equal((await app(request('topup',{...common,clubId:memberId,cashSessionId}))).status,403);
 assert.equal(calls,0);
});
