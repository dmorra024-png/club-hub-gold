import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeSocioService } from '../apps/socio/service.mjs';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const uid='11111111-1111-4111-8111-111111111111';
const actor={userId:uid,email:'member@example.test',emailVerified:true,accountType:'socio'};
test('no email-only automatic link can be executed',async()=>{
 let called=false;
 const service=makeSocioService({repository:{autoLinkForVerifiedEmail:async()=>{called=true;return{linkedCount:1}}},signingSecret:new Uint8Array(32)});
 await assert.rejects(service.syncClubs(actor),{message:'EMAIL_AUTO_LINK_DISABLED'});
 assert.equal(called,false);
});
test('six-digit claim is validated and forwarded only as a server claim',async()=>{
 const codes=[];
 const service=makeSocioService({repository:{claimAndConsumeLinkChallenge:async x=>{codes.push(x);return{ok:true}}},signingSecret:new Uint8Array(32)});
 for(const invalid of ['12345','1234567','abcdef','123-56','f'.repeat(48)]){
  await assert.rejects(service.linkMembership(actor,invalid),{message:'LINK_CODE_INVALID'});
 }
 assert.equal(codes.length,0);
 assert.deepEqual(await service.linkMembership(actor,'000123'),{linked:true});
 assert.deepEqual(codes,[{code:'000123',authUserId:uid,nowMs:codes[0].nowMs,policy:codes[0].policy}]);
});
test('staff email code is not returned to browser or to manual mail composer',()=>{
 const src=read('src/lib/socio-invitation-email.functions.ts');
 const panel=read('src/components/SocioClientLinkPanel.tsx');
 assert.match(src,/socio_issue_member_claim/);
 assert.match(src,/EMAIL_API_KEY/);
 assert.match(src,/\\d\{6\}/);
 assert.doesNotMatch(src,/status:\s*["']manual/);
 assert.doesNotMatch(panel,/mailto:/);
});
test('member sees entry of six digits; no automatic email sync',()=>{
 const src=read('apps/socio/main.js');
 assert.match(src,/id="claim-form"/);
 assert.match(src,/data-action="reload-clubs"/);
 assert.match(src,/\/link\/claim/);
 assert.doesNotMatch(src,/api\('\/memberships\/sync'/);
});
test('SQL proposal has single-use, expiry, verified-email and per-challenge guesses',()=>{
 const sql=read('apps/socio/schema/SIX_DIGIT_EMAIL_ACTIVATION_REVIEW_ONLY.sql');
 for(const fragment of ['otp_attempts<5','expires_at>now()','email_confirmed_at is not null','consumed_at=now()','FOR UPDATE','socio_issue_member_claim']) {
  assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()),'Missing SQL guard: '+fragment);
 }
});
