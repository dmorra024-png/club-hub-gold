import {createServerFn} from "@tanstack/react-start";
import {setResponseHeader} from "@tanstack/react-start/server";
import {z} from "zod";
import {requireSupabaseClubAuth} from "@/integrations/supabase/auth-middleware";

export const getClubAccessControl=createServerFn({method:"GET"})
 .middleware([requireSupabaseClubAuth])
 .handler(async ({context})=>{
  setResponseHeader("Cache-Control","private, no-store");
  const {data,error}=await (context.supabase as any).rpc("snoop_get_club_access_control");
  if(error||typeof data?.enabled!=="boolean")
   throw new Error("No se pudo consultar el control de acceso del club.");
  return {enabled:data.enabled as boolean};
 });
export const setClubAccessControl=createServerFn({method:"POST"})
 .middleware([requireSupabaseClubAuth])
 .inputValidator((v:unknown)=>z.object({enabled:z.boolean()}).strict().parse(v))
 .handler(async ({context,data})=>{
  setResponseHeader("Cache-Control","private, no-store");
  const {data:result,error}=await (context.supabase as any).rpc("snoop_set_club_access_control",{p_enabled:data.enabled});
  if(error||result?.enabled!==data.enabled)
   throw new Error("No se pudo actualizar la activación del control de acceso.");
  return {enabled:data.enabled};
 });
