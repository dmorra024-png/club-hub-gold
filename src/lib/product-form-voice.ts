import { privateCatalogCommand } from "./private-voice.ts";
import { voiceDecimal } from "./voice-numbers.ts";
type Category = { id: string; name: string; unit_type: string; is_smokeable: boolean };
export function productFormVoice(raw: string, categories: Category[]) {
  const text = raw.replace(/^(?:snoop[\s,:]*)/i, "").trim();
  const parsed = privateCatalogCommand(text, categories);
  const quantity = text.match(
    /\b(?:stock|cantidad|quantit[aà])\s*(?:(?:es|è|e|a)\s+)?(.+?)(?=\s*(?:[,;]|$))/i,
  );
  const number = quantity
    ? voiceDecimal(quantity[1].replace(/\s*(?:gramos?|grammi|gr|g|unidades?|unit[aà])\s*$/i, ""))
    : null;
  if (parsed.action === "create_product")
    return {
      name: parsed.product_name.split(/\s+(?:cantidad|quantit[aà])\b/i)[0].replace(/[\s,;]+$/, ""),
      category_id: parsed.category_id,
      stock: number ?? parsed.stock,
      buy_price: parsed.buy_price,
      sell_price: parsed.sell_price,
      strain: parsed.strain,
    };
  if (/^(?:no\b|cambia\b|modifica\b|correggi\b|corrige\b)/i.test(text)) {
    if (quantity && number !== null) return { stock: number };
    const named = text.match(/\b(?:nombre|nome)\s*(?:(?:es|è|e|a)\s+)?(.+)$/i);
    if (named) return { name: named[1].trim().replace(/[.!]+$/, "") };
    const namedCategory = text.match(/\b(?:categor[ií]a)\s*(?:(?:es|è|e|a)\s+)?(.+)$/i);
    if (namedCategory) {
      const matches = categories.filter(
        (c) =>
          c.name.localeCompare(namedCategory[1].trim(), undefined, { sensitivity: "base" }) === 0,
      );
      if (matches.length === 1) return { category_id: matches[0].id };
    }
  }
  return null;
}
