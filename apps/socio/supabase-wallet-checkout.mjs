/**
 * Review-only backend: atomic SNOOP order creation and cancellation with Monedero.
 * This must NEVER use separate order+spend or cancel+refund HTTP calls.
 * Only server-verified staff JWT is forwarded; no privileged service-role key.
 * Not mounted in live SNOOP management Worker.
 */
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const validId=x=>typeof x==='string'&&UUID.test(x);
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
const safeAmount=x=>Number.isSafeInteger(x)&&x>0&&x<=10000000;
const specs={
 order:{rpc:'socio_create_wallet_order',required:['memberId','items','operationId'],allowed:['memberId','notes','items','operationId']},
 cancel:{rpc:'socio_cancel_wallet_order',required:['memberId','orderId','reason','operationId'],allowed:['memberId','orderId','reason','operationId']}
};
export function createSupabaseAtomicWalletOrderRepository({supabaseUrl,publishableKey,staff,fetcher=fetch}){
 if(!/^https:\/\/[^/]+$/.test(supabaseUrl||'')||!publishableKey||
   !validId(staff?.userId)||!validId(staff?.clubId)||!staff?.accessToken||
   staff.verified!==true||staff.accountType!=='staff')
   throw fail('WALLET_ORDER_REPOSITORY_NOT_CONFIGURED');
 return {
  async execute(kind,request){
   const spec=specs[kind];
   if(!spec||!request||Object.keys(request).some(k=>!spec.allowed.includes(k))||
      spec.required.some(k=>!Object.hasOwn(request,k))||
      !validId(request.memberId)||!validId(request.operationId))
     throw fail('WALLET_ORDER_INPUT_INVALID',400);
   if(!Array.isArray(staff.permissions)||!staff.permissions.includes('use_cash')||
      !staff.permissions.includes(kind==='order'?'wallet_spend':'wallet_refund')||
      (kind==='cancel'&&!staff.permissions.includes('manage_members')))
     throw fail('WALLET_ORDER_PERMISSION_DENIED',403);
   let body;
   if(kind==='order'){
    if(typeof request.notes!=='string'||request.notes.length>2000||
      !Array.isArray(request.items)||request.items.length<1||request.items.length>100)
      throw fail('WALLET_ORDER_ITEMS_INVALID',400);
    for(const item of request.items){
     if(!item||typeof item!=='object'||Array.isArray(item)||
       Object.keys(item).some(k=>!['product_id','product_name','unit_type','quantity','merma','unit_price_cents','line_total_cents'].includes(k))||
       !validId(item.product_id)||typeof item.product_name!=='string'||
       item.product_name.length<1||item.product_name.length>160||
       !['gr','unit'].includes(item.unit_type)||
       typeof item.quantity!=='number'||!Number.isFinite(item.quantity)||
       item.quantity<=0||item.quantity>100000||
       (item.merma!==undefined&&(typeof item.merma!=='number'||!Number.isFinite(item.merma)||item.merma<0||item.merma>100000))||
       !safeAmount(item.line_total_cents)||!Number.isSafeInteger(item.unit_price_cents)||
       item.unit_price_cents<0||item.unit_price_cents>10000000)
       throw fail('WALLET_ORDER_ITEM_INVALID',400);
    }
    body={p_member_id:request.memberId,p_notes:request.notes,p_items:request.items,p_operation_id:request.operationId};
   }else{
    if(!validId(request.orderId)||typeof request.reason!=='string'||
       request.reason.trim().length<5||request.reason.length>2000)
       throw fail('WALLET_CANCEL_INPUT_INVALID',400);
    body={p_member_id:request.memberId,p_order_id:request.orderId,
      p_reason:request.reason.trim(),p_refund_operation_id:request.operationId};
   }
   let response;
   try{
    response=await fetcher(supabaseUrl+'/rest/v1/rpc/'+spec.rpc,{
      method:'POST',headers:{apikey:publishableKey,
       authorization:'Bearer '+staff.accessToken,'content-type':'application/json',
       accept:'application/json'},body:JSON.stringify(body),redirect:'error',
       signal:AbortSignal.timeout(12000)
    });
   }catch{throw fail('WALLET_ORDER_RPC_UNAVAILABLE');}
   if(!response.ok){
    if([401,403].includes(response.status))throw fail('WALLET_ORDER_NOT_AUTHORIZED',403);
    if([400,409,422].includes(response.status))throw fail('WALLET_ORDER_REJECTED',409);
    throw fail('WALLET_ORDER_RPC_UNAVAILABLE');
   }
   const result=await response.json().catch(()=>null);
   const refund=kind==='cancel';
   if(!result||result.status!=='applied'||!validId(result.orderId)||
      !validId(result[refund?'refundOperationId':'operationId'])||
      result[refund?'refundOperationId':'operationId']!==request.operationId||
      (refund&&result.orderId!==request.orderId)||
      !Number.isSafeInteger(result.balanceCents)||result.balanceCents<0||
      !safeAmount(result[refund?'refundCents':'amountCents']))
     throw fail('WALLET_ORDER_RPC_INVALID_RESPONSE');
   return result;
  }
 };
}
