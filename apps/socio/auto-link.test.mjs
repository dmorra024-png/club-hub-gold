import test from'node:test';
import assert from'node:assert/strict';
import{planAutomaticLinks,normalizeVerifiedEmail}from'./auto-link.mjs';
const u='9d5d3ca0-de23-467b-8ad4-211fce9003b9',a='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',b='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',m='c319b1ed-9389-4c81-9e7f-42f808d95c34',n='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const record=(clubId,memberId)=>({clubId,memberId,email:'socio@example.com',active:true,emailConfirmedAtEnrollment:true});
test('one verified email links memberships in two distinct clubs',()=>{const r=planAutomaticLinks({authUserId:u,verifiedEmail:'Socio@Example.com',emailConfirmed:true,candidates:[record(a,m),record(b,n)]});assert.equal(r.eligible.length,2);assert.notEqual(r.eligible[0].memberId,r.eligible[1].memberId);});
test('unconfirmed Auth or club email never links automatically',()=>{assert.equal(planAutomaticLinks({authUserId:u,verifiedEmail:'socio@example.com',emailConfirmed:false,candidates:[record(a,m)]}).eligible.length,0);assert.equal(planAutomaticLinks({authUserId:u,verifiedEmail:'socio@example.com',emailConfirmed:true,candidates:[{...record(a,m),emailConfirmedAtEnrollment:false}]}).eligible.length,0);});
test('ambiguous same-club records require review and foreign owner is denied',()=>{const args={authUserId:u,verifiedEmail:'socio@example.com',emailConfirmed:true};assert.deepEqual(planAutomaticLinks({...args,candidates:[record(a,m),record(a,n)]}).eligible,[]);assert.equal(planAutomaticLinks({...args,candidates:[{...record(a,m),linkedAuthUserId:n}]}).eligible.length,0);});
test('normalize without Gmail-specific merging',()=>{assert.equal(normalizeVerifiedEmail(' First.Name+test@example.com '),'first.name+test@example.com');});
