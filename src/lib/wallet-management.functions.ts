import {createServerFn} from "@tanstack/react-start";
import {setResponseHeader} from "@tanstack/react-start/server";
import {z} from "zod";
import {requireClubCashAuth} from "@/integrations/supabase/auth-middleware";
import {requireOperationalClub} from "./club-access.server";

// This integration is intentionally disabled in every existing deployment.
// Do not set the flag before reviewed SQL migrations, cash attribution,
// legacy cancellation guards and the owner-approved staged release.
const available=()=>process.env.SNOOP_WALLET_OPERATIONS_ENABLED==="true";
const uuid=z.string().uuid();
const cents=z.number().int().positive().max(10_000_000);
const line=z.object({
 product_id:uuid,product_name:z.string().min(1).max(160),
 unit_type:z.enum(["gr","unit"]),quantity:z.number().positive().finite().max(100000),
 merma:z.number().finite().min(0).max(100000).optional(),
 unit_price_cents:z.number().int().nonnegative().max(10_000_000),
 line_total_cents:cents
}).strict();
const fail=()=>{throw Error("Monedero no disponible. No se ha registrado ningún movimiento.");};
async function checkMember(context:any,id:string){
 await requireOperationalClub(context,"manage_members");
 const {data,error}=await context.supabase.from("members")
 .select("id").eq("id",id).eq("club_id",context.clubId).maybeSingle();
 if(error||!data)throw Error("Socio no autorizado para este club");
}
export const walletMemberStatus=createServerFn({method:"POST"})
 .middleware([requireClubCashAuth])
 .inputValidator((input:unknown)=>z.object({memberId:uuid}).strict().parse(input))
 .handler(async ({context,data})=>{
  setResponseHeader("Cache-Control","private, no-store");
  if(!available())return {enabled:false,clubEnabled:false,balanceCents:null,cashSessionId:null};
  await checkMember(context,data.memberId);
  const {data:result,error}=await (context.supabase as any).rpc(
   "socio_wallet_staff_member_state",{p_member_id:data.memberId});
  if(error||!result||typeof result.enabled!=="boolean"||typeof result.clubEnabled!=="boolean"||
      (result.enabled&&!result.clubEnabled)||
      (result.enabled&&(!Number.isSafeInteger(result.balanceCents)||
                         result.balanceCents<0)))fail();
  const {data:sessionId,error:sessionError}=await (context.supabase as any).rpc('current_open_cash_session');
  if(sessionError)fail();
  return {enabled:result.enabled,clubEnabled:result.clubEnabled,balanceCents:result.enabled?result.balanceCents:null,
   cashSessionId:uuid.safeParse(sessionId).success?sessionId:null};
 });
export const walletTopup=createServerFn({method:"POST"})
 .middleware([requireClubCashAuth])
 .inputValidator((input:unknown)=>z.object({
  memberId:uuid,cashSessionId:uuid,operationId:uuid,
  amountCents:cents,paymentMethod:z.enum(["cash","card","transfer"]),confirmed:z.literal(true)
 }).strict().parse(input))
 .handler(async ({context,data})=>{
  if(!available())fail();
  await checkMember(context,data.memberId);
  const {data:result,error}=await (context.supabase as any).rpc("socio_wallet_topup_with_method",{
   p_club_id:context.clubId,p_member_id:data.memberId,
   p_cash_session_id:data.cashSessionId,p_operation_id:data.operationId,
   p_amount_cents:data.amountCents,p_payment_method:data.paymentMethod
  });
  if(error||!result||!["applied","duplicate"].includes(result.status)||
      result.operationId!==data.operationId||
      !Number.isSafeInteger(result.balanceCents)||result.balanceCents<0)fail();
  return result as {status:"applied"|"duplicate";operationId:string;balanceCents:number};
 });
export const walletCheckout=createServerFn({method:"POST"})
 .middleware([requireClubCashAuth])
 .inputValidator((input:unknown)=>z.object({
  memberId:uuid,notes:z.string().max(2000),
  items:z.array(line).min(1).max(100),operationId:uuid,
  confirmed:z.literal(true)
 }).strict().parse(input))
 .handler(async ({context,data})=>{
  if(!available())fail();
  await checkMember(context,data.memberId);
  const {data:result,error}=await (context.supabase as any).rpc("socio_create_wallet_order",{
   p_member_id:data.memberId,p_notes:data.notes,p_items:data.items,
   p_operation_id:data.operationId
  });
  if(error||!result||result.status!=="applied"||
     result.operationId!==data.operationId||
     !Number.isSafeInteger(result.balanceCents)||result.balanceCents<0||
     !uuid.safeParse(result.orderId).success)fail();
  return result as {status:"applied";orderId:string;balanceCents:number;amountCents:number};
 });
export const walletOrderPaymentState=createServerFn({method:"POST"})
 .middleware([requireClubCashAuth])
 .inputValidator((input:unknown)=>z.object({orderId:uuid}).strict().parse(input))
 .handler(async ({context,data})=>{
  setResponseHeader("Cache-Control","private, no-store");
  if(!available())return {wallet:false};
  await requireOperationalClub(context,"manage_members");
  const {data:result,error}=await (context.supabase as any).rpc(
   "socio_wallet_order_payment_state",{p_order_id:data.orderId});
  if(error||!result||typeof result.wallet!=="boolean")fail();
  return {wallet:result.wallet};
 });
export const walletCancel=createServerFn({method:"POST"})
 .middleware([requireClubCashAuth])
 .inputValidator((input:unknown)=>z.object({
  memberId:uuid,orderId:uuid,reason:z.string().trim().min(5).max(2000),
  operationId:uuid,confirmed:z.literal(true)
 }).strict().parse(input))
 .handler(async ({context,data})=>{
  if(!available())fail();
  await checkMember(context,data.memberId);
  const {data:result,error}=await (context.supabase as any).rpc("socio_cancel_wallet_order",{
   p_member_id:data.memberId,p_order_id:data.orderId,p_reason:data.reason,
   p_refund_operation_id:data.operationId
  });
  if(error||!result||result.status!=="applied"||
     result.refundOperationId!==data.operationId||result.orderId!==data.orderId||
     !Number.isSafeInteger(result.balanceCents)||result.balanceCents<0)fail();
  return result as {status:"applied";orderId:string;balanceCents:number;refundCents:number};
 });
