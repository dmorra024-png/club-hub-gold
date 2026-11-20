import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseSocioAuth} from './auth-supabase.mjs';
const uid='c319b1ed-9389-4c81-9e7f-42f808d95c34';
const origin='https://socio.example.test',supabase='https://example.supabase.co';
function fixture({allow=true,confirmed=true}={}){
 const hits=[];
 const fetcher=async(url,opts)=>{
  hits.push({url,opts});
  if(url.includes('/signup?redirect_to='))return Response.json({id:uid});
  if(url.includes('grant_type=password'))return Response.json({access_token:'session-access',refresh_token:'session-refresh',expires_in:1800});
  if(url.includes('grant_type=refresh_token'))return Response.json({access_token:'new-access',refresh_token:'new-refresh',expires_in:1800});
  if(url.endsWith('/user'))return Response.json({id:uid,email:'socio@example.com',email_confirmed_at:confirmed?'2026-11-17T00:00:00Z':null});
  if(url.endsWith('/logout'))return Response.json({});
  return Response.json({}, {status:404});
 };
 const auth=createSupabaseSocioAuth({url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',fetcher,authorizeSocioUser:async id=>allow&&id===uid});
 return{auth,hits};
}
const req=(cookie='')=>new Request(origin+'/api/socio/me',{headers:{cookie}});
const getCookie=(resp,key)=>{
 const h=resp.headers.getSetCookie?.()||[resp.headers.get('set-cookie')||''];
 return h.find(x=>x.startsWith(key+'='))?.split(';')[0]||'';
};
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
 const cookies=refreshed.headers.getSetCookie?.()||[refreshed.headers.get('set-cookie')||''];
 assert.ok(cookies.some(x=>x.startsWith('__Host-snoop_socio_rt=')&&x.includes('Max-Age=31536000')),'refresh cookie remains across long app closures');
 const out=await auth.logout({request:req(getCookie(refreshed,'__Host-snoop_socio_at'))});
 assert.equal(out.status,200);
 assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await auth.refresh({request:req()})).status,401);
});


test('club-OTP signup never sends a separate Supabase signup email',async()=>{
 const {auth,hits}=fixture();
 const out=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(out.status,409);
 assert.equal(hits.length,0);
 assert.match((await out.json()).message,/código de 6 cifras/);
});
test('one code confirms email, sets password, claims carnet and creates session',async()=>{
 const hits=[];
 const auth=createSupabaseSocioAuth({
  url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',
  fetcher:async(url,opts)=>{
   hits.push({url,opts});
   if(url.endsWith('/verify'))return Response.json({access_token:'otp-access',refresh_token:'otp-refresh',expires_in:1800});
   if(url.endsWith('/user')&&opts.method==='PUT')return Response.json({id:uid});
   if(url.endsWith('/rest/v1/rpc/socio_claim_member'))return Response.json(true);
   if(url.endsWith('/user'))return Response.json({id:uid,email:'socio@example.com',email_confirmed_at:'2026-11-20T08:00:00Z'});
   throw Error('unexpected request');
  },authorizeSocioUser:async userId=>userId===uid
 });
 const r=await auth.activate({input:{email:'socio@example.com',password:'correctHorse123!',code:'012345'}});
 assert.equal(r.status,200);
 assert.match(r.headers.get('set-cookie'),/HttpOnly/);
 assert.deepEqual(hits.map(x=>new URL(x.url).pathname),[
  '/auth/v1/verify','/auth/v1/user','/rest/v1/rpc/socio_claim_member','/auth/v1/user'
 ]);
 assert.deepEqual(JSON.parse(hits[0].opts.body),{email:'socio@example.com',token:'012345',type:'magiclink'});
 assert.deepEqual(JSON.parse(hits[2].opts.body),{p_code:'012345'});
 assert.equal(hits.some(x=>x.url.includes('/signup')),false);
});
test('wrong email OTP cannot create account session or set password',async()=>{
 const hits=[];
 const auth=createSupabaseSocioAuth({
  url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',
  fetcher:async(url)=>{hits.push(url);return Response.json({error:'invalid'},{status:403});},
  authorizeSocioUser:async()=>true
 });
 const r=await auth.activate({input:{email:'socio@example.com',password:'correctHorse123!',code:'000001'}});
 assert.equal(r.status,403);
 assert.equal(r.headers.get('set-cookie'),null);
 assert.deepEqual(hits,[supabase+'/auth/v1/verify']);
});
