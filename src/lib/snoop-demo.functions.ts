import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { requireSupabaseClubAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ConversationRequest } from "./snoop-conversation";
import { parseAccountAccess } from "./access-context";
import { interpretConversation, conversationAvailability } from "./snoop-conversation.server";

const DemoTurn = ConversationRequest.refine((v) => v.mode === "demo" && v.synthetic === true, {
  message: "SNOOP_DEMO_SYNTHETIC_ONLY",
});
const DemoTranscription = z.object({
  audioBase64: z.string().min(1).max(12_000_000),
  mimeType: z.string().min(1).max(80),
  language: z.enum(["it", "es"]),
  synthetic: z.literal(true),
  consent: z.literal(true),
}).strict();

async function demoAccess(context: any) {
  const { data, error } = await context.supabase.rpc("snoop_access_context");
  if (error) throw new Error("SNOOP_DEMO_ACCESS_DENIED");
  const access = parseAccountAccess(data);
  if (access.clubId !== context.clubId || !conversationAvailability(access).demo)
    throw new Error("SNOOP_DEMO_NOT_AVAILABLE");
  return access;
}
export const demoStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseClubAuth])
  .handler(async ({ context }) => {
    setResponseHeader("Cache-Control", "no-store, private");
    return { available: conversationAvailability(await demoAccess(context)).demo };
  });

export const interpretSnoopDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((raw: unknown) => DemoTurn.parse(raw))
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "no-store, private");
    const access = await demoAccess(context);
    if (data.owner.userId !== context.userId || data.owner.clubId !== context.clubId)
      throw new Error("SNOOP_DEMO_NOT_AUTHORIZED");
    // In DEMO there are no catalog, member or cash reads and no write tools.
    // All form drafts are temporary, held only in the calling React component.
    return interpretConversation(data, { userId: context.userId, access });
  });

export const transcribeSnoopDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((raw: unknown) => DemoTranscription.parse(raw))
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "no-store, private");
    await demoAccess(context);
    const { transcribeAdministrativeAudio } = await import("./administrative-ai.server");
    // Never read or append any real product/member names to the voice prompt.
    return transcribeAdministrativeAudio({
      audioBase64: data.audioBase64,
      mimeType: data.mimeType,
      language: data.language,
      catalogNames: [],
    });
  });
