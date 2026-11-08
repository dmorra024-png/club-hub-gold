import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sendProviderEmail, EmailAPIError } from "./email-provider.server.ts";
import { memberCardAttachment } from "./member-card.server.ts";
export async function processMemberMail(
  client: any,
  send: (job: any) => Promise<{ message_id: string }>,
) {
  const { data, error } = await client.rpc("snoop_claim_member_mail");
  if (error) throw new Error("Member mail queue unavailable");
  const job = data?.[0];
  if (!job) return { processed: 0 };
  let status = "accepted",
    provider: string | null = null,
    code: string | null = null;
  try {
    const result = await send(job);
    if (!result.message_id) throw new Error("No provider confirmation");
    provider = result.message_id;
  } catch (e) {
    status = e instanceof EmailAPIError ? "error" : "unknown";
    code = e instanceof EmailAPIError ? `provider_http_${e.status}` : "provider_result_unconfirmed";
  }
  const saved = await client.rpc("snoop_finish_member_mail", {
    p_id: job.id,
    p_lease: job.lease,
    p_status: status,
    p_provider: provider,
    p_error: code,
  });
  if (saved.error || saved.data !== true)
    throw new Error("Provider result not persisted; do not generate another idempotency key");
  return { processed: 1, status };
}
export function dedicatedMailClient(env: Record<string, any>) {
  if (
    env.SNOOP_RESOURCE_NAMESPACE !== "snoop-pilot" ||
    env.SUPABASE_URL !== "https://bnwanxbmprbymbutoths.supabase.co" ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  )
    throw new Error("Dedicated SNOOP mail configuration missing");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function runDedicatedMemberMail(env: Record<string, any>) {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM)
    throw new Error("EMAIL_API_KEY / EMAIL_FROM missing; no message sent");
  const client = dedicatedMailClient(env);
  return processMemberMail(client, async (job) => {
    const card = await memberCardAttachment(job.member_number);
    const safe = (v: string) =>
      v.replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
      );
    return sendProviderEmail(
      {
        to: job.recipient,
        from: env.EMAIL_FROM,
        subject: "Tu carnet de socio",
        html: `<p>${safe(job.club_name)}</p><p>Tu carnet de socio. Nº ${safe(job.member_number)}</p><img src="cid:member-card" alt="Carnet QR"/>`,
        text: `Carnet de socio. Nº ${job.member_number}`,
        attachments: [card],
        idempotency_key: job.idempotency_key,
      },
      {
        apiKey: env.EMAIL_API_KEY,
        from: env.EMAIL_FROM,
        endpoint: "https://api.resend.com/emails",
      },
    );
  });
}
export function verifyMailEvent(body: string, headers: Headers, secret: string, now = Date.now()) {
  if (body.length > 65536 || !secret?.startsWith("whsec_"))
    throw new Error("Webhook not configured");
  const id = headers.get("svix-id"),
    timestamp = headers.get("svix-timestamp"),
    sig = headers.get("svix-signature");
  if (
    !id ||
    !timestamp ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000
  )
    throw new Error("Invalid webhook timestamp");
  if (Buffer.from(secret.slice(6), "base64").length < 32)
    throw new Error("Webhook secret too short");
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest();
  if (
    !sig?.split(" ").some((s) => {
      const [v, value] = s.split(",");
      if (v !== "v1" || !value) return false;
      const candidate = Buffer.from(value, "base64");
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    })
  )
    throw new Error("Invalid webhook signature");
  const event = JSON.parse(body);
  if (
    !["email.delivered", "email.bounced"].includes(event.type) ||
    typeof event.data?.email_id !== "string"
  )
    throw new Error("Unsupported provider event");
  return { id, provider: event.data.email_id, type: event.type };
}
