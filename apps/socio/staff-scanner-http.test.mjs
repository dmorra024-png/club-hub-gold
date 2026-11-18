import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createStaffScannerHttp} from './staff-scanner-http.mjs';
import {issueCardQr,verifyCardQr} from './domain.mjs';
globalThis.crypto??=webcrypto;
const origin='https://manage.example.test';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',other='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const actor='9d5d3ca0-de23-467b-8ad4-211fce9003b9';
const staff={accountType:'staff',verified:true,userId:actor,clubId:club,canScan:true};
const now=1800000000000,secret=new Uint8Array(32).fill(91);
const request=(token,headers={})=>new Request(origin+'/api/snoop-scan/verify',{
 method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify({token})
});
test('verified staff can scan member QR once, replay fails, cross-club denied',async()=>{
 const used=new Set();
 const scanner={
  async scan(who,token){
   const check=await verifyCardQr(token,{clubId:who.clubId,secret,now,memberActive:true});
   if(!check.ok)throw Object.assign(Error('QR_REJECTED'),{code:'QR_REJECTED',status:403});
   if(used.has(check.nonce))throw Object.assign(Error('QR_ALREADY_SCANNED'),{code:'QR_ALREADY_SCANNED',status:409});
   used.add(check.nonce);
   return {valid:true,memberId:check.memberId,clubId:check.clubId};
  }
 };
 const http=createStaffScannerHttp({origin,authenticateStaff:async()=>staff,scanner});
 const token=await issueCardQr({clubId:club,memberId:member,secret,now,ttl:40});
 const result=await http(request(token));
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{valid:true,clubId:club,memberId:member});
 assert.equal((await http(request(token))).status,409);
 const foreign=createStaffScannerHttp({origin,authenticateStaff:async()=>({...staff,clubId:other}),scanner});
 assert.equal((await foreign(request(await issueCardQr({clubId:club,memberId:member,secret,now,ttl:40})))).status,403);
});
test('scanner denies unauthenticated and missing staff identity before invoking scanner',async()=>{
 let calls=0;
 const scanner={scan:async()=>{calls++;return{valid:true,clubId:club,memberId:member}}};
 for(const who of [null,{...staff,verified:false},{...staff,canScan:false},{...staff,userId:undefined}]){
  const http=createStaffScannerHttp({origin,authenticateStaff:async()=>who,scanner});
  assert.equal((await http(request('ssc2.x.y'))).status,403);
 }
 assert.equal(calls,0);
});
test('scanner enforces same-origin JSON, strict input and rejects fake result scope',async()=>{
 let calls=0;
 const scanner={scan:async()=>{calls++;return{valid:true,clubId:other,memberId:member}}};
 const http=createStaffScannerHttp({origin,authenticateStaff:async()=>staff,scanner});
 const token=await issueCardQr({clubId:club,memberId:member,secret,now,ttl:40});
 assert.equal((await http(request(token,{Origin:'https://evil.test'}))).status,403);
 assert.equal((await http(request('malformed'))).status,400);
 assert.equal(calls,0);
 assert.equal((await http(request(token))).status,503);
});
