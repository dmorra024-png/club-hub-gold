import { SnoopSketch, sketchSupports } from "./snoop-orchestrator.ts";
import { safeVoiceCommand, safeCommands, validatedCommandProposal } from "./voice-command-ai.ts";
import { workersAiBinding, FREE_TEXT_MODEL } from "./workers-ai.server.ts";
export const SNOOP_GLM_MODEL = "@cf/zai-org/glm-4.7-flash";
const limits = new Map<string, { start: number; count: number }>();
/** Per-isolate abuse bound, not an account-wide quota ledger. Workers Free must enforce its hard daily cap. */
export function reserveSnoopRequest(scope: string, now = Date.now()): boolean {
  for (const [key, value] of limits) if (now - value.start >= 3600000) limits.delete(key);
  const value = limits.get(scope);
  if (value && value.count >= 30) return false;
  if (!value && limits.size >= 1000) return false;
  limits.set(scope, { start: value?.start ?? now, count: (value?.count ?? 0) + 1 });
  return true;
}
export async function proposeVoiceCommand(
  input: string,
  scope = "isolated-test",
): Promise<string | null> {
  const safe = safeVoiceCommand(input);
  return safe ? runSnoopInterpretation(safe, scope) : null;
}
export async function proposeSnoopSketch(input: unknown, scope: string) {
  const parsed = SnoopSketch.safeParse(input);
  if (
    !parsed.success ||
    !parsed.data.symbols.length ||
    parsed.data.symbols.some((s) => ["commit", "negate", "stop"].includes(s))
  )
    return null;
  const result = await runSnoopInterpretation(JSON.stringify(parsed.data), scope);
  return result && sketchSupports(result, parsed.data) ? result : null;
}
async function runSnoopInterpretation(safe: string, scope: string): Promise<string | null> {
  if (
    process.env.AI_VOICE_INTENTS_ENABLED !== "true" ||
    process.env.AI_PROVIDER !== "cloudflare" ||
    process.env.SNOOP_AI_FREE_TIER_CONFIRMED !== "true"
  )
    return null;
  // Dedicated non-personal purpose: never enables administrative text/OCR or personal-data processing.
  // This explicit server opt-in is independent of AI_PERSONAL_DATA_PROCESSING_ENABLED;
  // the closed input gate above is mandatory before this purpose can reach the binding.
  if (
    process.env.AI_EXTERNAL_PROCESSING_ENABLED !== "true" ||
    process.env.AI_VOICE_PROCESSING_ENABLED !== "true"
  )
    throw new Error("Interpretación SNOOP no autorizada");
  const model = process.env.SNOOP_AI_ASSISTANT_MODEL || SNOOP_GLM_MODEL;
  if (![SNOOP_GLM_MODEL, FREE_TEXT_MODEL].includes(model))
    throw new Error("Modelo SNOOP no autorizado");
  if (!reserveSnoopRequest(scope)) throw new Error("Límite de solicitudes SNOOP alcanzado");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = (await Promise.race([
      workersAiBinding().run(model, {
        messages: [
          {
            role: "system",
            content: `Classify reversible navigation only. Input may be a closed semantic sketch: symbols are concepts, screen is current view, references are anonymous local values you must never resolve. Reject commit, negate, stop or conflicting domains. Return JSON {"command":one of ${JSON.stringify(safeCommands)}} or {"command":null} when uncertain. No tools, field values, names, explanations or actions.`,
          },
          { role: "user", content: safe },
        ],
        temperature: 0,
        stream: false,
        store: false,
        ...(model === SNOOP_GLM_MODEL
          ? {
              max_completion_tokens: 160,
              chat_template_kwargs: { enable_thinking: false, clear_thinking: true },
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "snoop_navigation",
                  strict: true,
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["command"],
                    properties: {
                      command: {
                        anyOf: [{ type: "string", enum: [...safeCommands] }, { type: "null" }],
                      },
                    },
                  },
                },
              },
            }
          : { max_tokens: 160 }),
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("SNOOP tarda demasiado. Usa el comando local.")),
          5000,
        );
        timer.unref?.();
      }),
    ])) as {
      response?: unknown;
      choices?: { finish_reason?: string; message?: { content?: unknown; tool_calls?: unknown } }[];
    };
    const choice = result?.choices?.[0];
    if (
      choice &&
      (result.choices?.length !== 1 ||
        choice.finish_reason !== "stop" ||
        choice.message?.tool_calls)
    )
      return null;
    let response = choice ? choice.message?.content : result?.response;
    if (typeof response === "string") {
      if (response.length > 1000) return null;
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

/** Safe UI codes only; never serialize provider bodies, identifiers or credentials. */
export function snoopAiFailure(error: unknown): "quota" | "limited" | "timeout" | "unavailable" {
  const e = error as { status?: number; statusCode?: number; message?: string };
  if (e?.status === 429 || e?.statusCode === 429)
    return /quota|neuron|allocation/i.test(e.message ?? "") ? "quota" : "limited";
  if (/Límite de solicitudes/.test(e?.message ?? "")) return "limited";
  if (/tarda demasiado/.test(e?.message ?? "")) return "timeout";
  return "unavailable";
}
