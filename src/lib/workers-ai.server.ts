// Workers AI binding only; no REST API key, remote fallback or paid model routing.
import { AsyncLocalStorage } from "node:async_hooks";
export interface SnoopAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}
export const FREE_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const FREE_AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
/** Empty/null call lists mean no tools. Malformed lists and any legacy call are rejected. */
export function hasAiToolInvocations(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const value = message as { tool_calls?: unknown; function_call?: unknown };
  return (
    value.function_call != null ||
    (value.tool_calls != null &&
      (!Array.isArray(value.tool_calls) || value.tool_calls.length !== 0))
  );
}

type SnoopRuntimeAi = { SNOOP_AI: SnoopAiBinding; SNOOP_RESOURCE_NAMESPACE: "snoop-pilot" };
const requestAi = new AsyncLocalStorage<SnoopRuntimeAi | null>();

/** Bind the Cloudflare Worker AI resource to THIS request, never a shared global. */
export function withSnoopWorkersAi<T>(runtimeEnv: unknown, action: () => T): T {
  if (typeof runtimeEnv !== "object" || runtimeEnv === null) return requestAi.run(null, action);
  const runtime = runtimeEnv as Record<string, unknown>;
  const ai = runtime.SNOOP_AI as Partial<SnoopAiBinding> | undefined;
  if (runtime.SNOOP_RESOURCE_NAMESPACE !== "snoop-pilot" || typeof ai?.run !== "function")
    return requestAi.run(null, action);
  return requestAi.run(
    { SNOOP_RESOURCE_NAMESPACE: "snoop-pilot", SNOOP_AI: ai as SnoopAiBinding },
    action,
  );
}
/** Nitro forwards the Cloudflare context on Request, not TanStack fetch's second argument. */
export function snoopRequestRuntime(request: Request, env: unknown): unknown {
  return (
    env ??
    (request as Request & { runtime?: { cloudflare?: { env?: unknown } } }).runtime?.cloudflare?.env
  );
}
export function workersAiBinding(): SnoopAiBinding {
  const scoped = requestAi.getStore();
  const bindings =
    scoped !== undefined
      ? scoped
      : (
          globalThis as typeof globalThis & {
            __env__?: {
              SNOOP_AI?: SnoopAiBinding;
              SNOOP_RESOURCE_NAMESPACE?: string;
            };
          }
        ).__env__;
  if (bindings?.SNOOP_RESOURCE_NAMESPACE !== "snoop-pilot" || !bindings.SNOOP_AI?.run)
    throw new Error("Falta el binding independiente SNOOP_AI de SNOOP");
  return bindings.SNOOP_AI;
}
export function authorizeWorkersAi(
  purpose: "administrative" | "documents" | "catalog" | "transcription" = "administrative",
) {
  if (process.env.AI_EXTERNAL_PROCESSING_ENABLED !== "true")
    throw new Error("IA externa desactivada");
  if (purpose === "transcription") {
    if (process.env.AI_VOICE_PROCESSING_ENABLED !== "true")
      throw new Error("Transcripción de voz no autorizada");
  } else if (
    process.env.AI_VOICE_ONLY === "true" &&
    !(purpose === "catalog" && process.env.AI_CATALOG_PROCESSING_ENABLED === "true")
  ) {
    throw new Error(
      "Perfil de voz: no se envían campos, historial ni documentos a modelos de texto",
    );
  }
  if (
    purpose !== "catalog" &&
    purpose !== "transcription" &&
    process.env.AI_PERSONAL_DATA_PROCESSING_ENABLED !== "true"
  )
    throw new Error("Tratamiento de datos personales no autorizado");
  if (purpose === "documents")
    throw new Error("OCR de documentos no habilitado en el perfil gratuito");
  if (process.env.AI_CF_TEXT_MODEL && process.env.AI_CF_TEXT_MODEL !== FREE_TEXT_MODEL)
    throw new Error("Modelo fuera del perfil gratuito verificado");
  if (process.env.AI_CF_TRANSCRIBE_MODEL && process.env.AI_CF_TRANSCRIBE_MODEL !== FREE_AUDIO_MODEL)
    throw new Error("Modelo fuera del perfil gratuito verificado");
}
/** Bridge the existing AI SDK to the binding's documented messages/JSON/tools schema. */
export function workersAiFetch(binding: SnoopAiBinding): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.model !== FREE_TEXT_MODEL || body.stream)
      throw new Error("Modelo o streaming no compatible con el perfil gratuito");
    const input: Record<string, unknown> = {
      messages: body.messages,
      max_tokens: Math.min(body.max_tokens ?? body.max_completion_tokens ?? 700, 1000),
      temperature: 0.1,
    };
    if (body.tools) input.tools = body.tools;
    if (body.response_format)
      input.response_format =
        body.response_format.type === "json_schema"
          ? {
              type: "json_schema",
              json_schema:
                body.response_format.json_schema?.schema ?? body.response_format.json_schema,
            }
          : body.response_format;
    // Bound the wait, without issuing retries or switching to a billable provider.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: {
      response?: string | Record<string, unknown>;
      tool_calls?: { name: string; arguments: unknown }[];
      usage?: Record<string, number>;
    };
    try {
      result = (await Promise.race([
        binding.run(FREE_TEXT_MODEL, input),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Workers AI timeout")), 25000);
          timer.unref?.();
        }),
      ])) as typeof result;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const responseText =
      typeof result?.response === "string"
        ? result.response
        : result?.response && typeof result.response === "object" && !Array.isArray(result.response)
          ? JSON.stringify(result.response)
          : undefined;
    if (responseText === undefined && !result?.tool_calls?.length)
      throw new Error("Respuesta Workers AI no válida");
    const calls = result.tool_calls?.map((call, index) => ({
      id: `snoop-tool-${index}`,
      type: "function",
      function: {
        name: call.name,
        arguments:
          typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
      },
    }));
    return Response.json({
      id: "snoop-workers-ai",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: FREE_TEXT_MODEL,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: responseText ?? "",
            ...(calls?.length ? { tool_calls: calls } : {}),
          },
          finish_reason: calls?.length ? "tool_calls" : "stop",
        },
      ],
      usage: result.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  };
}
export async function transcribeWorkersAudio(
  binding: SnoopAiBinding,
  audio: string,
  language: "it" | "es",
  catalogNames: readonly string[] = [],
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: { text?: unknown };
  // Never include members, transactions, notes or other club information.
  // A small, unique, validated catalog glossary is used only when separately authorized.
  const permittedNames = [
    ...new Set(
      catalogNames
        .filter((n): n is string => typeof n === "string")
        .map((n) => n.trim())
        .filter((n) => n.length >= 2 && n.length <= 60 && !/[\r\n<>]|\\[rn]/i.test(n)),
    ),
  ].slice(0, 35);
  const catalogGlossary = permittedNames.length
    ? ` Nombres de productos del catálogo: ${permittedNames.join(", ").slice(0, 1200)}.`
    : "";
  try {
    result = (await Promise.race([
      binding.run(FREE_AUDIO_MODEL, {
        audio,
        language,
        task: "transcribe",
        vad_filter: true,
        condition_on_previous_text: false,
        initial_prompt:
          language === "it"
            ? "SNOOP. Soci, nome, cognome, data di nascita, città, telefono, prodotti, categoria, inventario, cassa. Nomi dei prodotti: Amnesia Haze, Haze, Lemon Haze, Super Silver Haze, Purple Haze, OG Kush, Critical, White Widow, Gelato. Trascrivi i nomi propri letteralmente." +
              catalogGlossary
            : "SNOOP. Socios, nombre, apellidos, fecha de nacimiento, ciudad, teléfono, productos, categoría, inventario, caja. Nombres de productos: Amnesia Haze, Haze, Lemon Haze, Super Silver Haze, Purple Haze, OG Kush, Critical, White Widow, Gelato. Transcribe los nombres propios literalmente." +
              catalogGlossary,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workers AI transcription timeout")), 25000);
        timer.unref?.();
      }),
    ])) as { text?: unknown };
  } catch (error) {
    // Preserve bounded failure categories, never the provider body or dictation.
    const failure = error as { status?: number; statusCode?: number; message?: string };
    const message = typeof failure?.message === "string" ? failure.message : "";
    if (/timeout|tarda demasiado/i.test(message)) throw new Error("SNOOP_WHISPER_TIMEOUT");
    if (/quota|neuron|allocation|cuota/i.test(message)) throw new Error("SNOOP_WHISPER_QUOTA");
    if (failure?.status === 429 || failure?.statusCode === 429)
      throw new Error("SNOOP_WHISPER_LIMITED");
    throw new Error("Workers AI: transcripción no disponible. Usa la entrada manual.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (typeof result?.text !== "string" || !result.text.trim() || result.text.length > 12000)
    throw new Error("Workers AI no ha devuelto una transcripción");
  return { text: result.text.trim() };
}
