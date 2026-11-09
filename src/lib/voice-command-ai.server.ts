import { safeVoiceCommand, safeCommands, validatedCommandProposal } from "./voice-command-ai.ts";
import { authorizeWorkersAi, workersAiBinding, FREE_TEXT_MODEL } from "./workers-ai.server.ts";
/** Optional hybrid fallback. Existing privacy/configuration gates remain mandatory; never executes. */
export async function proposeVoiceCommand(input: string): Promise<string | null> {
  const safe = safeVoiceCommand(input);
  if (
    !safe ||
    process.env.AI_VOICE_INTENTS_ENABLED !== "true" ||
    process.env.AI_PROVIDER !== "cloudflare"
  )
    return null;
  authorizeWorkersAi("administrative");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = (await Promise.race([
      workersAiBinding().run(FREE_TEXT_MODEL, {
        messages: [
          {
            role: "system",
            content: `Classify a navigation request. Return JSON {"command":one of ${JSON.stringify(safeCommands)}} or {"command":null}. No tools, no field values, no actions.`,
          },
          { role: "user", content: safe },
        ],
        temperature: 0,
        max_tokens: 80,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Voice interpretation timeout")), 4000);
        timer.unref?.();
      }),
    ])) as { response?: unknown };
    let response = result?.response;
    if (typeof response === "string") {
      if (response.length > 500) return null;
      try {
        response = JSON.parse(response);
      } catch {
        return null;
      }
    }
    return validatedCommandProposal(response);
  } finally {
    clearTimeout(timer);
  }
}
