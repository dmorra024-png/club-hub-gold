import { createServerFn } from "@tanstack/react-start";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
const input = z.object({ memberId: z.string().uuid(), retry: z.boolean().default(false) }).strict();
export const requestMemberMail = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ context, data }) => {
    const { data: result, error } = await (context.supabase as any).rpc(
      "snoop_member_mail_request",
      { p_member: data.memberId, p_retry: data.retry },
    );
    if (error)
      throw new Error(
        "No se ha solicitado el envío: falta activar la cola SNOOP o verificar los permisos/email del socio.",
      );
    return result as { id: string; status: string; attempts: number; error_code: string | null };
  });
export const getMemberMailStatus = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((d: unknown) => z.object({ memberId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ context, data }) => {
    const { data: result, error } = await (context.supabase as any).rpc(
      "snoop_member_mail_status",
      { p_member: data.memberId },
    );
    if (error) throw new Error("Estado no disponible: no se puede confirmar el envío.");
    return result as { status: string; error_code: string | null };
  });
