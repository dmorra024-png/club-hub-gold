import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

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
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);

    // --- 1) Descripción (texto) ---
    let description = "";
    try {
      const ctx = data.is_smokeable
        ? `Es una variedad cannábica${data.strain ? ` (${data.strain})` : ""}. Busca en bancos de semillas y registros de genéticas conocidos (Royal Queen, Dinafem, Barney's Farm, Sensi Seeds, Humboldt, Leafly, SeedFinder, etc.).`
        : data.category_name
          ? `Categoría: ${data.category_name}.`
          : "";
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: `Eres un experto en productos de club cannábico. Devuelve SOLO una descripción breve (máx 2 frases, ~220 caracteres) en español, útil para un colaborador de barra: genética/linaje, efectos típicos, perfil de sabor o uso. Nada de markdown, emojis ni titulares.`,
        prompt: `Producto: "${data.name}". ${ctx}\nDescripción breve:`,
      });
      description = (text || "").trim().replace(/^["']|["']$/g, "").slice(0, 400);
    } catch (e) {
      console.error("enrich description failed", e);
    }

    // --- 2) Imagen (Gemini Nano Banana) ---
    let image_url = "";
    try {
      const subject = data.is_smokeable
        ? `un cogollo (flor) de cannabis variedad "${data.name}"${data.strain ? `, tipo ${data.strain}` : ""}, fotografía macro profesional sobre fondo oscuro, tricomas visibles, estilo catálogo de seedbank`
        : `producto "${data.name}"${data.category_name ? ` (${data.category_name})` : ""}, fotografía de producto sobre fondo neutro`;

      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image",
          messages: [{ role: "user", content: `Genera una imagen cuadrada de ${subject}. Sin texto, sin marcas de agua.` }],
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
        console.error("image gen http", res.status, await res.text().catch(() => ""));
      }
    } catch (e) {
      console.error("enrich image failed", e);
    }

    return { description, image_url };
  });
