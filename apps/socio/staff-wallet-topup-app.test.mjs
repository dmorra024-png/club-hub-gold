import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffWalletTopupApp} from './staff-wallet-topup-app.mjs';
const origin='https://staff.example.test';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const cash='f78e650f-66e1-40af-b1cd-4f8151cfda96';
const operationId='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const staff={accountType:'staff',verified:true,userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',
 clubId:club,accessToken:'synthetic-jwt',permissions:['wallet_topup']};
const body={clubId:club,memberId:member,cashSessionId:cash,operationId,amountCents:2000,confirmed:true};
const req=(route='topup')=>new Request(origin+'/api/snoop-wallet/'+route,{
 method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)
});
test('topup staff gateway calls one verified Postgres transaction and returns committed balance',async()=>{
 const seen=[];
 const handler=createStaffWalletTopupApp({origin,
  supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_synthetic',
  authenticateStaff:async()=>staff,
  fetcher:async(url,options)=>{seen.push({url,options});return Response.json({
   status:'applied',balanceCents:2000,operationId
  });}
 });
 const r=await handler(req());
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{balanceCents:2000,status:'applied',operationId});
 assert.equal(seen.length,1);
 assert.match(seen[0].url,/\/rpc\/socio_wallet_topup$/);
 assert.equal(seen[0].options.headers.authorization,'Bearer synthetic-jwt');
 assert.equal((await handler(req('spend'))).status,503);
 assert.equal((await handler(req('refund'))).status,503);
 assert.equal(seen.length,1,'unsupported financial action must never call RPC');
});
test('untrusted operator or unconfirmed recharge cannot write to server',async()=>{
 let called=0;
 const handler=createStaffWalletTopupApp({origin,supabaseUrl:'https://example.supabase.co',
 publishableKey:'sb_publishable_synthetic',authenticateStaff:async()=>({...staff,permissions:[]}),
 fetcher:async()=>{called++;return Response.json({})}});
 assert.equal((await handler(req())).status,403);
 assert.equal(called,0);
});
