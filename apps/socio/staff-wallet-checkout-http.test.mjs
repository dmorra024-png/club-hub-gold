import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseAtomicWalletOrderRepository} from './supabase-wallet-checkout.mjs';
import {createStaffWalletCheckoutHttp} from './staff-wallet-checkout-http.mjs';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const user='7dbe4ead-c904-4c52-9fc1-51a9018aeb22';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const operation='12121212-1111-4222-8333-444444444444';
const order='56565656-1111-4222-8333-444444444444';
const item={product_id:'deafbeef-1111-4222-8333-444444444444',product_name:'Synthetic',
 unit_type:'gr',quantity:1,merma:0.1,unit_price_cents:800,line_total_cents:800};
const staff={accountType:'staff',verified:true,userId:user,clubId:club,
 accessToken:'synthetic-JWT',permissions:['use_cash','manage_members','wallet_spend','wallet_refund']};
const request={memberId:member,operationId:operation,notes:'',items:[item]};
const config=(fetcher,s=staff)=>({
 supabaseUrl:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic',staff:s,fetcher
});
const url='https://pilot.example';
const post=(path,body,extra={})=>new Request(url+path,{
 method:'POST',headers:{origin:url,'content-type':'application/json',...extra},
 body:JSON.stringify(body)
});
test('checkout sends only server verified JWT and one atomic order RPC, never separate spend',async()=>{
 const calls=[];
 const repo=createSupabaseAtomicWalletOrderRepository(config(async (path,init)=>{
  calls.push({path,init});
  return Response.json({status:'applied',orderId:order,operationId:operation,
   amountCents:800,balanceCents:2900});
 }));
 const result=await repo.execute('order',request);
 assert.equal(result.balanceCents,2900);
 assert.equal(calls.length,1);
 assert.match(calls[0].path,/\/rpc\/socio_create_wallet_order$/);
 assert.equal(calls[0].init.headers.authorization,'Bearer synthetic-JWT');
 assert.deepEqual(Object.keys(JSON.parse(calls[0].init.body)).sort(),
  ['p_items','p_member_id','p_notes','p_operation_id']);
 assert(!calls[0].init.body.includes('clubId'));
});
test('cancellation calls one atomic RPC and never separately refunds credits',async()=>{
 const calls=[];
 const repo=createSupabaseAtomicWalletOrderRepository(config(async(path,init)=>{
  calls.push(path);return Response.json({status:'applied',orderId:order,
   refundOperationId:operation,refundCents:800,balanceCents:3700});
 }));
 const result=await repo.execute('cancel',{memberId:member,orderId:order,
 reason:'Synthetic correction',operationId:operation});
 assert.equal(result.refundCents,800);
 assert.deepEqual(calls,['https://synthetic.supabase.co/rest/v1/rpc/socio_cancel_wallet_order']);
});
test('fail closed with no network call for spoofed scope, invalid price or denied permissions',async()=>{
 let count=0;
 const fetcher=async()=>{count++;return Response.json({});};
 const repo=createSupabaseAtomicWalletOrderRepository(config(fetcher));
 for(const bad of [
  {...request,clubId:club},
  {...request,items:[{...item,quantity:-1}]},
  {...request,items:[{...item,line_total_cents:'800'}]},
  {...request,operationId:'not-uuid'},
 ]) await assert.rejects(repo.execute('order',bad));
 const denied=createSupabaseAtomicWalletOrderRepository(config(fetcher,{
  ...staff,permissions:['use_cash']
 }));
 await assert.rejects(denied.execute('order',request),{code:'WALLET_ORDER_PERMISSION_DENIED'});
 assert.equal(count,0);
});
test('rejects forged success response / wrong operation id',async()=>{
 const repo=createSupabaseAtomicWalletOrderRepository(config(async()=>Response.json({
  status:'applied',orderId:order,operationId:member,amountCents:800,balanceCents:10
 })));
 await assert.rejects(repo.execute('order',request),{code:'WALLET_ORDER_RPC_INVALID_RESPONSE'});
});
test('staff router enforces explicit confirmation, same origin, server verified access',async()=>{
 let calls=0;
 const handler=createStaffWalletCheckoutHttp({
  origin:url,supabaseUrl:'https://synthetic.supabase.co',
  publishableKey:'sb_publishable_synthetic',
  authenticateStaff:async()=>staff,
  fetcher:async()=>{calls++;return Response.json({status:'applied',orderId:order,
   operationId:operation,amountCents:800,balanceCents:2900});}
 });
 const unconfirmed=await handler(post('/api/snoop-wallet/checkout',{...request}));
 assert.equal(unconfirmed.status,409);
 const forged=await handler(post('/api/snoop-wallet/checkout',
  {...request,confirmed:true,actorId:user}));
 assert.equal(forged.status,400);
 const success=await handler(post('/api/snoop-wallet/checkout',
  {...request,confirmed:true}));
 assert.equal(success.status,200);
 const cross=await handler(post('/api/snoop-wallet/checkout',
  {...request,confirmed:true},{origin:'https://attacker.example'}));
 assert.equal(cross.status,403);
 assert.equal(calls,1);
});
