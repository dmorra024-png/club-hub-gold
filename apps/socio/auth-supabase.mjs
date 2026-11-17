/**
 * Supabase Auth adapter for an independent SNOOP Socio Worker.
 * Uses the documented GoTrue REST API, never service_role.
 * This module does NOT deploy or change Supabase settings.
 */
const ACCESS='__Host-snoop_socio_at', REFRESH='__Host-snoop_socio_rt';
const common='Path=/; Secure; HttpOnly; SameSite=Strict';
const failed=(status,code)=>new Response(JSON.stringify({code,message:status===401?'Credenciales incorrectas o correo sin confirmar.':'No se pudo completar la solicitud.'}),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const response=(payload,status=200,cookies=[])=>{
 const headers=new Headers({'content-type':'application/json','cache-control':'private, no-store','x-content-type-options':'nosniff'});
 for(const cookie of cookies)headers.append('set-cookie',cookie);
 return new Response(JSON.stringify(payload),{status,headers});
};
const cookies=request=>Object.fromEntries((request.headers.get('cookie')||'').split(';').map(p=>p.trim().split(/=(.*)/s).slice(0,2)).filter(p=>p.length===2));
const clear=()=>[ACCESS+'=; '+common+'; Max-Age=0',REFRESH+'=; '+common+'; Max-Age=0'];
const encode=s=>encodeURIComponent(s);
function sessionCookies(session){
 if(!session||typeof session.access_token!=='string'||typeof session.refresh_token!=='string'||session.access_token.length>9000||session.refresh_token.length>9000)throw Error('SESSION_INVALID');
 // Access token short-lived; refresh token never accessible to page JavaScript.
 const seconds=Number.isSafeInteger(session.expires_in)?Math.max(30,Math.min(session.expires_in,3600)):1800;
 return [ACCESS+'='+encode(session.access_token)+'; '+common+'; Max-Age='+seconds,
 REFRESH+'='+encode(session.refresh_token)+'; '+common+'; Max-Age=2592000'];
}
function tokenIn(request,name){try{const raw=cookies(request)[name];return raw&&raw.length<10000?decodeURIComponent(raw):null;}catch{return null;}}
const normalize=x=>typeof x==='string'?x.trim().toLowerCase():'';
const userVerified=u=>u&&typeof u.id==='string'&&typeof u.email==='string'&&typeof u.email_confirmed_at==='string';
/**
 * Required host-provided authorizeSocioUser(uid) must read trusted DB authorization,
 * deny management/super-admin identities, and permit only socio accounts.
 * Do not use Supabase user_metadata for this check.
 */
export function createSupabaseSocioAuth({url,publishableKey,signupRedirectUrl,fetcher=fetch,authorizeSocioUser}){
 if(typeof url!=='string'||!/^https:\/\/[^/]+$/.test(url)||typeof publishableKey!=='string'||!publishableKey||typeof authorizeSocioUser!=='function')throw Error('SOCIO_AUTH_NOT_CONFIGURED');
 if(typeof signupRedirectUrl!=='string'||!signupRedirectUrl.startsWith('https://')||new URL(signupRedirectUrl).search||new URL(signupRedirectUrl).hash)throw Error('SOCIO_SIGNUP_REDIRECT_REQUIRED');
 const base=url+'/auth/v1';
 async function call(path,{method='GET',body,accessToken}={}){
  const res=await fetcher(base+path,{method,headers:{
   apikey:publishableKey,'content-type':'application/json',...(accessToken?{authorization:'Bearer '+accessToken}:{})
  },...(body?{body:JSON.stringify(body)}:{}) ,redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!res.ok)return null;
  return res.json().catch(()=>null);
 }
 const authUser=async token=>token?call('/user',{accessToken:token}):null;
 const checked=async(user,accessToken)=>{
  if(!userVerified(user))return false;
  // This MUST check server-managed privilege/membership records, not editable metadata.
  return (await authorizeSocioUser(user.id,accessToken))===true;
 };
 const authenticate=async request=>{
  const accessToken=tokenIn(request,ACCESS);
  if(!accessToken)return null;
  const user=await authUser(accessToken);
  if(!(await checked(user,accessToken)))return null;
  return{userId:user.id,email:user.email,emailVerified:true,accountType:'socio',accessToken};
 };
 const signup=async({input})=>{
  const email=normalize(input?.email),password=input?.password;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||typeof password!=='string'||password.length<10||password.length>128)return failed(400,'INVALID_CREDENTIALS');
  // Avoid account existence or membership enumeration; no access cookies are issued.
  // Fail visibly on provider outages instead of pretending a verification email was dispatched.
  let status=0;
  try{
   const result=await fetcher(base+'/signup?redirect_to='+encodeURIComponent(signupRedirectUrl),{
    method:'POST',
    headers:{apikey:publishableKey,'content-type':'application/json'},
    body:JSON.stringify({email,password}),
    redirect:'error',signal:AbortSignal.timeout(8000)
   });
   status=result.status;
  }catch{return failed(503,'SIGNUP_PROVIDER_UNAVAILABLE');}
  if(status>=500||status===429)return failed(503,'SIGNUP_PROVIDER_UNAVAILABLE');
  // A 4xx response can reflect an existing account; return non-enumerating accepted status.
  return response({accepted:true,message:'Si la solicitud es válida, recibirás instrucciones para verificar tu correo.'});
 };
 const login=async({input})=>{
  const email=normalize(input?.email),password=input?.password;
  if(!email||typeof password!=='string'||password.length>128)return failed(401,'INVALID_LOGIN');
  let data;try{data=await call('/token?grant_type=password',{method:'POST',body:{email,password}});}catch{return failed(503,'PROVIDER_UNAVAILABLE');}
  if(!data?.access_token||!data?.refresh_token)return failed(401,'INVALID_LOGIN');
  // Always re-check current Auth user, not the unsigned/stale token response user.
  const user=await authUser(data.access_token);
  if(!(await checked(user,data.access_token)))return failed(401,'INVALID_LOGIN');
  return response({authenticated:true},200,sessionCookies(data));
 };
 const logout=async({request})=>{
  const token=tokenIn(request,ACCESS);
  // Best effort remote revocation, but browser cookies are ALWAYS revoked locally.
  if(token){try{await fetcher(base+'/logout',{method:'POST',headers:{apikey:publishableKey,authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(4000)});}catch{}}
  return response({signedOut:true},200,clear());
 };
 const refresh=async({request})=>{
  const refreshToken=tokenIn(request,REFRESH);
  if(!refreshToken)return response({authenticated:false},401,clear());
  let data;try{data=await call('/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:refreshToken}});}catch{return failed(503,'REFRESH_UNAVAILABLE');}
  if(!data?.access_token||!data.refresh_token)return response({authenticated:false},401,clear());
  const user=await authUser(data.access_token);
  if(!(await checked(user,data.access_token)))return response({authenticated:false},401,clear());
  return response({authenticated:true},200,sessionCookies(data));
 };
 return{authenticate,signup,login,logout,refresh};
}
