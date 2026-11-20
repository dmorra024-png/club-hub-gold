import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { requireOperationalClub } from "@/lib/club-access.server";
import { EmailAPIError, sendProviderEmail, sendMailjetEmail } from "@/lib/email-provider.server";

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
    const mailjetSelected = Boolean(env.MAILJET_API_KEY || env.MAILJET_SECRET_KEY || env.MAILJET_FROM);
    if ((!mailjetSelected && (!env.EMAIL_API_KEY || !env.EMAIL_FROM)) ||
        (mailjetSelected && (!env.MAILJET_API_KEY || !env.MAILJET_SECRET_KEY || !env.MAILJET_FROM)) ||
        !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL)
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
    // Issue the ONE code via Supabase Auth Admin WITHOUT sending Supabase email.
    // It confirms the email when redeemed, then links the member card.
    // No service-role value is ever returned to the browser.
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: token, error: tokenError } = await admin.auth.admin.generateLink({
      type: "magiclink", email: recipient, options: { redirectTo: SOCIO_APP_URL },
    });
    // Supabase's Auth API may return a numeric or a string OTP. Keep the
    // actual value secret; only publish safe status/length diagnostics.
    if (tokenError) {
      const reason = String(tokenError.code ?? "auth_error").replace(/[^a-z_0-9-]/gi, "").slice(0, 40);
      const status = Number.isInteger(tokenError.status) ? tokenError.status : 0;
      throw new Error("Supabase rechazó la generación (" + status + ", " + reason + ").");
    }
    const rawCode = token?.properties?.email_otp;
    const code = rawCode === undefined || rawCode === null ? "" : String(rawCode).trim();
    if (!/^\d{6}$/.test(code))
      throw new Error("Supabase generó un OTP de longitud " + code.length +
        " en lugar de 6 cifras. Revisa la longitud OTP en Supabase Auth.");

    // An existing management account cannot be enrolled as a Socio identity.
    if (!token?.user?.id) throw new Error("No se pudo verificar la cuenta invitada.");
    const { data: staff, error: staffError } = await admin.from("user_roles")
      .select("user_id").eq("user_id", token.user.id).limit(1);
    if (staffError || (staff && staff.length))
      throw new Error("La dirección pertenece a una cuenta del personal. Usa otro correo para SNOOP Socio.");
    const { data: issued, error: issueError } = await (context.supabase as any)
      .rpc("socio_issue_member_claim_from_auth", {
        p_club_id: clubId, p_member_id: data.memberId, p_code: code,
      });
    if (issueError || issued !== true)
      throw new Error("No se pudo crear la activación de carnet. Comprueba la pertenencia del socio.");
    const html = `<html lang="es"><body style="background:#0a1425;color:#f3f6fa;padding:28px;font:16px Arial,sans-serif">
      <main style="max-width:520px;margin:auto">
      <h1 style="color:#e5bc78">SNOOP SOCIO</h1>
      <p>Hola ${safe(fullName)},</p>
      <p>${safe(clubName)} te invita a utilizar tu carnet digital SNOOP Socio.</p>
      <p><a href="${safe(link.href)}" style="display:inline-block;padding:15px 22px;background:#e5bc78;color:#101925;text-decoration:none;border-radius:8px;font-weight:700">Abrir SNOOP Socio</a></p>
      <p>En SNOOP Socio crea tu contraseña e introduce este único código para verificar el correo y activar tu carnet. No necesitas confirmar otro email:</p>
      <p style="font-size:32px;letter-spacing:7px;font-weight:700;color:#e5bc78">${code}</p>
      <p>El código caduca en 10 minutos y solo se puede utilizar una vez. Si caduca, solicita otro correo al club.</p>
      <p style="font-size:13px;color:#bdc7d5">Utiliza el correo electrónico que facilitaste al club. La identidad y la pertenencia al club se verifican antes de mostrar el carnet.</p>
      </main></body></html>`;
    const subject = `SNOOP Socio · Invitación de ${clubName}`;
    const text = `Hola ${fullName}. ${clubName} te invita a SNOOP Socio. Abre la aplicación: ${link.href}\nEn la app SNOOP Socio crea tu contraseña e introduce este código único para activar tu cuenta y carnet: ${code}. Válido 10 minutos, una sola vez.\n`;
    try {
      // API acceptance is not proof of inbox delivery. Keep feedback precise.
      const result = mailjetSelected ? await sendMailjetEmail({
        to: recipient, subject, html, text
      }, {apiKey:env.MAILJET_API_KEY,secretKey:env.MAILJET_SECRET_KEY,from:env.MAILJET_FROM}) : await sendProviderEmail({
        // Resend's unverified onboarding sender is restricted to the account inbox.
        // Pilot-only alias: the same Gmail mailbox receives the code, while the
        // Socio identity remains separate from the management identity.
        to: recipient === "medusaventi+socio@gmail.com" &&
            String(env.EMAIL_FROM).includes("onboarding@resend.dev")
          ? "medusaventi@gmail.com" : recipient,
        from: env.EMAIL_FROM,
        subject,
        html,
        text,
        idempotency_key: crypto.randomUUID(),
      }, { apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM, endpoint: "https://api.resend.com/emails" });
      if (!result.message_id) throw new Error("Proveedor sin confirmación");
      return { status: "accepted" as const };
    } catch (error) {
      // Never expose API keys, recipient addresses, OTPs, or provider response bodies.
      // Only classify the trusted HTTP status returned by our own email adapter.
      if (error instanceof EmailAPIError) {
        if (error.status === 401)
          throw new Error("Resend rechazó la clave API (401). Comprueba EMAIL_API_KEY.");
        if (error.status === 403)
          throw new Error("Resend rechazó el destinatario (403). Con onboarding@resend.dev solo puedes enviar al correo de tu cuenta Resend; para otros socios necesitas un dominio verificado.");
        if (error.status === 422)
          throw new Error("Resend rechazó el remitente o el formato del mensaje (422). Revisa EMAIL_FROM.");
        if (error.status === 429)
          throw new Error("Resend ha limitado temporalmente los envíos (429). Vuelve a intentarlo más tarde.");
        throw new Error("Resend no aceptó el envío (HTTP " + error.status + ").");
      }
      if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError"))
        throw new Error("No hay conexión con la API de Resend desde SNOOP. Revisa la conexión del Worker.");
      if (error instanceof Error && error.message === "Proveedor sin confirmación")
        throw new Error("Resend respondió sin identificador de mensaje.");
      throw new Error("Fallo interno al preparar la petición a Resend.");
    }
  });
