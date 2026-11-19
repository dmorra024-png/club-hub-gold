/**
 * SNOOP pilot: one-purpose document OCR using the existing Cloudflare Workers AI
 * binding. No third-party API key, no logging, no persistence or training corpus.
 * The user must explicitly approve processing before images reach this function.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { workersAiBinding } from "./workers-ai.server";
import { z } from "zod";

export const DOCUMENT_MODEL = "@cf/moondream/moondream3.1-9B-A2B";
const imageInput = z.object({
  consent: z.literal(true),
  images: z.array(z.object({
    base64: z.string().min(100).max(5_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })).min(1).max(2),
});
export const documentFields = z.object({
  first_name: z.string().max(120).default(""),
  last_name: z.string().max(160).default(""),
  birth_date: z.string().max(10).default(""),
  dni_number: z.string().max(30).default(""),
  address: z.string().max(200).default(""),
  city: z.string().max(120).default(""),
  postal_code: z.string().max(15).default(""),
});
type Fields = z.infer<typeof documentFields>;
const empty = (): Fields => documentFields.parse({});
const prompt = [
  "Read this identity document photograph. Return only one JSON object, no markdown:",
  '{"first_name":"","last_name":"","birth_date":"","dni_number":"","address":"","city":"","postal_code":""}',
  "Read visible Spanish, French, Italian or English printed or handwritten text.",
  "Surname is last_name, given names are first_name; date YYYY-MM-DD.",
  "Do not guess, do not infer, and use empty string for illegible or missing values.",
  "No explanations. This is OCR only; fields are unverified until a human checks.",
].join(" ");
export function parseMoondreamAnswer(output: unknown): Fields {
  const raw = output && typeof output === "object"
    ? (output as { answer?: unknown }).answer
    : null;
  if (typeof raw !== "string" || raw.length > 6000) throw new Error("INVALID_DOCUMENT_AI_RESPONSE");
  const cleaned = raw.trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/, "");
  const candidate = cleaned.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("DOCUMENT_FIELDS_NOT_RECOGNIZED");
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { throw new Error("DOCUMENT_FIELDS_NOT_RECOGNIZED"); }
  const fields = documentFields.parse(parsed);
  if (fields.birth_date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fields.birth_date);
    const date = match && new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    if (!match || !date || date.getUTCFullYear() !== +match[1] || date.getUTCMonth() + 1 !== +match[2] || date.getUTCDate() !== +match[3])
      fields.birth_date = "";
  }
  fields.dni_number = fields.dni_number.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9<\-]{5,30}$/.test(fields.dni_number)) fields.dni_number = "";
  if (fields.postal_code && !/^\d{5}$/.test(fields.postal_code)) fields.postal_code = "";
  return fields;
}
function enabled(): boolean {
  return process.env.SNOOP_RESOURCE_NAMESPACE === "snoop-pilot" &&
    process.env.AI_PROVIDER === "cloudflare";
}
export const documentAiPilotStatus = createServerFn({ method: "GET" })
  .middleware([requireClubMemberAuth])
  .handler(async () => ({ enabled: enabled(), externalProcessing: true, requiresConsent: true }));

export const readDocumentWithCloudflare = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((data: unknown) => imageInput.parse(data))
  .handler(async ({ data }) => {
    if (!enabled()) throw new Error("DOCUMENT_AI_PILOT_DISABLED");
    // Binding is scoped to the authenticated server request, not to the browser.
    const binding = workersAiBinding();
    const merged = empty();
    for (const image of data.images) {
      let reply: unknown;
      try {
        reply = await binding.run(DOCUMENT_MODEL, {
          task: "query",
          image: `data:${image.mimeType};base64,${image.base64}`,
          question: prompt,
        });
      } catch {
        // Provider errors may contain request metadata; never log raw contents.
        throw new Error("DOCUMENT_AI_PROVIDER_UNAVAILABLE");
      }
      let fields: Fields;
      try { fields = parseMoondreamAnswer(reply); }
      catch { throw new Error("DOCUMENT_AI_COULD_NOT_READ_FIELDS"); }
      for (const field of Object.keys(merged) as (keyof Fields)[])
        if (!merged[field] && fields[field]) merged[field] = fields[field];
    }
    return { fields: merged, source: "cloudflare-moondream" as const, verified: false };
  });
