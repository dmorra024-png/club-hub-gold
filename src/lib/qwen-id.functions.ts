import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireClubMemberAuth } from "@/integrations/supabase/auth-middleware";
import { workersAiBinding } from "./workers-ai.server";
import {
  QWEN_DOCUMENT_MODEL, QWEN_DOCUMENT_PROMPT,
  parseQwenDocumentResult, hasQwenDocumentFields
} from "./qwen-id-fields";

// Isolated, explicitly consented document endpoint. Existing JARVIS
// restrictions and model selection remain unchanged.
const ImageSchema = z.object({
  base64: z.string().min(100).max(4_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"])
});
const Input = z.object({ consent: z.literal(true), images: z.array(ImageSchema).min(1).max(2) });
function verifyImage(image: z.infer<typeof ImageSchema>) {
  const bytes = Buffer.from(image.base64, "base64");
  if (bytes.length < 100 || bytes.length > 3_000_000 || bytes.toString("base64") !== image.base64)
    throw new Error("Imagen inválida o demasiado grande");
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (!(image.mimeType === "image/jpeg" && jpeg ||
        image.mimeType === "image/png" && png ||
        image.mimeType === "image/webp" && webp))
    throw new Error("Formato de documento inválido");
}
export const scanMemberIdentityWithQwen = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    // Dedicated privacy gate, independent of JARVIS.
    if (process.env.SNOOP_RESOURCE_NAMESPACE !== "snoop-pilot")
      throw new Error("Escáner IA no autorizado en este entorno");
    if (process.env.AI_PROVIDER !== "cloudflare")
      throw new Error("Escáner IA disponible solo con Cloudflare");
    for (const image of data.images) verifyImage(image);
    const content = [
      { type: "text", text: QWEN_DOCUMENT_PROMPT },
      ...data.images.map(image => ({
        type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
      }))
    ];
    // No images, OCR results, personal data or provider bodies are logged.
    // The Worker AI binding sends only the submitted photos to Cloudflare.
    let answer: unknown;
    try {
      answer = await workersAiBinding().run(QWEN_DOCUMENT_MODEL, {
        messages: [{ role: "user", content }],
        max_completion_tokens: 512,
        reasoning_effort: "low",
        temperature: 0,
        stream: false,
        store: false
      });
    } catch {
      throw new Error("El escáner IA no está disponible. No se ha guardado ningún dato.");
    }
    let fields: ReturnType<typeof parseQwenDocumentResult>;
    try { fields = parseQwenDocumentResult(answer); }
    catch { throw new Error("La IA no devolvió datos válidos. Prueba otra foto."); }
    if (!hasQwenDocumentFields(fields))
      throw new Error("No se identificaron datos fiables. Prueba otra foto.");
    return { fields };
  });
