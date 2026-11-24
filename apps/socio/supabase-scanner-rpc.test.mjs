import test from'node:test';
import assert from'node:assert/strict';
import{createStaffScannerRepository}from'./supabase-scanner-rpc.mjs';
const a='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const b='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const m='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const u='9d5d3ca0-de23-467b-8ad4-211fce9003b9';
const staff={userId:u,clubId:a,accessToken:'synthetic-user-jwt'};
const nonce='abcDef0123456789_-AbCdEf';
test('verified staff RPC consumes one nonce using only bound JWT and club ID',async()=>{
 const calls=[];
 const repo=createStaffScannerRepository({supabaseUrl:'https://synthetic.supabase.co',
 publishableKey:'sb_publishable_synthetic',staff,fetcher:async(url,opts)=>{
  calls.push({url,opts});return Response.json(true);
 }});
 assert.equal(await repo.verifyAndConsumeQr({clubId:a,memberId:m,nonce,scannerUserId:u}),true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.headers.authorization,'Bearer synthetic-user-jwt');
 assert.deepEqual(JSON.parse(calls[0].opts.body),{
  p_club_id:a,p_member_id:m,p_nonce:nonce
 });
 assert.equal(await repo.verifyAndConsumeQr({clubId:b,memberId:m,nonce,scannerUserId:u}),false);
 assert.equal(await repo.verifyAndConsumeQr({clubId:a,memberId:m,nonce,scannerUserId:m}),false);
 assert.equal(calls.length,1);
});
test('RPC rejects replay, down service or malformed outcome',async()=>{
 const make=fn=>createStaffScannerRepository({
  supabaseUrl:'https://synthetic.supabase.co',publishableKey:'public',staff,fetcher:fn
 });
 const op={clubId:a,memberId:m,nonce,scannerUserId:u};
 assert.equal(await make(async()=>Response.json(false)).verifyAndConsumeQr(op),false);
 await assert.rejects(make(async()=>Response.json({message:'not found'},{status:404})).verifyAndConsumeQr(op),
 {code:'SCANNER_RPC_UNAVAILABLE'});
 await assert.rejects(make(async()=>Response.json({ok:true})).verifyAndConsumeQr(op),
 {code:'SCANNER_RPC_INVALID'});
});
