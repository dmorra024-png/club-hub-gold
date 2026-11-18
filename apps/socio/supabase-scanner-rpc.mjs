/**
 * Trusted staff-side QR nonce repository. The encrypted QR is already
 * authenticated by makeSocioService.scan() before this RPC is called.
 * Real staff authentication MUST be verified by the host, not request JSON.
 */
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
export function createStaffScannerRepository({supabaseUrl,publishableKey,staff,fetcher=fetch}){
 if(!/^https:\/\/[^/]+$/.test(supabaseUrl||'')||!publishableKey||
  !staff||!uuid(staff.userId)||!uuid(staff.clubId)||
  typeof staff.accessToken!=='string'||!staff.accessToken)
  throw Error('SCANNER_REPOSITORY_NOT_CONFIGURED');
 return{
  async verifyAndConsumeQr({clubId,memberId,nonce,scannerUserId}){
   if(!uuid(clubId)||!uuid(memberId)||clubId!==staff.clubId||
     scannerUserId!==staff.userId||typeof nonce!=='string'||
     !/^[A-Za-z0-9_-]{20,30}$/.test(nonce))
    return false;
   const result=await fetcher(supabaseUrl+'/rest/v1/rpc/socio_staff_consume_qr',{
    method:'POST',headers:{apikey:publishableKey,
     authorization:'Bearer '+staff.accessToken,
     accept:'application/json','content-type':'application/json'},
    body:JSON.stringify({p_club_id:clubId,p_member_id:memberId,p_nonce:nonce}),
    redirect:'error',signal:AbortSignal.timeout(8000)
   });
   if(!result.ok)throw Object.assign(Error('SCANNER_RPC_UNAVAILABLE'),{status:503,code:'SCANNER_RPC_UNAVAILABLE'});
   const verdict=await result.json().catch(()=>null);
   if(typeof verdict!=='boolean')throw Object.assign(Error('SCANNER_RPC_INVALID'),{status:503,code:'SCANNER_RPC_INVALID'});
   return verdict;
  }
 };
}
