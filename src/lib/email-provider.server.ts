import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export class WebhookError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function verifyWebhookRequest<T = unknown>({
  req,
  secret,
  parser,
}: {
  req: Request;
  secret?: string;
  parser?: (body: string) => T;
}) {
  if (!secret || secret.length < 32)
    throw new WebhookError(
      "missing_secret",
      "EMAIL_WEBHOOK_SECRET must contain at least 32 characters",
    );
  const timestamp = req.headers.get("x-clubhub-timestamp");
  if (!timestamp) throw new WebhookError("missing_timestamp", "Missing timestamp");
  if (!/^\d{10}$/.test(timestamp))
    throw new WebhookError("invalid_timestamp", "Timestamp must be Unix seconds");
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > 300_000)
    throw new WebhookError("stale_timestamp", "Expired timestamp");
  const reader = req.body?.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_048_576) {
        await reader.cancel();
        throw new WebhookError("body_too_large", "Body exceeds limit");
      }
      chunks.push(value);
    }
  }
  const body = Buffer.concat(chunks).toString("utf8");
  const signature = req.headers.get("x-clubhub-signature") ?? "";
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  if (
    !/^sha256=[a-f0-9]{64}$/.test(signature) ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new WebhookError("invalid_signature", "Invalid signature");
  try {
    return { body, timestamp, payload: parser ? parser(body) : (JSON.parse(body) as T) };
  } catch {
    throw new WebhookError("invalid_payload", "Invalid webhook payload");
  }
}

export function parseEmailWebhookPayload(body: string) {
  return z
    .object({
      version: z.literal("1"),
      type: z.string().min(1),
      run_id: z.string().min(1),
      data: z.record(z.unknown()),
    })
    .parse(JSON.parse(body));
}

export class EmailAPIError extends Error {
  status: number;
  retryAfterSeconds: number | null;
  constructor(status: number, retryAfterSeconds: number | null) {
    super(`Email provider request failed (${status})`);
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function sendProviderEmail(
  payload: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
    idempotency_key?: string;
    unsubscribe_token?: string;
    [key: string]: unknown;
  },
  options: { apiKey: string; from?: string; endpoint?: string },
) {
  const endpoint = new URL(
    options.endpoint || process.env.EMAIL_API_URL || "https://api.resend.com/emails",
  );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error("EMAIL_API_URL must be HTTPS");
  const from = options.from || process.env.EMAIL_FROM;
  if (!from || !options.apiKey) throw new Error("Configure EMAIL_FROM and EMAIL_API_KEY");
  if (!payload.idempotency_key) throw new Error("Email idempotency key required");
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": payload.idempotency_key,
    },
    body: JSON.stringify({
      from,
      to: [payload.to],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
    }),
  });
  if (!response.ok) {
    const retry = Number(response.headers.get("retry-after"));
    throw new EmailAPIError(
      response.status,
      Number.isFinite(retry) && retry > 0 ? Math.min(retry, 3600) : null,
    );
  }
  const result = (await response.json()) as { id?: unknown };
  if (typeof result.id !== "string" || !result.id)
    throw new Error("Email provider returned no message ID");
  return { success: true, message_id: result.id };
}
