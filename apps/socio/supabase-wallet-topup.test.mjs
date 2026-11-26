import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseWalletTopupRepository} from './supabase-wallet-topup.mjs';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const cash='f78e650f-66e1-40af-b1cd-4f8151cfda96';
const operation='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const staff={userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',clubId:club,accessToken:'synthetic-staff-jwt'};
const base={supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test',staff};
const op={kind:'topup',clubId:club,memberId:member,cashSessionId:cash,operationId:operation,actorId:staff.userId,amountCents:1200};
test('topup is delegated to a single atomic RPC using verified staff JWT',async()=>{
 const seen=[];
 const r=createSupabaseWalletTopupRepository({...base,fetcher:async(url,options)=>{
  seen.push({url,options});return Response.json({status:'applied',operationId:operation,balanceCents:1200});
 }});
 assert.equal(await r.memberWalletEnabled(club,member),true);
 assert.deepEqual(await r.commitWalletOperation(op),{status:'applied',operationId:operation,balanceCents:1200});
 assert.equal(seen.length,1);
 assert.match(seen[0].url,/\/rpc\/socio_wallet_topup$/);
 assert.equal(seen[0].options.headers.authorization,'Bearer synthetic-staff-jwt');
 assert.deepEqual(JSON.parse(seen[0].options.body),{
  p_club_id:club,p_member_id:member,p_cash_session_id:cash,
  p_operation_id:operation,p_amount_cents:1200
 });
});
test('fails closed for unsupported spend/refund, foreign club and invalid response',async()=>{
 let called=0;
 const r=createSupabaseWalletTopupRepository({...base,fetcher:async()=>{
  called++;return Response.json({status:'applied',balanceCents:1200,operationId:operation});
 }});
 await assert.rejects(r.commitWalletOperation({...op,kind:'spend'}),{code:'WALLET_TRANSACTION_NOT_IMPLEMENTED'});
 await assert.rejects(r.commitWalletOperation({...op,clubId:member}),{code:'WALLET_SCOPE_INVALID'});
 assert.equal(called,0);
 const wrong=createSupabaseWalletTopupRepository({...base,fetcher:async()=>
  Response.json({status:'applied',balanceCents:1200,operationId:cash})});
 await assert.rejects(wrong.commitWalletOperation(op),{code:'WALLET_RPC_OPERATION_MISMATCH'});
});
