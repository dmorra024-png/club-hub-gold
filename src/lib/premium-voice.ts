import { cleanVoiceCommand } from "./administrative-voice.ts";
export type PremiumVoiceIntent = {
  to: string;
  search?: Record<string, boolean>;
  productQuery?: string;
  cashReport?: boolean;
  productCreate?: boolean;
  requiresMember?: boolean;
};
/** Read/navigation only. No mutation, quantities, payment or order submission. */
export function premiumVoiceIntent(raw: string, path = "/"): PremiumVoiceIntent | null {
  const text = cleanVoiceCommand(raw),
    n = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (/\b(ultimas? actividades?|historial|actividad reciente|storico|ultime attivita)\b/.test(n))
    return { to: "/actividades" };
  if (
    /^(?:(?:abre|abrir|quiero|ver|apri|mostrar)\s+)*(?:la\s+)?(?:caja|cassa)(?:\s+(?:de|del|di))?\s+(?:hoy|oggi|dia)\b/.test(
      n,
    ) ||
    /\b(?:ver|mostrar|consulta)\s+(?:la\s+)?caja\s+de\s+hoy\b/.test(n)
  )
    return { to: "/caja", cashReport: true };
  if (/^(?:quiero\s+)?(?:abre|abrir|apri|ver|mostrar)\s+(?:la\s+)?(?:caja|cassa)\s*[.!]?$/i.test(n))
    return { to: "/caja" };

  if (
    /^(?:escanear|escanea|leer|leggi|abrir|abre)\s+(?:el\s+)?(?:socio|qr|codigo qr|lector qr|scanner)\s*[.!]?$/i.test(
      n,
    )
  )
    return { to: "/soci/gestisci", search: { scanner: true } };
  if (/^(?:quiero\s+)?(?:crear?|nuevo|a[nñ]adir|agregar|registrar)\s+(?:un\s+)?producto\b/i.test(n))
    return { to: "/productos", productCreate: true };
  if (
    /^(?:hacer|nuevo|crear|abrir)\s+(?:un\s+)?(?:pedido|orden)\s*[.!]?$/i.test(n) &&
    !/^\/soci\/[a-f0-9-]{36}(?:\/pedido)?$/.test(path)
  )
    return { to: "/soci/gestisci", requiresMember: true };
  const product = text.match(
    /^(?:por favor\s+)?(?:buscar?|buscame|encuentra|encontrar|cerca|trova)\s+(?:el\s+)?(?:producto|prodotto)\s+(.+)$/i,
  );
  if (product)
    return {
      to: "/productos",
      productQuery: product[1]
        .replace(/[.!?]+$/, "")
        .trim()
        .slice(0, 120),
    };
  if (
    /^(?:(?:ver|abre|abrir|mostrar|consulta|apri)\s+)*(?:el\s+)?(?:stock|inventario)\s*[.!]?$/i.test(
      n,
    )
  )
    return { to: "/productos" };
  return null;
}
