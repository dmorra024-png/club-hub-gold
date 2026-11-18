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
test('signup does not return session or enumerate membership',async()=>{
 const {auth,hits}=fixture();
 const r=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(hits[0].url,supabase+'/auth/v1/signup?redirect_to='+encodeURIComponent(origin+'/'));
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

test('signup reports mail-provider outage and refuses to fake a successful invitation',async()=>{
 const auth=createSupabaseSocioAuth({
  url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',
  fetcher:async()=>Response.json({error:'SMTP unavailable'},{status:503}),
  authorizeSocioUser:async()=>true
 });
 const result=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(result.status,503);
 assert.equal(result.headers.get('set-cookie'),null);
});
test('existing-email response cannot be used to enumerate member accounts',async()=>{
 const auth=createSupabaseSocioAuth({
  url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',
  fetcher:async()=>Response.json({error:'already registered'},{status:422}),
  authorizeSocioUser:async()=>true
 });
 const result=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(result.status,200);
 const body=await result.json();
 assert.equal(body.accepted,true);
 assert.equal(JSON.stringify(body).includes('already registered'),false);
});

test('signup never claims verification mail was sent on missing or unauthorized Auth configuration',async()=>{
 for(const status of [401,403,404]){
  const auth=createSupabaseSocioAuth({
   url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',
   fetcher:async()=>Response.json({error:'invalid auth configuration'},{status}),
   authorizeSocioUser:async()=>true
  });
  const result=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
  assert.equal(result.status,503);
  assert.equal(result.headers.get('set-cookie'),null);
 }
});

test('rejected registration cannot masquerade as verification email',async()=>{
 const auth=createSupabaseSocioAuth({
  url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',
  fetcher:async()=>Response.json({error:'Password rejected by Auth policy'},{status:400}),
  authorizeSocioUser:async()=>true
 });
 const result=await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}});
 assert.equal(result.status,400);
 assert.equal(result.headers.get('set-cookie'),null);
 assert.equal(JSON.stringify(await result.json()).includes('Password rejected'),false);
});

test('Cloudflare Workerd-compatible manual redirects never silently follow credential requests',async()=>{
 const attempts=[];
 const fetcher=async(url,opts)=>{
  attempts.push({url,redirect:opts.redirect});
  if(opts.redirect==='error')throw Error('Workerd unsupported redirect mode');
  if(url.includes('/signup?redirect_to='))return Response.json({id:uid});
  if(url.includes('/token?grant_type=password'))return Response.json({access_token:'session-access',refresh_token:'session-refresh',expires_in:1800});
  if(url.endsWith('/user'))return Response.json({id:uid,email:'socio@example.com',email_confirmed_at:'2026-11-17T00:00:00Z'});
  return Response.json({}, {status:404});
 };
 const auth=createSupabaseSocioAuth({url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',fetcher,authorizeSocioUser:async()=>true});
 assert.equal((await auth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}})).status,200);
 assert.equal((await auth.login({input:{email:'socio@example.com',password:'correctHorse123!'}})).status,200);
 assert(attempts.length>=3);
 assert(attempts.every(r=>r.redirect==='manual'),'never ask Workerd for unsupported error redirect mode');
 const redirectFetch=async()=>new Response(null,{status:302,headers:{Location:'https://untrusted.test/hijack'}});
 const redirectAuth=createSupabaseSocioAuth({url:supabase,publishableKey:'sb_publishable_test',signupRedirectUrl:origin+'/',fetcher:redirectFetch,authorizeSocioUser:async()=>true});
 assert.equal((await redirectAuth.signup({input:{email:'socio@example.com',password:'correctHorse123!'}})).status,503);
});
