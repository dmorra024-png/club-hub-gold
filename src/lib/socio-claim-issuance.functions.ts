import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireClubMemberAuth} from "@/integrations/supabase/auth-middleware";
import {requireOperationalClub} from "@/lib/club-access.server";
/**
 * Staff issues 10-minute, single-use Socio access codes for exactly one member.
 * The database enforces staff role, expiry, club scope, rate limit and revocation.
 * Never write this code to logs, member records, or analytics.
 */
export const issueSocioMembershipCode=createServerFn({method:"POST"})
 .middleware([requireClubMemberAuth])
 .inputValidator((value:unknown)=>z.object({memberId:z.string().uuid()}).strict().parse(value))
 .handler(async ({context,data})=>{
  const clubId=await requireOperationalClub(context,"manage_members");
  const {data:code,error}=await (context.supabase as any)
   .rpc("socio_issue_member_claim",{p_club_id:clubId,p_member_id:data.memberId});
  if(error||typeof code!=="string"||!/^[a-f0-9]{48}$/.test(code))
   throw new Error("No se pudo generar el código de vinculación. Verifica el carnet del socio.");
  return {code,expiresInSeconds:600};
 });
