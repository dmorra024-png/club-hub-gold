import { z } from "zod";

export const DOCUMENT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const imageInput = z.object({
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
export const prompt = [
  "Read this identity document photograph. Return only one JSON object, no markdown:",
  '{"first_name":"","last_name":"","birth_date":"","dni_number":"","address":"","city":"","postal_code":""}',
  "Read visible Spanish, French, Italian or English printed or handwritten text.",
  "Surname is last_name, given names are first_name; date YYYY-MM-DD.",
  "Do not guess, do not infer, and use empty string for illegible or missing values.",
  "No explanations. This is OCR only; fields are unverified until a human checks.",
].join(" ");
export function parseCloudflareVisionAnswer(output: unknown): Fields {
  const data = output && typeof output === "object" ? output as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  } : {};
  const raw = data.choices?.[0]?.message?.content ?? data.response;
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
