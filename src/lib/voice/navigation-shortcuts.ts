import type { VoiceDestination } from "./destinations.ts";

/** Only complete, unambiguous navigation utterances.
 * Never infer a member identity, financial transaction or product write. */
export function voiceNavigationShortcut(text: string): VoiceDestination | null {
  const cmd = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[.!?¿¡,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:(?:quiero|quisiera|me gustaria) (?:ver|mirar) (?:los |el |la )?)?(?:ver|mostrar|muestrame|abre|abrir|apri|apre|mostra|vedere) (?:los |el |la |i |il |le )?(?:productos|prodotti)$/.test(cmd) ||
      /^(?:quiero|quisiera) ver (?:los )?(?:productos|prodotti)$/.test(cmd))
    return "products";
  if (/^(?:ver|mostrar|muestrame|abre|abrir|apri|apre|mostra|vedere) (?:el |lo |il |los )?(?:stock|inventario)$/.test(cmd) ||
      /^(?:quiero|quisiera) ver (?:el |lo )?(?:stock|inventario)$/.test(cmd))
    return "stock";
  if (/^(?:ver|abre|abrir|apri|apre|mostra|mostrar|muestrame) (?:el |lo |il )?(?:almacen|magazzino)$/.test(cmd))
    return "warehouse";
  if (/^(?:abre|abrir|apri|apre|ver|mostra|mostrar|muestrame) (?:la |el |la mia )?(?:caja|cassa)$/.test(cmd))
    return "cash";
  if (/^(?:abre|abrir|apri|apre|mostrar|muestrame) (?:la |el )?(?:ficha|scheda) (?:del |de |del nuovo )?(?:socio|soci|miembro)$/.test(cmd) ||
      /^(?:abre|abrir|apri|apre) (?:ficha|scheda)$/.test(cmd))
    return "member_create";
  if (/^(?:abre|abrir|apri|apre|ver|mostrar|muestrame) (?:los |i )?(?:socios|soci|miembros)$/.test(cmd))
    return "members";
  if (/^(?:abre|abrir|apri|apre|ver|mostrar|muestrame|crear|crea) (?:la |un |una |el )?(?:ficha de producto|producto nuevo|nuevo producto)$/.test(cmd) ||
      /^(?:crear producto|crea un producto|aggiungi prodotto|creare prodotto)$/.test(cmd))
    return "product_create";
  return null;
}
