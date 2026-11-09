import { parseAdministrativeDictation } from "./member-administration.ts";
import { premiumVoiceIntent } from "./premium-voice.ts";
/** Deterministic, typed command gate. No fuzzy names, probabilities or external model. */
export function resolveVoiceUtterance(
  raw: string,
  path: string,
): { kind: "stop" } | { kind: "command"; text: string } | { kind: "uncertain"; message: string } {
  const text = raw
    .trim()
    .replace(/^(?:hola|oye|hey)?\s*snoop[,:\s]*/i, "")
    .replace(/^[¿¡]/, "")
    .replace(/[.!?]+$/, "");
  const n = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (
    /^(?:terminar|detener escucha|stop(?: snoop)?|parar|dejar de escuchar|termina|fermati|smetti di ascoltare|ferma(?: snoop)?)$/.test(
      n,
    )
  )
    return { kind: "stop" };
  if (/\b(?:o|oppure)\s+(?:un\s+)?(?:socio|producto|caja|inventario)\b/.test(n))
    return { kind: "uncertain", message: "¿Qué sección quieres abrir?" };
  if (/^(?:guardar|confirmar|cobrar|finalizar|eliminar|anular)\b/.test(n))
    return {
      kind: "uncertain",
      message: "Revisa los datos y usa el botón del formulario para confirmar.",
    };
  const aliases: [RegExp, string][] = [
    [/^(?:caja|cassa)$/i, "Abrir caja"],
    [/^(?:socios|soci|miembros)$/i, "Buscar socio"],
    [/^(?:productos|prodotti|inventario|stock)$/i, "Ver stock"],
    [
      /^(?:quiero\s+)?(?:dar de alta|registrar|crear|nuevo|nueva|abrir el registro de)\s+(?:a\s+)?(?:un\s+)?(?:socio|miembro)\b/i,
      "Crear socio",
    ],
    [/^(?:vorrei\s+)?(?:creare|crea|registra|nuovo)\s+(?:un\s+)?socio\b/i, "Crear socio"],
    [
      /^(?:quiero\s+)?(?:dar de alta|registrar|crear|nuevo)\s+(?:un\s+)?producto\b/i,
      "Crear producto",
    ],
    [/^(?:vorrei\s+)?(?:crea|creare|nuovo)\s+(?:un\s+)?prodotto\b/i, "Crear producto"],
    [/^(?:quiero\s+)?(?:crear|nueva|agregar)\s+(?:una\s+)?categor[ií]a\b/i, "Crear categoría"],
    [/^(?:quiero\s+)?(?:consultar|mostrar|ver)\s+(?:el\s+)?inventario$/i, "Ver stock"],
    [
      /^(?:quiero\s+)?(?:consultar|mostrar|ver)\s+(?:el\s+)?(?:informe|reporte)\s+(?:de\s+)?caja(?: de hoy)?$/i,
      "Ver caja de hoy",
    ],
  ];
  const canonical = aliases.reduce((t, [rx, to]) => t.replace(rx, to), text);
  if (/^Crear socio\b/i.test(canonical)) return { kind: "command", text: canonical };
  if (
    path === "/productos" &&
    /^(?:nombre|nome|categor[ií]a|stock|cantidad|precio|prezzo)\b/i.test(canonical)
  )
    return { kind: "command", text: canonical };
  if (premiumVoiceIntent(canonical, path)) return { kind: "command", text: canonical };
  if (Object.keys(parseAdministrativeDictation(canonical)).length && path === "/soci/nuovo")
    return { kind: "command", text: canonical };
  if (
    /^(?:buscar?|buscame|cerca|trova|encuentra)\s+(?:(?:a|al|el)\s+)?(?:socio|producto|prodotto|miembro)\b/i.test(
      canonical,
    )
  )
    return { kind: "command", text: canonical };
  if (
    /^(?:no\b|cambia\b|corrige\b|correggi\b|modifica\b)/i.test(canonical) &&
    ["/soci/nuovo", "/productos"].includes(path)
  )
    return { kind: "command", text: canonical };
  if (
    /^(?:abrir|abre|apri|ver|mostrar|ir a|vai a)\s+(?:la\s+)?(?:caja|cassa|socios|informes|report|ajustes|productos|inicio|home)$/i.test(
      canonical,
    )
  )
    return { kind: "command", text: canonical };
  return {
    kind: "uncertain",
    message: "No lo tengo claro. Di la sección o el campo que quieres completar.",
  };
}
