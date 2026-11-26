import test from 'node:test';
import assert from 'node:assert/strict';
import {createMembershipClaimIssuer,hashClaimCode} from './claim-challenges.mjs';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const other='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const staff={accountType:'staff',verified:true,userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',clubId:club,canManageMembers:true};
const pair={clubId:club,memberId:member};
test('authorized staff issues 10-minute random, single-display code and stores only SHA256',async()=>{
 const seen=[];
 const issuer=createMembershipClaimIssuer({
  now:()=>1000000,
  randomBytes:n=>new Uint8Array(n).fill(0x42),
  repository:{memberIsClaimable:async()=>true,createClaimChallenge:async v=>{seen.push(v);return true}}
 });
 const result=await issuer.issue(staff,pair);
 assert.equal(result.expiresAt,1600000);
 assert.match(result.code,/^[a-f0-9]{48}$/);
 assert.equal(seen.length,1);
 assert.equal(seen[0].clubId,club);
 assert.equal(seen[0].memberId,member);
 assert.equal(seen[0].issuedBy,staff.userId);
 assert.equal(seen[0].codeHash,await hashClaimCode(result.code));
 assert(!JSON.stringify(seen[0]).includes(result.code));
});
test('staff from another club, arbitrary users, and unclaimable memberships cannot issue',async()=>{
 let stored=0;
 const issuer=createMembershipClaimIssuer({repository:{
  memberIsClaimable:async()=>false,
  createClaimChallenge:async()=>{stored++;return true}
 }});
 await assert.rejects(issuer.issue({...staff,clubId:other},pair),{code:'CLAIM_ISSUER_FORBIDDEN'});
 await assert.rejects(issuer.issue({...staff,canManageMembers:false},pair),{code:'CLAIM_ISSUER_FORBIDDEN'});
 await assert.rejects(issuer.issue({...staff,accountType:'socio'},pair),{code:'CLAIM_ISSUER_FORBIDDEN'});
 await assert.rejects(issuer.issue(staff,pair),{code:'CLAIM_MEMBERSHIP_UNAVAILABLE'});
 assert.equal(stored,0);
});
test('issue rejects an unsuccessful atomic repository transaction and weak random source',async()=>{
 const issuer=createMembershipClaimIssuer({repository:{
  memberIsClaimable:async()=>true,createClaimChallenge:async()=>false
 }});
 await assert.rejects(issuer.issue(staff,pair),{code:'CLAIM_ISSUANCE_UNAVAILABLE'});
 const bad=createMembershipClaimIssuer({
  repository:{memberIsClaimable:async()=>true,createClaimChallenge:async()=>true},
  randomBytes:()=>new Uint8Array(2)
 });
 await assert.rejects(bad.issue(staff,pair),/CLAIM_RANDOM_SOURCE_INVALID/);
});
test('claim code parser rejects invalid and truncated codes before hashing',async()=>{
 await assert.rejects(hashClaimCode('abcd'),{code:'CLAIM_FORMAT_INVALID'});
 await assert.rejects(hashClaimCode('Z'.repeat(48)),{code:'CLAIM_FORMAT_INVALID'});
});
