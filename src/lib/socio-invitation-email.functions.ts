import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperationalClub } from "@/lib/club-access.server";
import { sendProviderEmail } from "@/lib/email-provider.server";

const SOCIO_APP_URL = "https://snoop-socio-pilot.dmorra024.workers.dev/";
const input = z.object({ memberId: z.string().uuid() }).strict();

const safe = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/**
 * One-click staff invitation: the one-use challenge stays server-side and is
 * sent directly to the member email on file. Never return the secret to staff,
 * never store it in browser state or analytics, never display a copy button.
 */
export const sendSocioInvitationEmail = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ context, data }) => {
    const clubId = await requireOperationalClub(context, "manage_members");
    const env = (globalThis as any).__env__ ?? process.env;
    if (!env.EMAIL_API_KEY || !env.EMAIL_FROM)
      throw new Error("Email App Socio no configurado. No se ha enviado ningún correo.");

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

    // Verify provider configuration BEFORE generating a 10-minute challenge.
    const { data: code, error: issueError } = await (context.supabase as any)
      .rpc("socio_issue_member_claim", { p_club_id: clubId, p_member_id: member.id });
    if (issueError || typeof code !== "string" || !/^[a-f0-9]{48}$/.test(code))
      throw new Error("No se pudo autorizar la invitación SNOOP Socio.");

    const link = new URL(SOCIO_APP_URL);
    // Fragment avoids placing the bearer token in HTTP requests, referrers,
    // reverse-proxy access logs, analytics query strings or URL paths.
    link.hash = "invite=" + code;

    const { data: club } = await context.supabase
      .from("clubs").select("name").eq("id", clubId).maybeSingle();
    const clubName = club?.name ?? "tu club";
    const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");
    const html = `<html lang="es"><body style="background:#0a1425;color:#f3f6fa;padding:28px;font:16px Arial,sans-serif">
      <main style="max-width:520px;margin:auto">
      <h1 style="color:#e5bc78">SNOOP SOCIO</h1>
      <p>Hola ${safe(fullName)},</p>
      <p>${safe(clubName)} te invita a utilizar tu carnet digital SNOOP Socio.</p>
      <p><a href="${safe(link.href)}" style="display:inline-block;padding:15px 22px;background:#e5bc78;color:#101925;text-decoration:none;border-radius:8px;font-weight:700">Abrir SNOOP Socio</a></p>
      <p>Inicia sesión o crea tu cuenta con <strong>este mismo correo</strong>. Tu carnet se vinculará automáticamente después de confirmar tu dirección.</p>
      <p style="font-size:13px;color:#bdc7d5">Por seguridad, este enlace es personal, de un solo uso y válido durante 10 minutos. Si caduca, solicita otro correo a tu club.</p>
      </main></body></html>`;
    try {
      // API acceptance is not proof of inbox delivery. Keep feedback precise.
      const result = await sendProviderEmail({
        to: recipient,
        from: env.EMAIL_FROM,
        subject: `SNOOP Socio · Invitación de ${clubName}`,
        html,
        text: `Hola ${fullName}. ${clubName} te invita a SNOOP Socio. Abre este enlace personal (válido 10 minutos): ${link.href}\nRegístrate o inicia sesión con el mismo correo.\n`,
        idempotency_key: crypto.randomUUID(),
      }, { apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM, endpoint: "https://api.resend.com/emails" });
      if (!result.message_id) throw new Error("Proveedor sin confirmación");
      return { status: "accepted" as const };
    } catch {
      // Do not return the unused one-use claim to the client.
      throw new Error("El proveedor no confirmó el envío. Comprueba la configuración de correo.");
    }
  });
