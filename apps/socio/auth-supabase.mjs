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
 // Access token short-lived; rolling refresh cookie persists across app restarts.
 // Its 365-day browser lifetime is NOT an authorization bypass: the Auth server
 // may revoke, expire or reject refresh tokens at any time.
 const seconds=Number.isSafeInteger(session.expires_in)?Math.max(30,Math.min(session.expires_in,3600)):1800;
 return [ACCESS+'='+encode(session.access_token)+'; '+common+'; Max-Age='+seconds,
 REFRESH+'='+encode(session.refresh_token)+'; '+common+'; Max-Age=31536000'];
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
  },...(body?{body:JSON.stringify(body)}:{}) ,redirect:'manual',signal:AbortSignal.timeout(8000)});
  // Never follow an upstream redirect: the Supabase bearer token must remain scoped.
  if(!res.ok || (res.status>=300&&res.status<400))return null;
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
 // Deprecated password signup would send a second Supabase confirmation email.
 // Reject it: only the club-issued magiclink email OTP enables Socio setup.
 const signup=async()=>response({
   code:'USE_CLUB_CODE',
   message:'Solicita el código de 6 cifras al club y utilízalo para activar tu cuenta.'
 },409);
 // The club sends ONE Supabase Auth OTP via its verified email provider before account setup.
 // Supabase validates email possession with the same six digits that link the
 // membership in the club. No second confirmation email or admin key here.
 const activate=async({input})=>{
  const email=normalize(input?.email),password=input?.password,code=input?.code;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||
   typeof password!=='string'||password.length<10||password.length>128||
   typeof code!=='string'||!/^[0-9]{6}$/.test(code))
   return failed(400,'INVALID_INPUT');
  try{
   // Admin generateLink({type:'magiclink'}) creates a *confirmation_token*
   // for a never-confirmed email, but a magiclink OTP for existing users.
   // GoTrue /verify must use type='signup' for the former. Try the established
   // magiclink flow first, then signup ONLY for a rejected OTP type. This
   // preserves already-confirmed Socio identities and does not send an email.
   const verify=type=>fetcher(base+'/verify',{
    method:'POST',redirect:'manual',
    headers:{apikey:publishableKey,'content-type':'application/json'},
    body:JSON.stringify({email,token:code,type}),
    signal:AbortSignal.timeout(10000),
   });
   let r=await verify('magiclink');
   if(!r.ok && (r.status===400 || r.status===403)) r=await verify('signup');
   if(!r.ok){
    if(r.status===400 || r.status===403)
     return response({code:'INVALID_CODE',message:'Código de 6 cifras incorrecto o caducado. Pide otro al club.'},403);
    return failed(503,'VERIFICATION_UNAVAILABLE');
   }
   const session=await r.json();
   if(!session?.access_token||!session?.refresh_token)
    return failed(503,'VERIFICATION_UNAVAILABLE');
   // Save the chosen password only after Supabase verified the email OTP.
   const pw=await fetcher(base+'/user',{
    method:'PUT',redirect:'manual',
    headers:{apikey:publishableKey,authorization:'Bearer '+session.access_token,'content-type':'application/json'},
    body:JSON.stringify({password}),signal:AbortSignal.timeout(10000),
   });
   if(!pw.ok)return failed(503,'PASSWORD_SETUP_FAILED');
   // Link the existing card using the SAME code, inside the database's
   // atomic, one-time, five-attempt claim RPC.
   const linked=await fetcher(url+'/rest/v1/rpc/socio_claim_member',{
    method:'POST',redirect:'manual',
    headers:{apikey:publishableKey,authorization:'Bearer '+session.access_token,'content-type':'application/json'},
    body:JSON.stringify({p_code:code}),signal:AbortSignal.timeout(10000),
   });
   if(!linked.ok||await linked.json().catch(()=>false)!==true)
    return response({code:'CLAIM_FAILED',message:'La cuenta se verificó, pero no se pudo vincular el carnet. Solicita un nuevo código al club.'},409);
   const user=await authUser(session.access_token);
   if(!(await checked(user,session.access_token)))return failed(403,'SOCIO_UNAUTHORIZED');
   return response({authenticated:true,activated:true},200,sessionCookies(session));
  }catch{return failed(503,'REGISTRATION_UNAVAILABLE');}
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
  if(token){try{await fetcher(base+'/logout',{method:'POST',headers:{apikey:publishableKey,authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(4000)});}catch{}}
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
 return{authenticate,signup,activate,login,logout,refresh};
}
