import test from 'node:test';
import assert from 'node:assert/strict';
import{createStaffClaimHttp}from'./staff-claim-http.mjs';
const origin='https://management.example.test',db='https://example.supabase.co';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const foreign='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const staff={accountType:'staff',verified:true,
 userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',
 clubId:club,canManageMembers:true,accessToken:'verified-server-staff-jwt'};
const req=(body={clubId:club,memberId:member},extra={})=>new Request(
 origin+'/api/snoop-socio-staff/claim',{method:'POST',
 headers:{Origin:origin,'Content-Type':'application/json',...extra},
 body:JSON.stringify(body)});
const make=(who=staff,fetcher=async()=>Response.json('b'.repeat(48)))=>
 createStaffClaimHttp({origin,supabaseUrl:db,publishableKey:'sb_publishable_synthetic',
 authenticateStaff:async()=>who,fetcher});
test('authorized staff issues a single 10-minute one-use code via JWT-scoped RPC',async()=>{
 const events=[];
 const handler=make(staff,async(url,opts)=>{events.push({url,opts});return Response.json('a'.repeat(48))});
 const result=await handler(req());
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{code:'a'.repeat(48),expiresIn:600});
 assert.match(result.headers.get('cache-control'),/no-store/);
 assert.equal(events.length,1);
 assert.equal(events[0].opts.headers.authorization,'Bearer verified-server-staff-jwt');
 assert.deepEqual(JSON.parse(events[0].opts.body),{p_club_id:club,p_member_id:member});
});
test('member, wrong tenant, unauthorized staff and invalid JSON cannot issue codes',async()=>{
 let calls=0;
 const fake=async()=>{calls++;return Response.json('a'.repeat(48))};
 for(const who of [null,{...staff,accountType:'socio'},{...staff,canManageMembers:false},{...staff,accessToken:''}]){
  assert.equal((await make(who,fake)(req())).status,401);
 }
 assert.equal((await make(staff,fake)(req({clubId:foreign,memberId:member}))).status,403);
 assert.equal((await make(staff,fake)(req(undefined,{Origin:'https://evil.test'}))).status,403);
 assert.equal(calls,0);
});
test('provider errors and unexpected code cannot be treated as valid issuance',async()=>{
 const service=make(staff,async()=>Response.json({code:'not a scalar'}));
 assert.equal((await service(req())).status,503);
 const failed=make(staff,async()=>Response.json({message:'RPC absent'},{status:404}));
 assert.equal((await failed(req())).status,503);
});
