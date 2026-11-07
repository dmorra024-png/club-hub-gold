import { createHash } from "node:crypto";
import { sendProviderEmail } from "./email-provider.server.ts";
export async function deliverPreparedInvitation(email: string, invitationUrl: string) {
  if (!process.env.EMAIL_API_KEY || !process.env.EMAIL_FROM)
    return {
      emailAccepted: false,
      deliveryIssue: "email_provider_not_configured",
    };
  // A regenerated link is a distinct message, while retrying the same link is idempotent.
  const digest = createHash("sha256").update(invitationUrl).digest("hex");
  try {
    const receipt = await sendProviderEmail(
      {
        to: email.trim().toLowerCase(),
        from: process.env.EMAIL_FROM,
        subject: "SNOOP — Activa tu acceso",
        text: `Has sido invitado a SNOOP. Abre este enlace personal de un solo uso para elegir tu contraseña: ${invitationUrl}\nSi no esperabas este mensaje, ignóralo.`,
        html: `<p>Has sido invitado a SNOOP.</p><p><a href="${invitationUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">Elegir mi contraseña</a></p><p>Enlace personal de un solo uso.</p>`,
        idempotency_key: `snoop-invite-${digest}`,
      },
      { apiKey: process.env.EMAIL_API_KEY },
    );
    return {
      emailAccepted: true,
      deliveryIssue: null,
      messageId: receipt.message_id,
    };
  } catch {
    // Never log email addresses, tokens, links, response bodies or raw provider errors.
    return {
      emailAccepted: false,
      deliveryIssue: "email_provider_not_accepted",
    };
  }
}
