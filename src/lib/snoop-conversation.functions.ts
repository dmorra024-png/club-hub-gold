import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { requireSupabaseClubAuth } from "@/integrations/supabase/auth-middleware";
import { ConversationRequest } from "./snoop-conversation";
import { parseAccountAccess } from "./access-context";
async function accessOf(context: any) {
  const { data, error } = await context.supabase.rpc("snoop_access_context");
  if (error) throw new Error("SNOOP_ACCESS_UNAVAILABLE");
  const access = parseAccountAccess(data);
  if (access.clubId !== context.clubId || access.status !== "active")
    throw new Error("SNOOP_ACCESS_UNAVAILABLE");
  return access;
}
export const conversationModeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseClubAuth])
  .handler(async ({ context }) => {
    setResponseHeader("Cache-Control", "no-store, private");
    const { conversationAvailability } = await import("./snoop-conversation.server");
    return conversationAvailability(await accessOf(context));
  });
export const interpretSnoopConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((raw: unknown) => {
    const parsed = ConversationRequest.safeParse(raw);
    if (!parsed.success) throw new Error("SNOOP_INVALID_INPUT");
    return parsed.data;
  })
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "no-store, private");
    const { interpretConversation } = await import("./snoop-conversation.server");
    const { snoopAiFailure } = await import("./voice-command-ai.server");
    try {
      return {
        proposal: await interpretConversation(data, {
          userId: context.userId,
          access: await accessOf(context),
        }),
        error: null,
      };
    } catch (e) {
      return { proposal: null, error: snoopAiFailure(e) };
    }
  });
