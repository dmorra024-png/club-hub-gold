import test from'node:test';
import assert from'node:assert/strict';
import{createStaffWalletHttp}from'./wallet-http.mjs';
const origin='https://manage.example.test';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const id='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const cash='f78e650f-66e1-40af-b1cd-4f8151cfda96';
const staff={accountType:'staff',verified:true,userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',clubId:club,permissions:['wallet_topup']};
const valid={clubId:club,memberId:member,operationId:id,amountCents:2500,cashSessionId:cash,confirmed:true};
function rig(){
 const calls=[];let authCalls=0;
 const repository={
  memberWalletEnabled:async()=>true,
  commitWalletOperation:async op=>{calls.push(op);return{status:'applied',balanceCents:2500,operationId:id}}
 };
 const handler=createStaffWalletHttp({origin,authenticateStaff:async()=>{authCalls++;return staff},repository});
 const request=(path='/api/snoop-wallet/topup',body=valid,headers={})=>
  new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 return{handler,request,calls,get authCalls(){return authCalls;}};
}
test('staff wallet route accepts only server-authenticated confirmed operation',async()=>{
 const r=rig(),response=await r.handler(r.request());
 assert.equal(response.status,200);
 assert.equal((await response.json()).status,'applied');
 assert.equal(r.calls.length,1);
 assert.equal(r.calls[0].actorId,staff.userId);
 assert.equal(r.calls[0].kind,'topup');
});
test('wallet route rejects cross-origin and unknown inputs before any write',async()=>{
 const r=rig();
 const cross=new Request(origin+'/api/snoop-wallet/topup',{method:'POST',headers:{Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify(valid)});
 assert.equal((await r.handler(cross)).status,403);
 assert.equal((await r.handler(r.request(undefined,{...valid,actorId:staff.userId}))).status,400);
 assert.equal((await r.handler(r.request(undefined,{...valid,confirmed:false}))).status,409);
 assert.equal(r.calls.length,0);
});
test('wallet route rejects unauthenticated identity and disabled wallet',async()=>{
 const x=createStaffWalletHttp({origin,authenticateStaff:async()=>null,repository:{
  memberWalletEnabled:async()=>true,commitWalletOperation:async()=>{throw Error('must not write')}
 }});
 const r=rig();
 assert.equal((await x(r.request())).status,401);
 const y=createStaffWalletHttp({origin,authenticateStaff:async()=>staff,repository:{
  memberWalletEnabled:async()=>false,commitWalletOperation:async()=>{throw Error('must not write')}
 }});
 assert.equal((await y(r.request())).status,403);
});

test('fresh authenticated staff is bound to a new repository per request',async()=>{
 const seen=[];
 const handler=createStaffWalletHttp({
  origin,authenticateStaff:async()=>({...staff,accessToken:'verified-JWT'}),
  repositoryFactory:async actor=>{
   seen.push(actor);
   return{
    memberWalletEnabled:async()=>true,
    commitWalletOperation:async op=>({status:'applied',balanceCents:op.amountCents,operationId:op.operationId})
   };
  }
 });
 const request=()=>new Request(origin+'/api/snoop-wallet/topup',{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify(valid)
 });
 assert.equal((await handler(request())).status,200);
 assert.equal((await handler(request())).status,200);
 assert.equal(seen.length,2);
 assert.equal(seen[0].accessToken,'verified-JWT');
});
