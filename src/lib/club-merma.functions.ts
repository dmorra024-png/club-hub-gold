import {createServerFn} from "@tanstack/react-start";
import {setResponseHeader} from "@tanstack/react-start/server";
import {z} from "zod";
import {requireSupabaseClubAuth} from "@/integrations/supabase/auth-middleware";

const valid=z.number().finite().min(0).max(0.5).refine(v=>Number.isInteger(v*1000+1e-9),"Máximo tres decimales");
export const getClubMermaSettings=createServerFn({method:"GET"})
 .middleware([requireSupabaseClubAuth])
 .handler(async ({context})=>{
  setResponseHeader("Cache-Control","private, no-store");
  const {data,error}=await (context.supabase as any).rpc("snoop_get_club_merma");
  if(error||!data||!valid.safeParse(Number(data.maxMermaPerGram)).success)
   throw new Error("No se ha podido consultar el límite de merma del club.");
  return {maxMermaPerGram:Number(data.maxMermaPerGram)};
 });
export const setClubMermaSettings=createServerFn({method:"POST"})
 .middleware([requireSupabaseClubAuth])
 .inputValidator((input:unknown)=>z.object({maxMermaPerGram:valid}).strict().parse(input))
 .handler(async ({context,data})=>{
  setResponseHeader("Cache-Control","private, no-store");
  const {data:result,error}=await (context.supabase as any).rpc("snoop_set_club_merma",{p_limit:data.maxMermaPerGram});
  if(error||!result||Number(result.maxMermaPerGram)!==data.maxMermaPerGram)
   throw new Error("No se pudo guardar la merma permitida. Comprueba tus permisos de administrador.");
  return {maxMermaPerGram:data.maxMermaPerGram};
 });
