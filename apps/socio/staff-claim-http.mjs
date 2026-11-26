/**
 * Independent staff-only claim issuer route; not mounted in the live management app.
 * Staff MUST come from fresh server-side JWT and DB role checks, never JSON.
 * Supabase SQL RPC rechecks staff role, club, active member, and rate limits.
 */
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store, private',
 'pragma':'no-cache','x-content-type-options':'nosniff'
}});
const deny=(code,status=403)=>response({code},status);
export function createStaffClaimHttp({origin,authenticateStaff,supabaseUrl,publishableKey,fetcher=fetch}){
 if(typeof origin!=='string'||new URL(origin).origin!==origin||
  !/^https:\/\/[^/]+$/.test(supabaseUrl||'')||!publishableKey||
  typeof authenticateStaff!=='function')throw Error('STAFF_CLAIM_NOT_CONFIGURED');
 return async request=>{
  try{
   const url=new URL(request.url);
   if(url.origin!==origin)return deny('STAFF_CLAIM_ORIGIN_DENIED');
   if(url.pathname!=='/api/snoop-socio-staff/claim')return deny('STAFF_CLAIM_NOT_FOUND',404);
   if(request.method!=='POST')return deny('STAFF_CLAIM_METHOD_DENIED',405);
   if(request.headers.get('origin')!==origin||
     !['same-origin','none',null].includes(request.headers.get('sec-fetch-site'))||
     !request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      return deny('STAFF_CLAIM_CSRF_DENIED');
   const staff=await authenticateStaff(request);
   if(!staff||staff.accountType!=='staff'||staff.verified!==true||
      !uuid(staff.userId)||!uuid(staff.clubId)||!staff.canManageMembers||
      typeof staff.accessToken!=='string'||!staff.accessToken)
      return deny('STAFF_CLAIM_UNAUTHORIZED',401);
   const raw=await request.text();
   if(raw.length>350)return deny('STAFF_CLAIM_PAYLOAD_TOO_LARGE',400);
   let input;try{input=JSON.parse(raw);}catch{return deny('STAFF_CLAIM_JSON_INVALID',400);}
   if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).length!==2||!uuid(input.clubId)||!uuid(input.memberId)||
      input.clubId!==staff.clubId)return deny('STAFF_CLAIM_SCOPE_DENIED',403);
   // The trusted RPC generates and stores the hash under a transaction;
   // the raw code is returned only once to this staff response.
   const result=await fetcher(supabaseUrl+'/rest/v1/rpc/socio_issue_member_claim',{
    method:'POST',headers:{apikey:publishableKey,
     authorization:'Bearer '+staff.accessToken,
     'content-type':'application/json',accept:'application/json'
    },
    body:JSON.stringify({p_club_id:input.clubId,p_member_id:input.memberId}),
    redirect:'error',signal:AbortSignal.timeout(8000)
   });
   if(!result.ok)return deny('STAFF_CLAIM_REJECTED',result.status===401||result.status===403?403:503);
   const code=await result.json();
   if(typeof code!=='string'||!/^[a-f0-9]{48}$/.test(code))return deny('STAFF_CLAIM_BAD_RESPONSE',503);
   return response({code,expiresIn:600});
  }catch{return deny('STAFF_CLAIM_UNAVAILABLE',503);}
 };
}
