import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto}from'node:crypto';
import {makeSocioService}from'./service.mjs';
globalThis.crypto??=webcrypto;
const a='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',b='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4',m='c319b1ed-9389-4c81-9e7f-42f808d95c34',n='437f044d-9c4d-4b95-8672-d2b8c9af3851',u='9d5d3ca0-de23-467b-8ad4-211fce9003b9',other='9ab51fa6-dff9-4d15-a80a-a32295264c8d',now=1800000000000;
const usedNonces=new Set();
const repo={
 linksForUser:async user=>[{authUserId:u,status:'verified',clubId:a,memberId:m},{authUserId:u,status:'verified',clubId:b,memberId:n}].filter(x=>x.authUserId===user),
 membershipsForUser:async user=>user===u?[{clubId:a,memberId:m,active:true,memberNumber:'124',clubName:'Club A',walletEnabled:true},{clubId:b,memberId:n,active:true,memberNumber:'872',clubName:'Club B',walletEnabled:false}]:[],
 claimAndConsumeLinkChallenge:async()=>({ok:false}),
 autoLinkForVerifiedEmail:async ({verifiedEmail})=>({linkedCount:verifiedEmail==='socio@example.com'?2:0}),
 walletForMember:async clubId=>clubId===a?{balanceCents:2550}:null,
 walletMovementsForMember:async clubId=>clubId===a?[{deltaCents:5000,balanceCents:5000,createdAt:'2026-11-17T12:00:00Z',label:'Recarga'},{deltaCents:-2450,balanceCents:2550,createdAt:'2026-11-17T13:00:00Z',label:'Movimiento'}]:[],
 isMemberActive:async (clubId,memberId)=>clubId===a&&memberId===m,
 consumeQrNonce:async({clubId,nonce})=>{const key=clubId+':'+nonce;if(usedNonces.has(key))return false;usedNonces.add(key);return true;}
};
const svc=makeSocioService({repository:repo,signingSecret:new Uint8Array(32).fill(21),now:()=>now});
const actor={userId:u,emailVerified:true,accountType:'socio'};
test('user has club-specific card, no club mismatch, wallet gated per club',async()=>{
 const clubs=await svc.clubs(actor);
 assert.equal(clubs.clubs.length,2);
 assert.equal((await svc.card(actor,a)).memberNumber,'124');
 assert.equal((await svc.card(actor,b)).memberNumber,'872');
 assert.deepEqual(await svc.wallet(actor,a),{balanceCents:2550});
 await assert.rejects(svc.wallet(actor,b),{code:'WALLET_DISABLED'});
 await assert.rejects(svc.card(actor,'de2794a5-275d-4878-ab3e-7d2e3ecae995'),{code:'MEMBERSHIP_NOT_FOUND'});
 assert.equal((await svc.clubs({...actor,userId:other})).clubs.length,0);
});
test('unverified email and staff account cannot read wallet or memberships',async()=>{
 await assert.rejects(svc.clubs({...actor,emailVerified:false}),{code:'SOCIO_UNAUTHORIZED'});
 await assert.rejects(svc.wallet({userId:other,emailVerified:true,accountType:'staff'},a),{code:'SOCIO_UNAUTHORIZED'});
});
test('signed QR rejected across clubs, staff must be authorized',async()=>{
 const {token}=await svc.qr(actor,a);
 const staff={accountType:'staff',verified:true,clubId:a,canScan:true};
 assert.deepEqual(await svc.scan(staff,token),{clubId:a,memberId:m,valid:true});
 await assert.rejects(svc.scan(staff,token),{code:'QR_ALREADY_SCANNED'});
 await assert.rejects(svc.scan({...staff,clubId:b},token),{code:'QR_REJECTED'});
 await assert.rejects(svc.scan({...staff,canScan:false},token),{code:'SCANNER_UNAUTHORIZED'});
 await assert.rejects(svc.scan({...staff,verified:false},token),{code:'SCANNER_UNAUTHORIZED'});
});
test('challenge cannot be claimed by simply knowing email or arbitrary code',async()=>{
 await assert.rejects(svc.linkMembership(actor,'abcdef12'),{code:'LINK_NOT_AUTHORIZED'});
 await assert.rejects(svc.linkMembership(actor,'1'),{code:'LINK_CODE_INVALID'});
 await assert.rejects(svc.linkMembership({...actor,emailVerified:false},'abcdef12'),{code:'SOCIO_UNAUTHORIZED'});
});

test('verified account can synchronize eligible club memberships without a second password',async()=>{
 assert.deepEqual(await svc.syncClubs({...actor,email:'SOCIO@example.com'}),{synced:true,linkedCount:2});
 await assert.rejects(svc.syncClubs({...actor,emailVerified:false,email:'socio@example.com'}),{code:'SOCIO_UNAUTHORIZED'});
 await assert.rejects(svc.syncClubs({...actor,email:'invalid-email'}),{code:'VERIFIED_EMAIL_REQUIRED'});
});

test('wallet history returns scoped integer-cent movements for member club A only',async()=>{
 const result=await svc.walletMovements(actor,a);
 assert.deepEqual(result.items.map(r=>r.deltaCents),[5000,-2450]);
 await assert.rejects(svc.walletMovements(actor,b),{code:'WALLET_DISABLED'});
});
