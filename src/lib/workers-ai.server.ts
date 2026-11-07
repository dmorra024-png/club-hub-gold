// Workers AI binding only; no REST API key, remote fallback or paid model routing.
export interface SnoopAiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}
export const FREE_TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
export const FREE_AUDIO_MODEL = "@cf/openai/whisper-large-v3-turbo";
export function workersAiBinding(): SnoopAiBinding {
  const bindings = (
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
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: { text?: unknown };
  try {
    result = (await Promise.race([
      binding.run(FREE_AUDIO_MODEL, {
        audio,
        language,
        task: "transcribe",
        vad_filter: true,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workers AI transcription timeout")), 25000);
        timer.unref?.();
      }),
    ])) as { text?: unknown };
  } catch {
    throw new Error("Workers AI: transcripción no disponible. Usa la entrada manual.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (typeof result?.text !== "string" || !result.text.trim() || result.text.length > 12000)
    throw new Error("Workers AI no ha devuelto una transcripción");
  return { text: result.text.trim() };
}
