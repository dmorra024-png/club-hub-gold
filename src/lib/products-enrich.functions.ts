import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText } from "ai";
import { administrativeModel, aiConfiguration, providerFetch } from "./administrative-ai.server";

const Input = z.object({
  name: z.string().min(1),
  strain: z.string().optional().default(""),
  is_smokeable: z.boolean().optional().default(false),
  category_name: z.string().optional().default(""),
});

export type EnrichResult = {
  description: string;
  image_url: string; // data:image/...;base64,... or empty
};

export const enrichProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<EnrichResult> => {
    const config = process.env.AI_PROVIDER === "cloudflare" ? null : aiConfiguration("catalog");

    // --- 1) Descripción (texto) ---
    let description = "";
    try {
      const ctx = data.is_smokeable
        ? `Es una variedad cannábica${data.strain ? ` (${data.strain})` : ""}. No afirmes haber consultado fuentes externas; describe solo información general y señala lo no verificado.`
        : data.category_name
          ? `Categoría: ${data.category_name}.`
          : "";
      const { text } = await generateText({
        model: administrativeModel("catalog"),
        system: `Eres un experto en productos de club cannábico. Devuelve SOLO una descripción breve (máx 2 frases, ~220 caracteres) en español, útil para un colaborador de barra: datos informativos generales de catálogo, sin recomendaciones de consumo ni efectos médicos. Nada de markdown, emojis ni titulares.`,
        prompt: `Producto: "${data.name}". ${ctx}\nDescripción breve:`,
      });
      description = (text || "")
        .trim()
        .replace(/^["']|["']$/g, "")
        .slice(0, 400);
    } catch (e) {
      console.error("enrich description failed", e);
    }

    // --- 2) Imagen (Gemini Nano Banana) ---
    let image_url = "";
    try {
      const subject = data.is_smokeable
        ? `un cogollo (flor) de cannabis variedad "${data.name}"${data.strain ? `, tipo ${data.strain}` : ""}, fotografía macro profesional sobre fondo oscuro, tricomas visibles, estilo catálogo de seedbank`
        : `producto "${data.name}"${data.category_name ? ` (${data.category_name})` : ""}, fotografía de producto sobre fondo neutro`;

      if (!config || !process.env.AI_IMAGE_MODEL) return { description, image_url };
      const res = await providerFetch(`${config.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.AI_IMAGE_MODEL,
          messages: [
            {
              role: "user",
              content: `Genera una imagen cuadrada de ${subject}. Sin texto, sin marcas de agua.`,
            },
          ],
          modalities: ["image", "text"],
        }),
      });
      if (res.ok) {
        const json: any = await res.json();
        const msg = json?.choices?.[0]?.message;
        const url =
          msg?.images?.[0]?.image_url?.url ||
          msg?.images?.[0]?.url ||
          (Array.isArray(msg?.content)
            ? msg.content.find((p: any) => p?.image_url?.url)?.image_url?.url
            : null);
        if (typeof url === "string" && url.startsWith("data:")) image_url = url;
      } else {
        console.error("image gen http", res.status);
      }
    } catch (e) {
      console.error("enrich image failed", e);
    }

    return { description, image_url };
  });
