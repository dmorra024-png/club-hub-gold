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
  // Natural requests for a NEW member form. These are navigation only:
  // a complete utterance with a known meaning, no person, numbers, dictated
  // fields, negation, or final save action. The existing access policy still
  // authorizes the target, and the browser must acknowledge the real screen.
  const polite = cmd
    .replace(/^(?:(?:oye|escucha|snoop|jarvis|por favor|per favore)\s+){1,4}/, "")
    .replace(/^(?:puedes|podrias|podrias por favor|puoi|potresti)\s+/, "")
    .replace(/^(?:(?:quiero|quisiera|necesito|me gustaria|vorrei|voglio|devo)\s+(?:que\s+)?(?:me\s+)?)/, "")
    .replace(/^(?:(?:ayudame|aiutami)\s+(?:a\s+)?)/, "")
    .trim();
  const memberOpen = /^(?:(?:(?:abre|abrir|apri|apre|abrimi|aprir|mostra|mostrar|muestrame|mostrami)\s+(?:(?:el|la|lo|il|un|una)\s+)?(?:(?:formulario|registro|ficha|scheda|modulo)\s+(?:(?:de|del|para|per|di)\s+)?))|(?:(?:crear|crea|creare|registra|registrar|registrare|alta|dar\s+de\s+alta|aggiungi|anadir|hacer\s+el\s+alta)\s+(?:(?:a|un|una|el|la|il|uno|nuovo|nuevo|nueva)\s+)?))(?:nuevo\s+|nuovo\s+)?(?:socio|socia|soci|miembro)(?:\s+nuevo)?$/;
  const memberFormOpen = /^(?:abre|abrir|apri|apre|mostrar|mostra|muestrame)\s+(?:(?:el|la|il|un|una)\s+)?(?:formulario|registro|ficha|scheda|modulo)\s+(?:(?:para|de|del|per|di)\s+)?(?:(?:crear|registrar|creare|registrare|dar\s+de\s+alta|nuevo|nuovo)\s+(?:(?:a|un|una|el|la|il)\s+)?)?(?:socio|socia|soci|miembro)$/;
  const directMember = /^(?:crear|crea|creare|registrar|registra|registrare|alta|dar\s+de\s+alta|aggiungi|anadir)\s+(?:(?:un|una|el|la|il|uno|a|nuevo|nuovo)\s+)*(?:socio|socia|soci|miembro)$/;
  if (memberOpen.test(polite) || memberFormOpen.test(polite) || directMember.test(polite))
    return "member_create";
  // Ditto for the existing new-product form. Never consume a stated name,
  // category, price or stock quantity as a bare navigation shortcut.
  const directProduct = /^(?:crear|crea|creare|registrar|registra|aggiungi|anadir)\s+(?:(?:un|una|el|la|il|nuevo|nuovo)\s+)*(?:producto|prodotto)$/;
  const productFormOpen = /^(?:abre|abrir|apri|apre|mostrar|mostra)\s+(?:(?:el|la|il|un|una)\s+)?(?:formulario|ficha|scheda|modulo)\s+(?:(?:para|de|del|per|di)\s+)?(?:(?:crear|registrar|creare|nuevo|nuovo)\s+(?:(?:un|una|el|la|il)\s+)?)?(?:producto|prodotto)$/;
  if (directProduct.test(polite) || productFormOpen.test(polite))
    return "product_create";
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
  // Opening the new-member form is never a database mutation. Only a bare
  // command may use this shortcut; dictated identity details go through the
  // existing member-form voice draft and explicit human confirmation.
  if (/^(?:crear|crea|creare|registra|registrar|aggiungi|anadir|nuevo|nuovo) (?:un |una |el |la )?(?:socio|socia|miembro)$/.test(cmd))
    return "member_create";
  return null;
}
