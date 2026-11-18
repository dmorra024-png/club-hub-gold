import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireClubMemberAuth} from "@/integrations/supabase/auth-middleware";
import {requireOperationalClub} from "@/lib/club-access.server";
import {verifySnoopSocioToken} from "./socio-qr-validation.server";

/** Verify QR and consume nonce once under the logged-in staff JWT / same club. */
export const verifySnoopSocioScan=createServerFn({method:"POST"})
 .middleware([requireClubMemberAuth])
 .inputValidator((raw:unknown)=>z.object({token:z.string().regex(/^ssc2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).max(1200)}).strict().parse(raw))
 .handler(async ({context,data})=>{
  const clubId=await requireOperationalClub(context,"manage_members");
  const secret=process.env.SOCIO_QR_SIGNING_KEY_BASE64;
  if(!secret)throw new Error("QR SNOOP Socio no configurado en este servidor.");
  const decoded=await verifySnoopSocioToken(data.token,clubId,secret);
  const {data:consumed,error}=await (context.supabase as any)
    .rpc("socio_staff_consume_qr",{
      p_club_id:clubId,p_member_id:decoded.memberId,p_nonce:decoded.nonce
    });
  if(error||consumed!==true)throw new Error("QR no válido, revocado o ya escaneado.");
  return {memberId:decoded.memberId};
 });
