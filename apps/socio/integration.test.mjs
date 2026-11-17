/**
 * Cross-module integration test for the Socio application contract.
 * Uses synthetic MEMBERSHIPS ONLY. Not a production service or live credentials.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { makeSocioHttpHandler } from './http.mjs';
import { makeSocioService } from './service.mjs';
import { planAutomaticLinks } from './auto-link.mjs';
globalThis.crypto ??= webcrypto;
const origin='https://socio.example.test';
const a='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',b='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const memberA='c319b1ed-9389-4c81-9e7f-42f808d95c34',memberB='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const user='9d5d3ca0-de23-467b-8ad4-211fce9003b9';
const other='9ab51fa6-dff9-4d15-a80a-a32295264c8d';
const now=1800000000000;
const cards=[
 {clubId:a,memberId:memberA,clubName:'Club A',memberNumber:'0124',email:'socio@example.test',active:true,emailConfirmedAtEnrollment:true,walletEnabled:true},
 {clubId:b,memberId:memberB,clubName:'Club B',memberNumber:'0771',email:'socio@example.test',active:true,emailConfirmedAtEnrollment:true,walletEnabled:true}
];
function makeFixture(){
 const links=[];
 const repo={
  async linksForUser(id){return links.filter(x=>x.authUserId===id)},
  async membershipsForUser(){return cards},
  async autoLinkForVerifiedEmail({authUserId,verifiedEmail,emailConfirmed,policy}){
   const proposal=policy({authUserId,verifiedEmail,emailConfirmed,candidates:cards});
   for(const link of proposal.eligible){
    if(!links.some(x=>x.clubId===link.clubId&&x.memberId===link.memberId)){
      links.push({...link,status:'verified'});
    }
   }
   return{linkedCount:proposal.eligible.length};
  },
  async claimAndConsumeLinkChallenge(){return{ok:false}},
  async walletForMember(clubId,memberId){return{balanceCents:clubId===a?5000:clubId===b?1800:0}},
  async walletMovementsForMember(clubId){return[{deltaCents:clubId===a?5000:1800,balanceCents:clubId===a?5000:1800,createdAt:'2026-11-17T12:00:00Z',label:'Recarga'}]},
  async isMemberActive(clubId,memberId){return cards.some(x=>x.clubId===clubId&&x.memberId===memberId&&x.active)}
 };
 const service=makeSocioService({repository:repo,signingSecret:new Uint8Array(32).fill(7),now:()=>now});
 const authenticate=async request=>request.headers.get('authorization')==='socio'?
  {userId:user,accountType:'socio',emailVerified:true,email:'socio@example.test'}:
  request.headers.get('authorization')==='other'?
  {userId:other,accountType:'socio',emailVerified:true,email:'other@example.test'}:null;
 const png=new Uint8Array([137,80,78,71,13,10,26,10,...new Array(24).fill(0)]);
 const handle=makeSocioHttpHandler({service,authenticate,renderQrPng:async()=>png,origin});
 const get=(path,as='socio')=>handle(new Request(origin+'/api/socio'+path,{headers:{authorization:as}}));
 const post=(path,as='socio')=>handle(new Request(origin+'/api/socio'+path,{method:'POST',headers:{authorization:as,origin,'content-type':'application/json'},body:'{}'}));
 return{get,post,service,links};
}
test('login account can link two independently verified clubs, each with separate QR, member number and wallet',async()=>{
 const x=makeFixture();
 assert.deepEqual((await(await x.get('/clubs')).json()).clubs,[]);
 const syn=await(await x.post('/memberships/sync')).json();
 assert.equal(syn.linkedCount,2);
 const linked=(await(await x.get('/clubs')).json()).clubs;
 assert.equal(linked.length,2);
 assert.equal((await(await x.get('/clubs/'+a+'/carnet')).json()).memberNumber,'0124');
 assert.equal((await(await x.get('/clubs/'+b+'/carnet')).json()).memberNumber,'0771');
 assert.equal((await(await x.get('/clubs/'+a+'/wallet')).json()).balanceCents,5000);
 assert.equal((await(await x.get('/clubs/'+b+'/wallet')).json()).balanceCents,1800);
 assert.equal((await x.get('/clubs/'+a+'/carnet/qr')).headers.get('content-type'),'image/png');
 assert.equal((await x.get('/clubs/'+b+'/carnet/qr')).headers.get('content-type'),'image/png');
 const movements=await(await x.get('/clubs/'+b+'/wallet/movements')).json();
 assert.equal(movements.items[0].balanceCents,1800);
});
test('different Socio account does not inherit other memberships, wallets or QR',async()=>{
 const x=makeFixture();await x.post('/memberships/sync');
 assert.equal((await(await x.get('/clubs','other')).json()).clubs.length,0);
 assert.equal((await x.get('/clubs/'+a+'/carnet','other')).status,404);
 assert.equal((await x.get('/clubs/'+b+'/wallet','other')).status,404);
 assert.equal((await x.get('/clubs/'+a+'/carnet/qr','other')).status,404);
});
test('auto link refuses unconfirmed enrollment even if email matches',()=>{
 const plan=planAutomaticLinks({authUserId:user,verifiedEmail:'socio@example.test',emailConfirmed:true,candidates:[{...cards[0],emailConfirmedAtEnrollment:false}]});
 assert.equal(plan.eligible.length,0);
});
