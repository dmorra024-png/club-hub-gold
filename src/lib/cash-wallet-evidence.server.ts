/**
 * Authenticated management read of wallet accounting evidence.
 * No guessed payment methods: historic orders without trusted proof remain
 * unverified. All reads are scoped to the authenticated staff's JWT and club
 * in the database RPC. Disabled unless the owner-approved rollout is active.
 */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function safeId(v:unknown):v is string{return typeof v==="string"&&uuid.test(v);}
function amount(v:unknown):v is number{return Number.isSafeInteger(v)&&Number(v)>0&&Number(v)<=10_000_000;}
export async function readWalletCashEvidence(
 client:any,start:string,end:string
):Promise<{walletOrderIds:Set<string>;topups:Array<{id:string;amountCents:number;cashSessionId:string;actorId:string;at:string;paymentMethod:"cash"|"card"|"transfer"}>}>{
 const empty={walletOrderIds:new Set<string>(),topups:[] as Array<{
  id:string;amountCents:number;cashSessionId:string;actorId:string;at:string;paymentMethod:"cash"|"card"|"transfer"
 }>};
 if(process.env.SNOOP_WALLET_OPERATIONS_ENABLED!=="true")return empty;
 const {data,error}=await client.rpc("socio_wallet_cash_evidence",
  {p_start:start,p_end:end});
 if(error||!data||!Array.isArray(data.walletOrders)||!Array.isArray(data.topups))
  throw Error("No se pudo verificar la contabilidad del Monedero");
 const walletOrderIds=new Set<string>();
 for(const row of data.walletOrders){
  if(!safeId(row?.orderId)||!amount(row?.amountCents)||
      row.paymentMethod!=="wallet"||walletOrderIds.has(row.orderId))
    throw Error("Registro de pago Monedero inválido");
  walletOrderIds.add(row.orderId);
 }
 const topups=[] as typeof empty.topups;
 const seen=new Set<string>();
 for(const row of data.topups){
  if(!safeId(row?.id)||seen.has(row.id)||!amount(row.amountCents)||
     !safeId(row.cashSessionId)||!safeId(row.actorId)||
     typeof row.at!=="string"||!Number.isFinite(Date.parse(row.at))||
     !["cash","card","transfer"].includes(row.paymentMethod))
    throw Error("Movimiento de recarga sin verificar");
  seen.add(row.id);
  topups.push({id:row.id,amountCents:row.amountCents,
   cashSessionId:row.cashSessionId,actorId:row.actorId,at:row.at,
   paymentMethod:row.paymentMethod});
 }
 return {walletOrderIds,topups};
}
