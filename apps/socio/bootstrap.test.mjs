import test from 'node:test';
import assert from 'node:assert/strict';
import{createSocioApplication}from'./bootstrap.mjs';
const origin='https://socio.example.test';
const uid='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const requests=[];
const fetcher=async(url,opts)=>{
 requests.push({url,opts});
 if(url.endsWith('/auth/v1/token?grant_type=password'))return Response.json({access_token:'access-jwt',refresh_token:'refresh-token',expires_in:3600});
 if(url.endsWith('/auth/v1/user'))return Response.json({id:uid,email:'socio@example.test',email_confirmed_at:'2026-11-17T12:00:00Z'});
 if(url.includes('/rest/v1/socio_membership_links'))return Response.json([]);
 if(url.includes('/rest/v1/socio_member_cards'))return Response.json([]);
 return Response.json({message:'missing'},{status:404});
};
const make=(allow=true)=>createSocioApplication({supabaseUrl:'https://project.supabase.co',origin,publishableKey:'sb_publishable_test',qrSigningSecret:new Uint8Array(32).fill(11),authorizeSocioUser:async id=>allow&&id===uid,renderQrPng:async()=>new Uint8Array(20).fill(1),fetcher});
test('standalone signup/login and same-user RLS read, never service_role',async()=>{
 const app=make();
 const login=await app(new Request(origin+'/api/socio/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'socio@example.test',password:'longenoughpass'})}));
 assert.equal(login.status,200);
 const cookie=(login.headers.getSetCookie?.()||[]).find(x=>x.startsWith('__Host-snoop_socio_at='))?.split(';')[0];
 assert.ok(cookie);
 const clubs=await app(new Request(origin+'/api/socio/clubs',{headers:{cookie}}));
 assert.equal(clubs.status,200);
 assert.deepEqual((await clubs.json()).clubs,[]);
 const db=requests.find(x=>x.url.includes('/rest/v1/socio_membership_links'));
 assert.equal(db.opts.headers.authorization,'Bearer access-jwt');
 assert.equal(db.opts.headers.apikey,'sb_publishable_test');
 assert.equal(JSON.stringify(requests).includes('service_role'),false);
});
test('an existing management user cannot access or log in to member app',async()=>{
 const app=make(false);
 const login=await app(new Request(origin+'/api/socio/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'socio@example.test',password:'longenoughpass'})}));
 assert.equal(login.status,401);
});
test('worker refuses to start without separately approved user authorization and QR renderer',()=>{
 assert.throws(()=>createSocioApplication({supabaseUrl:'https://project.supabase.co',origin,publishableKey:'test',qrSigningSecret:new Uint8Array(32)}),/SOCIO_PRODUCTION_ADAPTERS_REQUIRED/);
});
