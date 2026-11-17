import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const Input = z.object({
  transcript: z.string().min(1),
  categories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        unit_type: z.string(),
        is_smokeable: z.boolean(),
      }),
    )
    .default([]),
});

export type ParsedCommand = {
  action: "search" | "create_category" | "create_product" | "unknown";
  query: string;
  category_name: string;
  unit_type: string;
  is_smokeable: boolean;
  product_name: string;
  category_id: string;
  stock: number;
  buy_price: number;
  sell_price: number;
  strain: string;
};

const EMPTY: ParsedCommand = {
  action: "unknown",
  query: "",
  category_name: "",
  unit_type: "",
  is_smokeable: false,
  product_name: "",
  category_id: "",
  stock: 0,
  buy_price: 0,
  sell_price: 0,
  strain: "",
};

function extractJSON(raw: string): unknown {
  let s = raw
    .replace(/^```json\s*/im, "")
    .replace(/^```\s*/im, "")
    .replace(/```\s*$/im, "")
    .trim();
  if (!s.startsWith("{")) {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a !== -1 && b > a) s = s.slice(a, b + 1);
    else throw new Error("No JSON object found");
  }
  return JSON.parse(s);
}

export const parseProductCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<ParsedCommand> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const catsList = data.categories
      .map(
        (c) =>
          `${c.id} = ${c.name} (${c.unit_type}${c.is_smokeable ? ", fumable" : ""})`,
      )
      .join("\n");

    const system = `Eres un parser de comandos de voz (español/italiano) para una página de productos de un club cannábico.
Devuelve SOLO un objeto JSON (sin markdown, sin texto extra) con EXACTAMENTE estas claves:
{
  "action": "search" | "create_category" | "create_product" | "unknown",
  "query": string,
  "category_name": string,
  "unit_type": "gr" | "unit" | "",
  "is_smokeable": boolean,
  "product_name": string,
  "category_id": string,
  "stock": number,
  "buy_price": number,
  "sell_price": number,
  "strain": "indica" | "sativa" | "hibrida" | ""
}
Reglas:
- "buscar X" / "busca X" / "encuentra X" / sólo el nombre → action="search", query=texto.
- "crear/nueva categoría X" → action="create_category". unit_type "gr" si gramos, "unit" si unidades, "" si no. is_smokeable=true si menciona fumable o suena a flor/hash/extracción.
- "crear producto X en categoría Y stock N compra A venta B (indica/sativa/híbrida)" → action="create_product". category_id DEBE ser el id exacto de la lista o "".
- Desconocido → action="unknown".
- Rellena TODAS las claves (vacío "" / 0 / false cuando no aplique).

Categorías disponibles:
${catsList || "(ninguna)"}`;

    const { text } = await generateText({
      model,
      system,
      prompt: `Transcript: "${data.transcript}"\n\nDevuelve sólo el JSON.`,
    });

    try {
      const parsed = extractJSON(text) as Partial<ParsedCommand>;
      return { ...EMPTY, ...parsed } as ParsedCommand;
    } catch {
      return EMPTY;
    }
  });
