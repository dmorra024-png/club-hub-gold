import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSocioHttpHandler} from './http.mjs';
const origin='https://socio.example.test',club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc';
const actor={userId:'9d5d3ca0-de23-467b-8ad4-211fce9003b9',email:'socio@example.test',emailVerified:true,accountType:'socio'};
const calls=[];
const service={
 clubs:async a=>{calls.push(['clubs',a.userId]);return{clubs:[{id:club,name:'Prueba'}]};},
 syncClubs:async a=>{calls.push(['sync',a.userId]);return{synced:true,linkedCount:1};},
 linkMembership:async(a,c)=>{calls.push(['link',c]);return{linked:true};},
 card:async(a,c)=>{calls.push(['card',c]);return{memberNumber:'124',clubId:c,active:true};},
 wallet:async(a,c)=>({balanceCents:5000}),
 walletMovements:async(a,c)=>({items:[]}),
 qr:async(a,c)=>{calls.push(['qr',c]);return{token:'TOKEN',expiresIn:40}}
};
const PNG=new Uint8Array([137,80,78,71,13,10,26,10,...Array(30).fill(0)]);
const handler=makeSocioHttpHandler({service,authenticate:async req=>req.headers.get('authorization')==='test'?actor:null,renderQrPng:async token=>{assert.equal(token,'TOKEN');return PNG;},origin});
const req=(p,opts={})=>new Request(origin+'/api/socio'+p,opts);
test('anonymous cannot read clubs, card or wallet',async()=>{for(const p of ['/clubs','/clubs/'+club+'/carnet','/clubs/'+club+'/wallet'])assert.equal((await handler(req(p))).status,401);});
test('authenticated member receives card and club-scoped wallet, never cacheable',async()=>{const auth={Authorization:'test'};const clubs=await handler(req('/clubs',{headers:auth}));assert.equal(clubs.status,200);assert.equal(clubs.headers.get('cache-control'),'no-store, private');assert.equal((await clubs.json()).clubs[0].name,'Prueba');
 const card=await handler(req('/clubs/'+club+'/carnet',{headers:auth}));assert.equal((await card.json()).memberNumber,'124');
 const qr=await handler(req('/clubs/'+club+'/carnet/qr',{headers:auth}));assert.equal(qr.status,200);assert.equal(qr.headers.get('content-type'),'image/png');assert.match(qr.headers.get('cache-control'),/no-store/);
});
test('mutation is blocked without same-origin and JSON; never trust caller-supplied actor',async()=>{const post={method:'POST',headers:{'content-type':'application/json'},body:'{}'};
 assert.equal((await handler(req('/memberships/sync',post))).status,403);
 assert.equal((await handler(req('/memberships/sync',{...post,headers:{...post.headers,origin:'https://evil.test',Authorization:'test'}}))).status,403);
 const ok=await handler(req('/memberships/sync',{...post,headers:{...post.headers,origin,Authorization:'test'}}));assert.equal(ok.status,200);
 const invalid=await handler(req('/link/claim',{method:'POST',headers:{origin,Authorization:'test','content-type':'application/json'},body:'not-json'}));assert.equal(invalid.status,400);
});
test('staff and unverified actor cannot use Socio endpoints',async()=>{const deny=makeSocioHttpHandler({service,origin,authenticate:async()=>({...actor,accountType:'staff'})});
 assert.equal((await deny(req('/clubs'))).status,401);
 const unverified=makeSocioHttpHandler({service,origin,authenticate:async()=>({...actor,emailVerified:false})});
 assert.equal((await unverified(req('/clubs'))).status,401);
});
test('login not implemented is unavailable, never pretends account was created',async()=>{const resp=await handler(req('/auth/signup',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"email":"x@y.z","password":"xyz"}'}));assert.equal(resp.status,503);});
test('outside origin and invalid path rejected',async()=>{assert.equal((await handler(new Request('https://evil.test/api/socio/clubs'))).status,403);assert.equal((await handler(req('/not-a-route',{headers:{Authorization:'test'}}))).status,404);});
