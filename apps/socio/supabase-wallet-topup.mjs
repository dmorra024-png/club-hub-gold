/** Server-side repository adapter for the *review-only* transaction RPC.
 * No service role, no client trust, no transaction across multiple API calls.
 * The SQL is authoritative for staff role, cash, membership, opt-in, locks and
 * idempotency. This adapter deliberately does NOT implement spend/refund.
 */
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
const failure=(code,status=503)=>Object.assign(Error(code),{code,status});
export function createSupabaseWalletTopupRepository({
 supabaseUrl,publishableKey,staff,fetcher=fetch
}){
 if(!/^https:\/\/[^/]+$/.test(supabaseUrl||'')||!publishableKey||
   !uuid(staff?.userId)||!uuid(staff?.clubId)||!staff?.accessToken)
   throw Error('WALLET_TOPUP_REPOSITORY_NOT_CONFIGURED');
 const root=supabaseUrl+'/rest/v1';
 const headers={apikey:publishableKey,authorization:'Bearer '+staff.accessToken,
  accept:'application/json','content-type':'application/json'};
 async function call(path,body){
  let r;
  try{r=await fetcher(root+path,{
   method:'POST',headers,body:JSON.stringify(body),redirect:'error',
   signal:AbortSignal.timeout(8000)
  });}catch{throw failure('WALLET_RPC_CONNECTION_FAILED');}
  if(!r.ok){
   if(r.status===401||r.status===403)throw failure('WALLET_NOT_AUTHORIZED',403);
   if(r.status===400||r.status===409)throw failure('WALLET_TRANSACTION_REJECTED',409);
   throw failure('WALLET_RPC_UNAVAILABLE');
  }
  const result=await r.json().catch(()=>null);
  if(!result||!['applied','duplicate'].includes(result.status)||
   !uuid(result.operationId)||!Number.isSafeInteger(result.balanceCents)||
   result.balanceCents<0)throw failure('WALLET_RPC_BAD_RESPONSE');
  return result;
 }
 return {
  // For topups this is only a fail-fast UI hint. Authoritative validation
  // takes place inside socio_wallet_topup() in the same DB transaction.
  async memberWalletEnabled(clubId,memberId){
   return uuid(clubId)&&uuid(memberId)&&clubId===staff.clubId;
  },
  async commitWalletOperation(op){
   if(op.kind!=='topup')throw failure('WALLET_TRANSACTION_NOT_IMPLEMENTED');
   if(op.clubId!==staff.clubId||!uuid(op.memberId)||!uuid(op.cashSessionId)||
    !uuid(op.operationId)||op.actorId!==staff.userId||
    !Number.isSafeInteger(op.amountCents)||op.amountCents<=0)
    throw failure('WALLET_SCOPE_INVALID',403);
   const result=await call('/rpc/socio_wallet_topup',{
    p_club_id:op.clubId,p_member_id:op.memberId,
    p_cash_session_id:op.cashSessionId,
    p_operation_id:op.operationId,p_amount_cents:op.amountCents
   });
   if(result.operationId!==op.operationId)throw failure('WALLET_RPC_OPERATION_MISMATCH');
   return result;
  }
 };
}
