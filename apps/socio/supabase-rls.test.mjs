import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocioRlsRepository} from './supabase-rls.mjs';
const uid='9d5d3ca0-de23-467b-8ad4-211fce9003b9',other='9ab51fa6-dff9-4d15-a80a-a32295264c8d',club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',member='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const calls=[];
const make=(fetcher=async(url,opts)=>{calls.push({url,opts});if(url.includes('/socio_membership_links'))return Response.json([{auth_user_id:uid,club_id:club,member_id:member,status:'verified'}]);if(url.includes('/socio_member_cards'))return Response.json([{club_id:club,member_id:member,club_name:'Club A',member_number:'12',active:true,wallet_enabled:false,revoked_at:null}]);if(url.includes('/socio_wallet_accounts'))return Response.json([{balance_cents:2530}]);if(url.includes('/socio_wallet_ledger'))return Response.json([]);return Response.json([]);})=>createSocioRlsRepository({url:'https://example.supabase.co',publishableKey:'sb_publishable_test',accessToken:'verified-user-jwt',actorId:uid,fetcher});
test('own scope and RLS bearer headers enforced',async()=>{
 const r=make();const links=await r.linksForUser(uid);
 assert.equal(links.length,1);assert.equal(links[0].clubId,club);
 assert.equal((await r.membershipsForUser(uid))[0].memberNumber,'12');
 assert.equal(calls[0].opts.headers.authorization,'Bearer verified-user-jwt');
 assert.equal(calls[0].opts.headers.apikey,'sb_publishable_test');
 await assert.rejects(r.linksForUser(other),{code:'SOCIO_IDENTITY_SCOPE'});
 await assert.rejects(r.membershipsForUser(other),{code:'SOCIO_IDENTITY_SCOPE'});
});
test('wallet uses club and member scope, with no mutation paths',async()=>{
 const r=make();assert.equal((await r.walletForMember(club,member)).balanceCents,2530);
 assert.deepEqual(await r.walletMovementsForMember(club,member),[]);
 await assert.rejects(r.walletForMember('wrong',member),{code:'SOCIO_WALLET_SCOPE'});
 await assert.rejects(r.autoLinkForVerifiedEmail({}),{code:'SOCIO_AUTOLINK_NOT_AUTHORIZED'});
 await assert.rejects(r.claimAndConsumeLinkChallenge({}),{code:'SOCIO_IDENTITY_SCOPE'});
});
test('query errors are failures, not fake empty membership',async()=>{
 const r=make(async()=>Response.json({message:'permission denied'},{status:403}));
 await assert.rejects(r.membershipsForUser(uid),{code:'SOCIO_READ_UNAVAILABLE'});
});

test('server-side claim RPC uses own verified JWT and only a temporary secret',async()=>{
 const events=[];
 const r=make(async(url,opts)=>{
  events.push({url,opts});
  if(url.endsWith('/rpc/socio_claim_member'))return Response.json(true);
  return Response.json([]);
 });
 const code='a'.repeat(48);
 assert.deepEqual(await r.claimAndConsumeLinkChallenge({code,authUserId:uid}),{ok:true});
 assert.equal(events.length,1);
 assert.match(events[0].url,/\/rpc\/socio_claim_member$/);
 assert.equal(events[0].opts.headers.authorization,'Bearer verified-user-jwt');
 assert.deepEqual(JSON.parse(events[0].opts.body),{p_code:code});
 assert.equal(JSON.stringify(events[0]).includes(member),false);
 await assert.rejects(r.claimAndConsumeLinkChallenge({code,authUserId:other}),{code:'SOCIO_IDENTITY_SCOPE'});
 await assert.rejects(r.claimAndConsumeLinkChallenge({code:'short',authUserId:uid}),{code:'SOCIO_LINK_CODE_INVALID'});
 assert.equal(events.length,1);
});
test('claim RPC rejects spent tokens, fails closed on missing RPC or corrupt reply',async()=>{
 const code='b'.repeat(48);
 const spent=make(async()=>Response.json(false));
 assert.deepEqual(await spent.claimAndConsumeLinkChallenge({code,authUserId:uid}),{ok:false});
 const unavailable=make(async()=>Response.json({message:'RPC missing'},{status:404}));
 await assert.rejects(unavailable.claimAndConsumeLinkChallenge({code,authUserId:uid}),{code:'SOCIO_LINK_PROVIDER_UNAVAILABLE'});
 const corrupt=make(async()=>Response.json({ok:true}));
 await assert.rejects(corrupt.claimAndConsumeLinkChallenge({code,authUserId:uid}),{code:'SOCIO_LINK_BAD_DATA'});
});

test('verified same-user identity autolinks via authenticated RPC without exposing member email or access code',async()=>{
 const requests=[];
 const r=make(async(url,opts)=>{
  requests.push({url,opts});
  if(url.endsWith('/rpc/socio_link_by_verified_email'))return Response.json(2);
  return Response.json([]);
 });
 assert.deepEqual(await r.autoLinkForVerifiedEmail({
  authUserId:uid,verifiedEmail:'socio@example.test',emailConfirmed:true
 }),{linkedCount:2});
 assert.equal(requests.length,1);
 assert.match(requests[0].url,/\/rpc\/socio_link_by_verified_email$/);
 assert.equal(requests[0].opts.headers.authorization,'Bearer verified-user-jwt');
 assert.equal(requests[0].opts.body,'{}');
 assert.equal(JSON.stringify(requests[0]).includes('socio@example.test'),false);
 await assert.rejects(r.autoLinkForVerifiedEmail({
  authUserId:other,verifiedEmail:'socio@example.test',emailConfirmed:true
 }),{code:'SOCIO_AUTOLINK_NOT_AUTHORIZED'});
 await assert.rejects(r.autoLinkForVerifiedEmail({
  authUserId:uid,verifiedEmail:'socio@example.test',emailConfirmed:false
 }),{code:'SOCIO_AUTOLINK_NOT_AUTHORIZED'});
 assert.equal(requests.length,1);
});
test('autolink refuses provider errors and fabricated link counts',async()=>{
 const p={authUserId:uid,verifiedEmail:'socio@example.test',emailConfirmed:true};
 await assert.rejects(make(async()=>Response.json({message:'forbidden'},{status:403})).autoLinkForVerifiedEmail(p),{code:'SOCIO_AUTOLINK_UNAVAILABLE'});
 await assert.rejects(make(async()=>Response.json({bad:5})).autoLinkForVerifiedEmail(p),{code:'SOCIO_AUTOLINK_BAD_DATA'});
});
