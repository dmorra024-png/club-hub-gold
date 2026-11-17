import test from'node:test';
import assert from'node:assert/strict';
import{createWalletCommands}from'./wallet-operations.mjs';
const clubA='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',clubB='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const opA='437f044d-9c4d-4b95-8672-d2b8c9af3851',opB='9ab51fa6-dff9-4d15-a80a-a32295264c8d';
const order='d628e96e-368a-4d9a-bef8-d470181d0d01',session='f78e650f-66e1-40af-b1cd-4f8151cfda96';
const all=['wallet_topup','wallet_spend','wallet_refund'];
const staff={accountType:'staff',verified:true,userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',clubId:clubA,permissions:all};
const topup=(overrides={})=>({clubId:clubA,memberId:member,operationId:opA,kind:'topup',amountCents:5000,cashSessionId:session,confirmed:true,...overrides});
const spend=(overrides={})=>({clubId:clubA,memberId:member,operationId:opB,kind:'spend',amountCents:2100,orderId:order,confirmed:true,...overrides});
function rig(initial=0){
 const balances=new Map([[clubA+':'+member,initial],[clubB+':'+member,1000]]);
 const applied=new Map();const calls=[];
 const repository={
  async memberWalletEnabled(){return true;},
  async commitWalletOperation(op){
   calls.push(op);
   // Synthetic single-thread atomic transaction. Production MUST use row locks and
   // a unique operationId index and match order/cash state inside the DB transaction.
   const prior=applied.get(op.operationId);
   if(prior){if(JSON.stringify(prior.input)!==JSON.stringify(op))throw Error('IDEMPOTENCY_CONFLICT');
    return{status:'duplicate',balanceCents:prior.balance,operationId:op.operationId};}
   const key=op.clubId+':'+op.memberId;
   const prev=balances.get(key)||0;
   const delta=op.kind==='spend'?-op.amountCents:op.amountCents;
   if(prev+delta<0)throw Error('INSUFFICIENT_BALANCE');
   balances.set(key,prev+delta);
   applied.set(op.operationId,{input:op,balance:prev+delta});
   return{status:'applied',balanceCents:prev+delta,operationId:op.operationId};
  }
 };
 return{service:createWalletCommands({repository}),balances,calls};
}
test('topup and spend use integer cents and do not touch another club',async()=>{
 const r=rig();
 assert.equal((await r.service.commit(staff,topup())).balanceCents,5000);
 assert.deepEqual(await r.service.commit(staff,spend()),{balanceCents:2900,status:'applied',operationId:opB});
 assert.equal(r.balances.get(clubB+':'+member),1000);
 assert.equal((await r.service.commit(staff,topup())).status,'duplicate');
 assert.equal(r.balances.get(clubA+':'+member),2900);
});
test('different idempotency key cannot repeat order refund without independent SQL order invariant',async()=>{
 const r=rig(2100);
 const refund={clubId:clubA,memberId:member,operationId:opA,kind:'refund',amountCents:2100,orderId:order,reversalOf:opB,confirmed:true};
 assert.equal((await r.service.commit(staff,refund)).balanceCents,4200);
 await assert.rejects(r.service.commit(staff,{...refund,operationId:opB,amountCents:2000}),/IDEMPOTENCY_CONFLICT|./);
});
test('rejects unconfirmed action, wrong tenant, no permission and invalid amounts before repository write',async()=>{
 const r=rig(5000);
 for(const [who,op] of [
 [staff,topup({confirmed:false})],
 [{...staff,clubId:clubB},topup()],
 [{...staff,permissions:[]},topup()],
 [staff,topup({amountCents:1.15})],
 [staff,topup({amountCents:-5})],
 [staff,spend({orderId:undefined})],
 [staff,topup({cashSessionId:undefined})],
 ]){
  await assert.rejects(r.service.commit(who,op));
 }
 assert.equal(r.calls.length,0);
});
test('spend with insufficient balance fails in repository and does not mutate balance',async()=>{
 const r=rig(100);
 await assert.rejects(r.service.commit(staff,spend()),/INSUFFICIENT_BALANCE/);
 assert.equal(r.balances.get(clubA+':'+member),100);
});
test('wallet unavailable prevents any operation',async()=>{
 const r=createWalletCommands({repository:{memberWalletEnabled:async()=>false,commitWalletOperation:async()=>{throw Error('SHOULD_NOT_RUN')}}});
 await assert.rejects(r.commit(staff,topup()),{code:'WALLET_DISABLED'});
});
