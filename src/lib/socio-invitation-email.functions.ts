import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperationalClub } from "@/lib/club-access.server";
import { sendProviderEmail } from "@/lib/email-provider.server";

const SOCIO_APP_URL = "https://snoop-socio-pilot.dmorra024.workers.dev/";
const input = z.object({ memberId: z.string().uuid() }).strict();

const safe = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** Send the one-time six-digit activation code from the authenticated server only.
 * Requires the reviewed six-digit SQL RPC and configured mail provider.
 * Never show an OTP to staff/browser, and never open a mailto fallback.
 */
export const sendSocioInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ context, data }) => {
    const clubId = await requireOperationalClub(context, "manage_members");
    const env = (globalThis as any).__env__ ?? process.env;
    if (!env.EMAIL_API_KEY || !env.EMAIL_FROM)
      throw new Error("Envío automático no configurado. Configura el proveedor de correo.");
    // Scope the recipient by the current authorized club; never accept an
    // address or a club identifier from the browser.
    const { data: member, error: memberError } = await context.supabase
      .from("members")
      .select("id,club_id,email,first_name,last_name")
      .eq("id", data.memberId)
      .eq("club_id", clubId)
      .maybeSingle();
    if (memberError || !member || !member.email)
      throw new Error("El socio no tiene un correo válido en este club.");

    const recipient = member.email.trim().toLowerCase();
    if (!z.string().email().safeParse(recipient).success)
      throw new Error("Corrige el correo del socio antes de enviar la invitación.");

    // The OTP is generated on the database server with a 10-minute validity.
    // Do not request it until sender configuration and member email are validated.
    const link = new URL(SOCIO_APP_URL);
    const { data: club } = await context.supabase
      .from("clubs").select("name").eq("id", clubId).maybeSingle();
    const clubName = club?.name ?? "tu club";
    const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");
    const { data: code, error: codeError } = await (context.supabase as any)
      .rpc("socio_issue_member_claim", { p_club_id: clubId, p_member_id: data.memberId });
    if (codeError || typeof code !== "string" || !/^\d{6}$/.test(code))
      throw new Error("No se pudo generar el código de 6 cifras. Verifica la configuración del servidor.");
    const html = `<html lang="es"><body style="background:#0a1425;color:#f3f6fa;padding:28px;font:16px Arial,sans-serif">
      <main style="max-width:520px;margin:auto">
      <h1 style="color:#e5bc78">SNOOP SOCIO</h1>
      <p>Hola ${safe(fullName)},</p>
      <p>${safe(clubName)} te invita a utilizar tu carnet digital SNOOP Socio.</p>
      <p><a href="${safe(link.href)}" style="display:inline-block;padding:15px 22px;background:#e5bc78;color:#101925;text-decoration:none;border-radius:8px;font-weight:700">Abrir SNOOP Socio</a></p>
      <p>Regístrate con este mismo correo y confirma tu dirección. Después introduce este código de activación:</p>
      <p style="font-size:32px;letter-spacing:7px;font-weight:700;color:#e5bc78">${code}</p>
      <p>El código caduca en 10 minutos y solo se puede utilizar una vez. Si caduca, solicita otro correo al club.</p>
      <p style="font-size:13px;color:#bdc7d5">Utiliza el correo electrónico que facilitaste al club. La identidad y la pertenencia al club se verifican antes de mostrar el carnet.</p>
      </main></body></html>`;
    const subject = `SNOOP Socio · Invitación de ${clubName}`;
    const text = `Hola ${fullName}. ${clubName} te invita a SNOOP Socio. Abre la aplicación: ${link.href}\nRegístrate con este mismo correo y confirma tu cuenta. Código de activación de 6 cifras: ${code}. Válido 10 minutos, una sola vez.\n`;
    try {
      // API acceptance is not proof of inbox delivery. Keep feedback precise.
      const result = await sendProviderEmail({
        to: recipient,
        from: env.EMAIL_FROM,
        subject,
        html,
        text,
        idempotency_key: crypto.randomUUID(),
      }, { apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM, endpoint: "https://api.resend.com/emails" });
      if (!result.message_id) throw new Error("Proveedor sin confirmación");
      return { status: "accepted" as const };
    } catch {
      // Provider delivery is not guaranteed by API acceptance.
      throw new Error("El proveedor no confirmó el envío. Comprueba la configuración de correo.");
    }
  });
