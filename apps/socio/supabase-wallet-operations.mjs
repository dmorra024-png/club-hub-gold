/**
 * Server-only PostgREST adapter. Exact SQL RPCs live in REVIEW_ONLY files.
 * JWT is issued to the verified staff, never taken from a browser payload.
 * Each action is a single PostgreSQL RPC/transaction; no service-role key.
 * Online enablement is blocked until settlement proofs are written atomically
 * by the real order-creation workflow and cash summaries are integrated.
 */
const uuid=x=>typeof x==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(x);
const fail=(code,status=503)=>Object.assign(Error(code),{code,status});
const rpc={
 topup:{path:'socio_wallet_topup',keys:['p_club_id','p_member_id','p_cash_session_id','p_operation_id','p_amount_cents']},
 spend:{path:'socio_wallet_order_spend',keys:['p_club_id','p_member_id','p_order_id','p_operation_id','p_amount_cents']},
 refund:{path:'socio_wallet_order_refund',keys:['p_club_id','p_member_id','p_order_id','p_reversal_operation_id','p_operation_id','p_amount_cents']}
};
export function createSupabaseWalletOperationsRepository({
 supabaseUrl,publishableKey,staff,fetcher=fetch
}){
 if(!/^https:\/\/[^/]+$/.test(supabaseUrl||'')||!publishableKey||
    !uuid(staff?.userId)||!uuid(staff?.clubId)||!staff?.accessToken)
  throw Error('WALLET_REPOSITORY_NOT_CONFIGURED');
 return {
  // UI hint only; authorization and active wallet check happen inside RPC.
  async memberWalletEnabled(clubId,memberId){
   return uuid(clubId)&&uuid(memberId)&&clubId===staff.clubId;
  },
  async commitWalletOperation(op){
   if(!op||!rpc[op.kind]||op.clubId!==staff.clubId||
      op.actorId!==staff.userId||!uuid(op.memberId)||
      !uuid(op.operationId)||!Number.isSafeInteger(op.amountCents)||
      op.amountCents<=0||op.amountCents>10000000)
     throw fail('WALLET_OPERATION_SCOPE_INVALID',403);
   const params={
    p_club_id:op.clubId,p_member_id:op.memberId,
    p_operation_id:op.operationId,p_amount_cents:op.amountCents
   };
   if(op.kind==='topup'){
    if(!uuid(op.cashSessionId)||op.orderId||op.reversalOf)
     throw fail('WALLET_TOPUP_INPUT_INVALID',400);
    params.p_cash_session_id=op.cashSessionId;
   }else{
    if(!uuid(op.orderId)||op.cashSessionId)
     throw fail('WALLET_ORDER_INPUT_INVALID',400);
    params.p_order_id=op.orderId;
    if(op.kind==='refund'){
     if(!uuid(op.reversalOf))throw fail('WALLET_REFUND_INPUT_INVALID',400);
     params.p_reversal_operation_id=op.reversalOf;
    }else if(op.reversalOf)throw fail('WALLET_SPEND_INPUT_INVALID',400);
   }
   const spec=rpc[op.kind],body=Object.fromEntries(spec.keys.map(key=>[key,params[key]]));
   let res;
   try{
    res=await fetcher(supabaseUrl+'/rest/v1/rpc/'+spec.path,{
     method:'POST',headers:{
      apikey:publishableKey,authorization:'Bearer '+staff.accessToken,
      accept:'application/json','content-type':'application/json'
     },body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)
    });
   }catch{throw fail('WALLET_RPC_UNAVAILABLE');}
   if(!res.ok){
    if(res.status===401||res.status===403)throw fail('WALLET_NOT_AUTHORIZED',403);
    if(res.status===400||res.status===409)throw fail('WALLET_REJECTED',409);
    throw fail('WALLET_RPC_UNAVAILABLE');
   }
   const result=await res.json().catch(()=>null);
   if(!result||!['applied','duplicate'].includes(result.status)||
      result.operationId!==op.operationId||!uuid(result.operationId)||
      !Number.isSafeInteger(result.balanceCents)||result.balanceCents<0)
    throw fail('WALLET_RPC_BAD_RESPONSE');
   return result;
  }
 };
}
