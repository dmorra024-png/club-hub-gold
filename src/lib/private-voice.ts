import { parseAdministrativeDictation } from "./member-administration.ts";
import type { Permission } from "./access-context.ts";
export function privateVoiceCommand(
  transcript: string,
  history: { role: string; content: string }[] = [],
) {
  const text = transcript
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const it = /\b(apri|cerca|nuovo|nome|cognome|soci|quote|impostazioni)\b/.test(text);
  let navigateTo: string | null = null;
  let permission: Permission | undefined;
  let memberDraft: Record<string, string> | null = null;
  if (
    (/\b(socio|soci|miembro)\b/.test(text) &&
      /\b(crea|creare|crear|nuovo|nuevo|nueva|alta|registrar)\b/.test(text)) ||
    (!/\b(cerca|buscar|busca|trova)\b/.test(text) &&
      /\b(nome|nombre|cognome|apellidos)\b/.test(text))
  ) {
    navigateTo = "/soci/nuovo";
    permission = "manage_members";
    memberDraft = {};
    for (const text of [
      ...history
        .filter((h) => h.role === "user")
        .slice(-4)
        .map((h) => h.content.slice(0, 3000)),
      transcript,
    ])
      Object.assign(memberDraft, parseAdministrativeDictation(text));
  } else if (/\b(cerca|buscar|busca|trova|socios|soci)\b/.test(text)) {
    navigateTo = "/soci/gestisci";
    permission = "manage_members";
  } else if (/\b(inventario|prodotti|productos|stock|genetiche|geneticas)\b/.test(text)) {
    navigateTo = "/productos";
    permission = "manage_products";
  } else if (/\b(informe|informes|report|statistiche|estadisticas)\b/.test(text)) {
    navigateTo = "/ajustes/informes";
    permission = "view_reports";
  } else if (/\b(quote|cuotas|incassi|ingresos)\b/.test(text)) {
    navigateTo = "/cuotas";
    permission = "use_cash";
  } else if (/\b(cassa|caja)\b/.test(text)) {
    navigateTo = "/caja";
    permission = "use_cash";
  }
  const reply = navigateTo
    ? it
      ? "Comando pronto. Controlla i dati e conferma dal modulo: nulla è stato salvato."
      : "Comando preparado. Revisa los datos y confirma en el formulario: no se ha guardado nada."
    : it
      ? "Puoi dettare un socio o aprire soci, inventario, quote e report."
      : "Puedes dictar un socio o abrir socios, inventario, cuotas e informes.";
  return { reply, navigateTo, memberDraft, permission };
}

export function privateCatalogCommand(
  transcript: string,
  categories: { id: string; name: string; unit_type: string; is_smokeable: boolean }[],
) {
  const empty = {
    action: "unknown" as "search" | "create_category" | "create_product" | "unknown",
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
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const text = normalize(transcript);
  const create = /\b(crea|crear|creare|nuovo|nuevo|nueva|nuova|registrar|aggiungi|agregar)\b/.test(
    text,
  );
  if (create && /\b(prodotto|producto|productos|prodotti)\b/.test(text)) {
    const product_name = transcript
      .replace(/^.*?\b(?:prodotto|producto|productos|prodotti)\b\s*/i, "")
      .split(
        /\s+(?:en|in|categoria|categor[ií]a|stock|costo|coste|compra|precio|prezzo|venta|vendita|indica|sativa|h[ií]brida)\b/i,
      )[0]
      .trim();
    const mentioned = categories.filter((c) => text.includes(normalize(c.name)));
    const numeric = (rx: RegExp) => Number(text.match(rx)?.[1]?.replace(",", ".") ?? 0);
    return {
      ...empty,
      action: "create_product" as const,
      product_name,
      category_id: mentioned.length === 1 ? mentioned[0].id : "",
      stock: numeric(/\bstock\s+(\d+(?:[.,]\d+)?)/),
      buy_price: numeric(/\b(?:costo|coste|compra)\s+(\d+(?:[.,]\d+)?)/),
      sell_price: numeric(/\b(?:prezzo|precio|venta|vendita)\s+(\d+(?:[.,]\d+)?)/),
      strain: /\bindica\b/.test(text)
        ? "indica"
        : /\bsativa\b/.test(text)
          ? "sativa"
          : /\bibrida|hibrida\b/.test(text)
            ? "hibrida"
            : "",
    };
  }
  if (create && /\b(categoria|categorie)\b/.test(text))
    return {
      ...empty,
      action: "create_category" as const,
      category_name: transcript
        .replace(/^.*?\b(?:categor[ií]a|categorie)\b\s*/i, "")
        .replace(/\b(?:gramos?|grammi|gr|unidades?|unita|unità|fumable|fumabile)\b/gi, "")
        .trim(),
      unit_type: /\b(gramos?|grammi|gr)\b/.test(text) ? "gr" : "unit",
      is_smokeable: /\b(fumable|fumabile)\b/.test(text),
    };
  const query = transcript
    .replace(/^(?:snoop\s+)?(?:busca(?:r)?|cerca|trova|encuentra)\s+/i, "")
    .trim();
  return { ...empty, action: "search" as const, query };
}
