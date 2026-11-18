/**
 * RLS-only Supabase REST adapter for SNOOP Socio.
 * Never use service_role; every query uses the server-verified user's access JWT.
 * Tables and invoker view below are PROPOSED and not yet present in production.
 * Mutations fail closed until reviewed transaction/RPC implementation exists.
 */
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
const fail=(code,status=503)=>Object.assign(Error(code),{code,status});
export function createSocioRlsRepository({url,publishableKey,accessToken,actorId,fetcher=fetch}){
 if(!/^https:\/\/[^/]+$/.test(url||'')||!publishableKey||!accessToken||!uuid(actorId))throw Error('SOCIO_RLS_REPOSITORY_NOT_CONFIGURED');
 const root=url+'/rest/v1';
 const safeFetch=async(input,init)=>{const r=await fetcher(input,{...init,redirect:'manual'});if(r.status>=300&&r.status<400)throw Error('SUPABASE_REDIRECT_REJECTED');return r;};
 async function select(path){
  const response=await safeFetch(root+path,{method:'GET',headers:{
   'apikey':publishableKey,'authorization':'Bearer '+accessToken,'accept':'application/json'
  },redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw fail('SOCIO_READ_UNAVAILABLE');
  const result=await response.json();
  if(!Array.isArray(result))throw fail('SOCIO_BAD_DATA');
  return result;
 }
 const byId=id=>encodeURIComponent('eq.'+id);
 return{
  async linksForUser(userId){
   if(userId!==actorId)throw fail('SOCIO_IDENTITY_SCOPE',403);
   const rows=await select('/socio_membership_links?select=auth_user_id,club_id,member_id,status&auth_user_id='+byId(userId)+'&status=eq.verified');
   return rows.map(x=>({authUserId:x.auth_user_id,clubId:x.club_id,memberId:x.member_id,status:x.status}));
  },
  async membershipsForUser(userId){
   if(userId!==actorId)throw fail('SOCIO_IDENTITY_SCOPE',403);
   // Invoker-security view MUST expose ONLY verified memberships through RLS.
   const rows=await select('/socio_member_cards?select=club_id,member_id,club_name,member_number,active,wallet_enabled,revoked_at');
   return rows.map(x=>({clubId:x.club_id,memberId:x.member_id,clubName:x.club_name,memberNumber:x.member_number,active:x.active,walletEnabled:x.wallet_enabled,revokedAt:x.revoked_at}));
  },
  async walletForMember(clubId,memberId){
   if(!uuid(clubId)||!uuid(memberId))throw fail('SOCIO_WALLET_SCOPE',403);
   const rows=await select('/socio_wallet_accounts?select=balance_cents&club_id='+byId(clubId)+'&member_id='+byId(memberId)+'&limit=1');
   if(rows.length!==1)throw fail('SOCIO_WALLET_NOT_FOUND',404);
   return{balanceCents:rows[0].balance_cents};
  },
  async walletMovementsForMember(clubId,memberId){
   if(!uuid(clubId)||!uuid(memberId))throw fail('SOCIO_WALLET_SCOPE',403);
   const rows=await select('/socio_wallet_ledger?select=delta_cents,balance_after_cents,created_at,label&club_id='+byId(clubId)+'&member_id='+byId(memberId)+'&order=created_at.desc&limit=100');
   return rows.map(x=>({deltaCents:x.delta_cents,balanceCents:x.balance_after_cents,createdAt:x.created_at,label:x.label}));
  },
  async claimAndConsumeLinkChallenge({code,authUserId}={}){
   if(authUserId!==actorId)throw fail('SOCIO_IDENTITY_SCOPE',403);
   if(typeof code!=='string'||!/^[a-f0-9]{48}$/.test(code))throw fail('SOCIO_LINK_CODE_INVALID',400);
   // The RPC alone owns the transaction and performs fresh user, staff,
   // membership and challenge verification in the database. The browser
   // cannot supply clubId/memberId/userId or control a verified link.
   let res;
   try{
    res=await safeFetch(root+'/rpc/socio_claim_member',{
     method:'POST',headers:{
      apikey:publishableKey,authorization:'Bearer '+accessToken,
      accept:'application/json','content-type':'application/json'
     },body:JSON.stringify({p_code:code}),redirect:'manual',signal:AbortSignal.timeout(8000)
    });
   }catch{throw fail('SOCIO_LINK_PROVIDER_UNAVAILABLE');}
   if(res.status===400||res.status===401||res.status===403||res.status===409)return{ok:false};
   if(!res.ok)throw fail('SOCIO_LINK_PROVIDER_UNAVAILABLE');
   let value;try{value=await res.json();}catch{throw fail('SOCIO_LINK_PROVIDER_UNAVAILABLE');}
   if(typeof value!=='boolean')throw fail('SOCIO_LINK_BAD_DATA');
   return{ok:value};
  },
  async autoLinkForVerifiedEmail(){throw fail('SOCIO_AUTOLINK_WRITE_DISABLED');},
  async isMemberActive(){throw fail('STAFF_SCANNER_ADAPTER_REQUIRED');},
  async consumeQrNonce(){throw fail('STAFF_SCANNER_REPLAY_STORE_REQUIRED');}
 };
}
