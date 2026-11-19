/**
 * Optional EU Mistral Document AI, only for membership document OCR.
 * Disabled unless explicit provider contract, ZDR approval and API key exist.
 * Never logs input/output, and never persists the uploaded identity photo.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ImageInput = z.object({
  consent: z.literal(true),
  images: z.array(z.object({
    base64: z.string().min(100).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  })).min(1).max(2),
});
const Fields = z.object({
  first_name: z.string().max(120).default(""),
  last_name: z.string().max(160).default(""),
  birth_date: z.string().max(10).default(""),
  dni_number: z.string().max(30).default(""),
  address: z.string().max(200).default(""),
  city: z.string().max(120).default(""),
  postal_code: z.string().max(15).default(""),
});
const properties = Object.fromEntries(Object.keys(Fields.shape).map((name) => [name, {
  type: "string",
  description: "Return only data explicitly visible on the identity document; otherwise empty string. Dates YYYY-MM-DD.",
}]));
const SCHEMA = {
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};
function configured(): boolean {
  return process.env.SNOOP_MISTRAL_DOCUMENT_OCR_ENABLED === "true" &&
    process.env.SNOOP_MISTRAL_ZDR_APPROVED === "true" &&
    Boolean(process.env.MISTRAL_API_KEY);
}

export const mistralDocumentOcrStatus = createServerFn({ method: "GET" })
  .middleware([requireClubMemberAuth])
  .handler(async () => ({ enabled: configured(), externalProcessing: true, requiresConsent: true }));

export const extractMemberFieldsWithMistral = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((data: unknown) => ImageInput.parse(data))
  .handler(async ({ data }) => {
    if (!configured()) throw new Error("El OCR de Mistral no está activado para este club.");
    const key = process.env.MISTRAL_API_KEY!;
    const results: z.infer<typeof Fields>[] = [];
    for (const image of data.images) {
      const response = await fetch("https://api.eu.mistral.ai/v1/ocr", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(25_000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "mistral-ocr-latest",
          document: {
            type: "image_url",
            image_url: `data:${image.mimeType};base64,${image.base64}`,
          },
          document_annotation_format: {
            type: "json_schema",
            json_schema: { name: "snoop_member_identity", schema: SCHEMA, strict: true },
          },
          document_annotation_prompt: "Extract the visible personal data of the identity card or passport (Spanish, Italian, French, English). Never infer, guess, or make up values. Empty string when missing. No explanations.",
          include_image_base64: false,
        }),
      });
      if (!response.ok) {
        // Never include provider response body; it may contain document details.
        throw new Error(`Mistral OCR no disponible (${response.status}).`);
      }
      const json: unknown = await response.json();
      if (!json || typeof json !== "object") throw new Error("Respuesta OCR inválida.");
      const raw = (json as { document_annotation?: unknown }).document_annotation;
      const candidate = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
      const parsed = Fields.safeParse(candidate);
      if (!parsed.success) throw new Error("Los campos OCR no tienen el formato esperado.");
      results.push(parsed.data);
    }
    const merged = Fields.parse({});
    for (const fields of results) {
      for (const field of Object.keys(merged) as Array<keyof typeof merged>) {
        if (!merged[field] && fields[field]) merged[field] = fields[field].trim();
      }
    }
    if (merged.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(merged.birth_date)) merged.birth_date = "";
    return { fields: merged, source: "mistral" as const, verified: false };
  });
