import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseClubAuth } from "@/integrations/supabase/auth-middleware";

/**
 * One switch per club; no individual member activation controls.
 * Deliberately unavailable until owner-approved migration and cash checks.
 * The SECURITY DEFINER RPC independently checks the authenticated club admin.
 */
const ready=()=>process.env.SNOOP_WALLET_OPERATIONS_ENABLED==="true";
const blocked=()=>{throw new Error("Monedero pendiente de activación técnica del club. No se ha modificado ningún saldo.");};
export const getClubWalletSettings=createServerFn({method:"GET"})
 .middleware([requireSupabaseClubAuth])
 .handler(async ({context})=>{
  setResponseHeader("Cache-Control","private, no-store");
  // Read may be viewed even when activation is not possible yet.
  if(!ready())return {configured:false,clubEnabled:false,operationsReady:false};
  const {data,error}=await (context.supabase as any)
   .rpc("socio_wallet_club_configuration");
  if(error||!data||data.configured!==true||
     typeof data.clubEnabled!=="boolean")blocked();
  return {configured:true,clubEnabled:data.clubEnabled,operationsReady:true};
 });
export const changeClubWalletSettings=createServerFn({method:"POST"})
 .middleware([requireSupabaseClubAuth])
 .inputValidator((input:unknown)=>z.object({
  enabled:z.boolean(),confirmed:z.literal(true)
 }).strict().parse(input))
 .handler(async ({context,data})=>{
  setResponseHeader("Cache-Control","private, no-store");
  if(!ready())blocked();
  const {data:result,error}=await (context.supabase as any)
   .rpc("socio_wallet_set_club_enabled",{
    p_enabled:data.enabled,p_confirmed:true
   });
  if(error||!result||result.configured!==true||
     result.clubEnabled!==data.enabled||typeof result.changed!=="boolean")blocked();
  return {configured:true,clubEnabled:result.clubEnabled,
   operationsReady:true,changed:result.changed};
 });
