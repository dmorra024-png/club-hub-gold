import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseSocioAuth} from './auth-supabase.mjs';
const uid='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const origin='https://socio.example.test',supabase='https://example.supabase.co';
function fixture({allow=true,confirmed=true}={}){
 const hits=[];
 const fetcher=async(url,opts)=>{
  hits.push({url,opts});
  if(url.endsWith('/signup'))return Response.json({id:uid});
  if(url.includes('grant_type=password'))return Response.json({access_token:'session-access',refresh_token:'session-refresh',expires_in:1800});
  if(url.includes('grant_type=refresh_token'))return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:1800});
  if(url.endsWith('/user'))return Response.json({id:uid,email:'socio@example.com',email_confirmed_at:confirmed?'2026-11-17T00:00:00Z':null});
  if(url.endsWith('/logout'))return Response.json({});
  return Response.json({}, {status:404});
 };
 const auth=createSupabaseSocioAuth({url:supabase,publishableKey:'sb_publishable_test',fetcher,authorizeSocioUser:async id=>allow&&id===uid});
 return{auth,hits};
}
const req=(cookie='')=>new Request(origin+'/api/socio/me',{headers:{cookie}});
const getCookie=(resp,key)=>{
 const h=resp.headers.getSetCookie?.()||[resp.headers.get('set-cookie')||''];
 return h.find(x=>x.startsWith(key+'='))?.split(';')[0]||'';
};
test('signup does not return session or enumerate membership',async()=>{
 const {auth,hits}=fixture();
 const r=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(hits[0].url,supabase+'/auth/v1/signup');
 assert.equal(hits[0].opts.headers.apikey,'sb_publishable_test');
 assert.equal(JSON.stringify(await r.json()).includes(uid),false);
});
test('login checks verified user and server authorization then sets HttpOnly Secure host-only cookies',async()=>{
 const {auth}=fixture();
 const r=await auth.login({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(r.status,200);
 const cookie=getCookie(r,'__Host-snoop_socio_at');
 assert.ok(cookie.includes('session-access'));
 assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.match(r.headers.get('set-cookie'),/SameSite=Strict/);
 assert.match(r.headers.get('set-cookie'),/Secure/);
 const actor=await auth.authenticate(req(cookie));
 assert.equal(actor?.userId,uid);assert.equal(actor?.accountType,'socio');
});
test('staff account and email-unconfirmed cannot authenticate',async()=>{
 for(const opts of [{allow:false},{confirmed:false}]){
  const {auth}=fixture(opts);
  const r=await auth.login({input:{email:'socio@example.com',password:'password12345'}});
  assert.equal(r.status,401);
  assert.equal(r.headers.get('set-cookie'),null);
 }
});
test('refresh rotates both HttpOnly tokens; logout clears cookies',async()=>{
 const {auth}=fixture();
 const login=await auth.login({input:{email:'socio@example.com',password:'password12345'}});
 const refCookie=getCookie(login,'__Host-snoop_socio_rt');
 const refreshed=await auth.refresh({request:req(refCookie)});
 assert.equal(refreshed.status,200);
 assert.ok(getCookie(refreshed,'__Host-snoop_socio_at').includes('new-access'));
 assert.ok(getCookie(refreshed,'__Host-snoop_socio_rt').includes('new-refresh'));
 const out=await auth.logout({request:req(getCookie(refreshed,'__Host-snoop_socio_at'))});
 assert.equal(out.status,200);
 assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await auth.refresh({request:req()})).status,401);
});
