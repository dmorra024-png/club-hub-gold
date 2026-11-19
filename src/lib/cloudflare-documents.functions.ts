/**
 * SNOOP pilot: one-purpose document OCR using the existing Cloudflare Workers AI
 * binding. No third-party API key, no logging, no persistence or training corpus.
 * The user must explicitly approve processing before images reach this function.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { workersAiBinding } from "./workers-ai.server";
import { z } from "zod";
import { DOCUMENT_MODEL, documentFields, parseMoondreamAnswer } from "./cloudflare-document-parser";

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
    const merged = documentFields.parse({});
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
      let fields: z.infer<typeof documentFields>;
      try { fields = parseMoondreamAnswer(reply); }
      catch { throw new Error("DOCUMENT_AI_COULD_NOT_READ_FIELDS"); }
      for (const field of Object.keys(merged) as (keyof Fields)[])
        if (!merged[field] && fields[field]) merged[field] = fields[field];
    }
    return { fields: merged, source: "cloudflare-moondream" as const, verified: false };
  });
