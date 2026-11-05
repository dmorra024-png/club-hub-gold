import {
  authorizeWorkersAi,
  workersAiBinding,
  workersAiFetch,
  transcribeWorkersAudio,
  FREE_TEXT_MODEL,
} from "./workers-ai.server.ts";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function aiConfiguration(
  purpose: "administrative" | "documents" | "catalog" = "administrative",
) {
  if (process.env.AI_EXTERNAL_PROCESSING_ENABLED !== "true") {
    throw new Error(
      "AI externa desactivada. Configura AI_EXTERNAL_PROCESSING_ENABLED y revisa el tratamiento de datos.",
    );
  }
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error("Falta AI_API_KEY para el proveedor de IA independiente");
  const base = new URL(process.env.AI_BASE_URL || "https://api.openai.com/v1");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && local)) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error("AI_BASE_URL debe ser HTTPS (HTTP permitido solo en localhost)");
  }
  if (!local && process.env.AI_AUTHORIZED_ORIGIN !== base.origin)
    throw new Error(
      "Falta autorizar explícitamente el origen del proveedor con AI_AUTHORIZED_ORIGIN",
    );
  if (purpose === "documents" && process.env.AI_DOCUMENT_PROCESSING_ENABLED !== "true")
    throw new Error("El envío de documentos al proveedor no está autorizado");
  return {
    apiKey,
    baseURL: base.href.replace(/\/$/, ""),
    model: process.env.AI_MODEL || "gpt-4o-mini",
  };
}

export const providerFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    // Never forward API credentials to a redirect destination.
    redirect: "error",
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
  });

export function administrativeModel(
  purpose: "administrative" | "documents" | "catalog" = "administrative",
) {
  if (process.env.AI_PROVIDER === "cloudflare") {
    authorizeWorkersAi(purpose);
    return createOpenAICompatible({
      name: "snoop-workers-ai",
      apiKey: "binding-not-a-secret",
      baseURL: "https://snoop-workers-ai.invalid/v1",
      fetch: workersAiFetch(workersAiBinding()),
      supportsStructuredOutputs: true,
    })(FREE_TEXT_MODEL);
  }
  const config = aiConfiguration(purpose);
  const provider = createOpenAICompatible({
    name: "administrative-ai",
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fetch: providerFetch,
    supportsStructuredOutputs: process.env.AI_STRUCTURED_OUTPUTS !== "false",
  });
  return provider(config.model);
}

export async function transcribeAdministrativeAudio(input: {
  audioBase64: string;
  mimeType: string;
  language?: "it" | "es";
}) {
  if (process.env.AI_PROVIDER === "cloudflare") authorizeWorkersAi();
  const config = process.env.AI_PROVIDER === "cloudflare" ? null : aiConfiguration();
  if (!/^(audio\/(webm|mp4|mpeg|wav|ogg|x-wav))(;codecs=[a-z0-9,-]+)?$/i.test(input.mimeType))
    throw new Error("Formato de audio no compatible");
  if (
    !input.audioBase64 ||
    input.audioBase64.length > 12_000_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64)
  )
    throw new Error("Audio inválido o demasiado grande");
  const bytes = Buffer.from(input.audioBase64, "base64");
  if (bytes.toString("base64") !== input.audioBase64) throw new Error("Audio base64 inválido");
  if (!config)
    return transcribeWorkersAudio(workersAiBinding(), input.audioBase64, input.language || "es");
  const mime = input.mimeType.split(";")[0];
  const ext = mime.split("/")[1].replace("mpeg", "mp3").replace("x-wav", "wav");
  const body = new FormData();
  body.set("model", process.env.AI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  body.set("language", input.language || "es");
  body.set("file", new Blob([bytes], { type: mime }), `recording.${ext}`);
  const response = await providerFetch(`${config.baseURL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body,
  });
  if (!response.ok)
    throw new Error(`Proveedor de transcripción no disponible (${response.status})`);
  const result = (await response.json()) as { text?: unknown };
  if (typeof result.text !== "string" || !result.text.trim())
    throw new Error("No se ha entendido el audio");
  return { text: result.text.trim() };
}

export async function administrativeSpeech(text: string) {
  if (process.env.AI_PROVIDER === "cloudflare")
    throw new Error("Voz sintética no verificada en el perfil gratuito. Usa la interfaz manual.");
  const config = aiConfiguration();
  if (!text.trim() || text.length > 800) throw new Error("Texto de voz inválido");
  const response = await providerFetch(`${config.baseURL}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_TTS_MODEL || "gpt-4o-mini-tts",
      input: text,
      voice: process.env.AI_TTS_VOICE || "ash",
      response_format: "mp3",
    }),
  });
  if (!response.ok) throw new Error(`Proveedor de voz no disponible (${response.status})`);
  if (!response.headers.get("content-type")?.startsWith("audio/"))
    throw new Error("El proveedor no ha devuelto audio");
  const audio = await response.arrayBuffer();
  if (!audio.byteLength || audio.byteLength > 10_000_000)
    throw new Error("Respuesta de audio inválida");
  return {
    audioBase64: Buffer.from(audio).toString("base64"),
    mimeType: response.headers.get("content-type")!.split(";")[0],
  };
}

export function administrativeAiStatus() {
  let available = false;
  try {
    if (process.env.AI_PROVIDER === "cloudflare") {
      authorizeWorkersAi();
      workersAiBinding();
    } else aiConfiguration();
    available = true;
  } catch {
    /* No credentials or details in public status. */
  }
  return {
    available,
    documents:
      available &&
      process.env.AI_PROVIDER !== "cloudflare" &&
      process.env.AI_DOCUMENT_PROCESSING_ENABLED === "true",
    browserSpeech: available && process.env.AI_BROWSER_SPEECH_ENABLED === "true",
  };
}
