import { privateCatalogCommand } from "./private-voice.ts";
import { voiceDecimal, voiceInteger } from "./voice-numbers.ts";
type Category = { id: string; name: string; unit_type: string; is_smokeable: boolean };
/** Parse a spoken administrative amount without performing any economic action. */
export function voiceMoney(raw: string): number | null {
  const text = raw.trim().replace(/[.!?]+$/, "");
  const cents = text.match(
    /^(.+?)\s+euros?\s+(?:con|e|y)\s+(.+?)(?:\s+c[eé]ntimos?|\s+centesimi)?$/i,
  );
  if (cents) {
    const whole = voiceInteger(cents[1]),
      fraction = voiceInteger(cents[2]);
    return whole !== null && whole >= 0 && fraction !== null && fraction >= 0 && fraction < 100
      ? whole + fraction / 100
      : null;
  }
  return voiceDecimal(text.replace(/\s+euros?$/i, ""));
}
type ProductVoiceDraft = {
  name?: string;
  category_id?: string;
  stock?: number;
  buy_price?: number;
  sell_price?: number;
  strain?: string;
};
export function productFormVoice(raw: string, categories: Category[]): ProductVoiceDraft | null {
  const text = raw.replace(/^(?:snoop[\s,:]*)/i, "").trim();
  const parsed = privateCatalogCommand(text, categories);
  const prices: { buy_price?: number; sell_price?: number } = {};
  for (const match of text.matchAll(
    /\b(precio(?:\s+de)?(?:\s+(?:venta|compra))?|prezzo(?:\s+di)?(?:\s+(?:vendita|acquisto))?|venta|compra|coste|costo|acquisto|vendita)\s*(?:(?:es|è|a)\s+)?(.+?)(?=\s*[,;]|\s+(?:stock|cantidad|quantit[aà]|categor[ií]a|precio|prezzo|venta|compra|coste|costo|acquisto|vendita)\b|$)/gi,
  )) {
    const amount = voiceMoney(match[2]);
    if (amount !== null && amount >= 0)
      prices[/compra|coste|costo|acquisto/i.test(match[1]) ? "buy_price" : "sell_price"] = amount;
  }

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
      ...prices,
    };
  if (/^(?:no\b|cambia\b|modifica\b|correggi\b|corrige\b)/i.test(text)) {
    if (Object.keys(prices).length) return prices;
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

/** Contextual patches only; never treats an entire instruction as a product name. */
export function contextualProductDictation(
  text: string,
  categories: Category[],
): ProductVoiceDraft | null {
  const labels = [
    ...text.matchAll(
      /\b(nombre|nome|categor[ií]a|stock|cantidad|quantit[aà]|precio(?: de (?:compra|venta))?|prezzo)\s*:?\s*/gi,
    ),
  ];
  if (!labels.length || labels[0].index! > 3) return null;
  const fields: ProductVoiceDraft = {};
  for (let i = 0; i < labels.length; i++) {
    const m = labels[i],
      key = m[1].toLowerCase(),
      value = text
        .slice(m.index! + m[0].length, labels[i + 1]?.index ?? text.length)
        .replace(/^[,;\s]+|[,;.!\s]+$/g, "");
    if (!value) continue;
    if (key === "nombre" || key === "nome") fields.name = value.slice(0, 120);
    else if (key.startsWith("categor")) {
      const matches = categories.filter(
        (c) => c.name.localeCompare(value, undefined, { sensitivity: "base" }) === 0,
      );
      if (matches.length === 1) fields.category_id = matches[0].id;
    } else if (["stock", "cantidad", "quantità"].includes(key)) {
      const n = voiceDecimal(value.replace(/\s*(?:gramos?|grammi|g|unidades?|unit[aà])$/i, ""));
      if (n !== null && n >= 0) fields.stock = n;
    } else {
      const n = voiceMoney(value);
      if (n !== null && n >= 0) fields[key.includes("compra") ? "buy_price" : "sell_price"] = n;
    }
  }
  return Object.keys(fields).length ? fields : null;
}
