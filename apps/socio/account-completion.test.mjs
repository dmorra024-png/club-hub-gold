import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseSocioAuth} from './auth-supabase.mjs';
import {makeSocioHttpHandler} from './http.mjs';
const origin='https://socio.example.test',url='https://tests.supabase.co',uid='c319b1ed-9389-4c81-9e7f-42f808d95c34';
function fixture(){
 const calls=[];
 const fetcher=async(uri,options)=>{
  calls.push({uri,options});
  if(uri.includes('/recover?redirect_to='))return Response.json({});
  if(uri.endsWith('/resend'))return Response.json({});
  if(uri.includes('/token?grant_type=password'))return Response.json({
   access_token:'a.b.c',refresh_token:'refresh',expires_in:3600
  });
  if(uri.endsWith('/user')&&options.method==='PUT')return Response.json({id:uid});
  if(uri.endsWith('/user'))return Response.json({id:uid,email:'member@example.test',
   email_confirmed_at:'2026-11-18T00:00:00Z'});
  return Response.json({},{status:404});
 };
 const auth=createSupabaseSocioAuth({url,publishableKey:'sb_publishable_test',
  signupRedirectUrl:origin+'/',fetcher,authorizeSocioUser:async id=>id===uid});
 return {auth,calls};
}
test('recovery email uses only configured origin and exposes no token',async()=>{
 const {auth,calls}=fixture();
 const r=await auth.recover({input:{email:'member@example.test'}});
 assert.equal(r.status,200);
 assert.equal(r.headers.get('set-cookie'),null);
 assert(calls[0].uri.includes('redirect_to='+encodeURIComponent(origin+'/?snoop_recovery=1')));
 assert(!JSON.stringify(await r.json()).includes('member@example.test'));
});
test('invalid email never sends recovery or confirmation request',async()=>{
 const {auth,calls}=fixture();
 assert.equal((await auth.recover({input:{email:'not an email'}})).status,400);
 assert.equal((await auth.resendConfirmation({input:{email:'invalid@'}})).status,400);
 assert.equal(calls.length,0);
});
test('resending confirmation uses Supabase signup resend and no auth cookies',async()=>{
 const {auth,calls}=fixture();
 const r=await auth.resendConfirmation({input:{email:'member@example.test'}});
 assert.equal(r.status,200);
 assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(calls[0].uri,url+'/auth/v1/resend');
 assert.equal(JSON.parse(calls[0].options.body).type,'signup');
});
test('password update requires reauthentication with current password',async()=>{
 const {auth,calls}=fixture();
 const request=new Request(origin+'/api/socio/auth/change-password',{
  headers:{cookie:'__Host-snoop_socio_at=a.b.c'}});
 const res=await auth.changePassword({request,input:{
  currentPassword:'oldPassWord123!',newPassword:'newPassWord123!'}});
 assert.equal(res.status,200);
 assert.equal((await res.json()).relogin,true);
 assert.match(res.headers.get('set-cookie'),/Max-Age=0/);
 assert(calls.some(x=>x.uri.endsWith('/token?grant_type=password')));
 assert(calls.some(x=>x.uri.endsWith('/user')&&x.options.method==='PUT'));
});
test('no password changes if session absent or passwords equal',async()=>{
 const {auth,calls}=fixture();
 const request=new Request(origin+'/api/socio/auth/change-password');
 assert.equal((await auth.changePassword({request,input:{
  currentPassword:'oldPassword123!',newPassword:'newPassword123!'}})).status,401);
 assert.equal((await auth.changePassword({request,input:{
  currentPassword:'samePassword123!',newPassword:'samePassword123!'}})).status,400);
 assert(!calls.some(x=>x.options.method==='PUT'));
});
test('recovery requires server-verified account and valid token',async()=>{
 const {auth,calls}=fixture();
 assert.equal((await auth.completeRecovery({input:{accessToken:'bad',password:'newPassword123!'}})).status,400);
 const ok=await auth.completeRecovery({input:{accessToken:'a.b.c',password:'newPassword123!'}});
 assert.equal(ok.status,200);
 assert(calls.some(x=>x.options.method==='PUT'));
});
test('auth endpoints reject cross-origin mutations before touching provider',async()=>{
 const {auth,calls}=fixture();
 const handler=makeSocioHttpHandler({origin,
  authenticate:async()=>null,auth,service:{},renderQrSvg:async()=>'<svg></svg>'});
 const request=new Request(origin+'/api/socio/auth/recover',{method:'POST',
  headers:{origin:'https://attacker.example.test','content-type':'application/json'},
  body:JSON.stringify({email:'member@example.test'})});
 assert.equal((await handler(request)).status,403);
 assert.equal(calls.length,0);
});
