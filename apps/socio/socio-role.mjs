/**
 * Uses the existing user_roles own-row RLS policy:
 * (user_id = auth.uid()) OR is_current_user_club_admin(club_id)
 * A Socio identity has no management roles. Fail closed if query fails.
 */
export function createSocioRolePolicy({url,publishableKey,fetcher=fetch}){
 if(!/^https:\/\/[^/]+$/.test(url||'')||!publishableKey)throw Error('ROLE_POLICY_NOT_CONFIGURED');
 return async function isSocioUser(userId,accessToken){
  if(!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(userId||'')||!accessToken)return false;
  try{
   const response=await fetcher(url+'/rest/v1/user_roles?select=role&user_id=eq.'+encodeURIComponent(userId),{
    method:'GET',headers:{apikey:publishableKey,authorization:'Bearer '+accessToken,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)
   });
   if(!response.ok)return false;
   const rows=await response.json();
   if(!Array.isArray(rows))return false;
   // Any management role means not a Socio-only identity. No row is acceptable
   // only because membership-link authorization remains independently required.
   return rows.length===0;
  }catch{return false;}
 };
}
