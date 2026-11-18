import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseWalletOperationsRepository} from './supabase-wallet-operations.mjs';
import {createWalletCommands} from './wallet-operations.mjs';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const userId='9d5d3ca0-de23-467b-8ad4-211fce9003b9';
const operationId='11111111-2222-4333-8444-555555555555';
const cashSessionId='f78e650f-66e1-40af-b1cd-4f8151cfda96';
const orderId='56565656-1111-4222-8333-444444444444';
const reversalOf='22222222-9999-4333-8444-555555555555';
const auth={accountType:'staff',verified:true,clubId:club,userId,
 accessToken:'synthetic-jwt',permissions:['wallet_topup','wallet_spend','wallet_refund']};
const common={clubId:club,memberId:member,operationId,amountCents:1500,confirmed:true};
function rig(){
 const calls=[];
 const repository=createSupabaseWalletOperationsRepository({
  supabaseUrl:'https://synthetic.supabase.co',publishableKey:'sb_publishable_example',
  staff:auth,fetcher:async(url,opts)=>{
   calls.push({url,opts});return Response.json({status:'applied',balanceCents:2300,operationId});
  }
 });
 return {calls,commands:createWalletCommands({repository}),repository};
}
test('all 3 actions use independent atomic Postgres RPCs with verified JWT',async()=>{
 const {commands,calls}=rig();
 const variants=[
  {kind:'topup',cashSessionId},
  {kind:'spend',orderId},
  {kind:'refund',orderId,reversalOf}
 ];
 const names=['socio_wallet_topup','socio_wallet_order_spend','socio_wallet_order_refund'];
 for(let i=0;i<variants.length;i++){
  const result=await commands.commit(auth,{...common,...variants[i]});
  assert.equal(result.balanceCents,2300);
  assert.match(calls[i].url,new RegExp('/rpc/'+names[i]+'$'));
  assert.equal(calls[i].opts.headers.authorization,'Bearer synthetic-jwt');
  const sent=JSON.parse(calls[i].opts.body);
  assert.equal(sent.p_club_id,club);assert.equal(sent.p_member_id,member);
  assert.equal(sent.p_operation_id,operationId);
  assert.equal(sent.p_amount_cents,1500);
  if(i===1)assert.equal(sent.p_order_id,orderId);
  if(i===2)assert.equal(sent.p_reversal_operation_id,reversalOf);
 }
 assert.equal(calls.length,3);
});
test('denies unverified actor and malformed operation before DB request',async()=>{
 const {commands,calls}=rig();
 await assert.rejects(commands.commit({...auth,verified:false},
  {...common,kind:'topup',cashSessionId}),{code:'WALLET_STAFF_FORBIDDEN'});
 await assert.rejects(commands.commit(auth,
  {...common,kind:'refund',orderId,reversalOf:null}),{code:'WALLET_REFUND_REFERENCE_REQUIRED'});
 await assert.rejects(commands.commit(auth,
  {...common,kind:'spend',orderId:cashSessionId,cashSessionId}),{code:'WALLET_ORDER_REQUIRED'});
 assert.equal(calls.length,0);
});
test('rejects malformed, unavailable or contradictory RPC results',async()=>{
 const init=fetcher=>createWalletCommands({repository:createSupabaseWalletOperationsRepository({
  supabaseUrl:'https://synthetic.supabase.co',publishableKey:'public',
  staff:auth,fetcher
 })});
 const op={...common,kind:'spend',orderId};
 await assert.rejects(init(async()=>Response.json({status:'applied',balanceCents:1,operationId:orderId})).commit(auth,op),
 {code:'WALLET_RPC_BAD_RESPONSE'});
 await assert.rejects(init(async()=>Response.json({message:'RPC missing'},{status:404})).commit(auth,op),
 {code:'WALLET_RPC_UNAVAILABLE'});
});
