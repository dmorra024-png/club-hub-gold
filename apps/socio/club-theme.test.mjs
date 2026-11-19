import test from "node:test";
import assert from "node:assert/strict";
import { makeSocioService } from "./service.mjs";
const a="11111111-1111-4111-8111-111111111111",
 b="22222222-2222-4222-8222-222222222222",
 uid="33333333-3333-4333-8333-333333333333";
const actor={userId:uid,emailVerified:true,accountType:"socio",email:"member@example.com"};
const memberships=[a,b].map((clubId,i)=>({clubId,memberId:i?a: b,clubName:i?"Club B":"Club A",memberNumber:i+1,active:true,walletEnabled:false,revokedAt:null}));
const links=memberships.map(m=>({authUserId:uid,clubId:m.clubId,memberId:m.memberId,status:"verified"}));
function service(themeForClub) {
 return makeSocioService({signingSecret:new Uint8Array(32),repository:{
  linksForUser:async()=>links,membershipsForUser:async()=>memberships,
  themeForClub,
 }});
}
test("distinct verified clubs receive their own curated theme",async()=>{
 const s=service(async id=>id===a?"ruby-gold":"emerald-gold");
 const result=await s.clubs(actor);
 assert.deepEqual(result.clubs.map(c=>c.themeId),["ruby-gold","emerald-gold"]);
 assert.deepEqual(result.clubs.map(c=>c.id),[a,b]);
});
test("unavailable or unknown palettes fall back safely",async()=>{
 const s=service(async id=>{if(id===a)throw Error("db offline");return "javascript:unsafe";});
 const result=await s.clubs(actor);
 assert.deepEqual(result.clubs.map(c=>c.themeId),["navy-gold","navy-gold"]);
});
test("unverified account never reads club theme",async()=>{
 let calls=0;
 const s=service(async()=>{calls++;return "ruby-gold";});
 await assert.rejects(()=>s.clubs({...actor,emailVerified:false}));
 assert.equal(calls,0);
});
