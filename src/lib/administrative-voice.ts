import { voiceInteger } from "./voice-numbers.ts";
import {
  parseAdministrativeDictation,
  decodeMemberDraft,
  type MemberDictation,
} from "./member-administration.ts";
import { accessRedirect, type AccountAccess } from "./access-context.ts";
export type VoiceScope = { userId: string; clubId: string };
export type AdministrativeIntent =
  | {
      kind: "member-draft";
      fields: Partial<MemberDictation>;
      correction: boolean;
      to: "/soci/nuovo";
    }
  | { kind: "member-search"; query: string; to: "/soci/gestisci" }
  | { kind: "navigate"; to: string }
  | { kind: "unrecognized-member"; to: "/soci/nuovo" };
export function cleanVoiceCommand(value: string) {
  return value
    .replace(/^(?:(?:hola|oye|hey|ok|okay|ciao)\s*[, ]\s*)?snoop[\s,:]*/i, "")
    .trim()
    .slice(0, 12000);
}
export function administrativeIntent(raw: string, path: string): AdministrativeIntent | null {
  const text = cleanVoiceCommand(raw),
    norm = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const create =
    /\b(crea|crear|creare|registra|registrar|aggiungi|agregar|nuevo|nuovo|alta)\b.{0,45}\b(socio|miembro)\b/i.test(
      norm,
    );
  const fields = parseAdministrativeDictation(text);
  if (create || (path === "/soci/nuovo" && Object.keys(fields).length))
    return {
      kind: "member-draft",
      fields,
      correction: /^(?:no\b|correggi\b|corrige\b|cambia\b|modifica\b)/i.test(norm),
      to: "/soci/nuovo",
    };
  const explicit =
    /\b(?:busca(?:r|me)?|cerca|trova(?:mi)?|encuentra|apri|abre)\b.*\b(?:socio|miembro|ficha del socio|scheda del socio)\b/i.test(
      norm,
    );
  const contextual =
    ["/soci", "/soci/gestisci"].includes(path) &&
    !/^\s*(?:apri|abre|ir a|vai a)\s+(?:caja|cassa|ajustes|impostazioni|informes?|report|statistiche|estadisticas|collaboratori|colaboradores)/i.test(
      norm,
    );
  if (explicit || contextual) {
    let query = text
      .replace(/^(?:por favor|per favore)\s+/i, "")
      .replace(/^(?:busca(?:r|me)?|cerca|trova(?:mi)?|encuentra|apri|abre|ficha|scheda)\s+/i, "")
      .replace(/^(?:(?:la|el|il|una)\s+)?(?:ficha|scheda)\s+(?:del|de|di)\s+/i, "")
      .replace(
        /^(?:(?:a|al|el|il|la|un|una)\s+)*(?:socio|miembro)(?:\s+(?:con|di|de|chiamato|llamado|numero|n[uú]mero|nombre|nome))?\s*:?\s*/i,
        "",
      )
      .replace(/[.,;!?]+$/, "")
      .trim()
      .slice(0, 120);
    if (/\b(?:dni|nie|documento)\b/i.test(text))
      query = query.replace(/^(?:dni|nie|documento)\s*:?\s*/i, "");
    if (/\b(?:numero|número)\b/i.test(text)) {
      const words = query.split(/\s+/),
        digits = words.map(voiceInteger);
      const spelled = digits.every((n) => n !== null && n >= 0 && n < 10) ? digits.join("") : null;
      const integer = voiceInteger(query);
      const number = /^[0-9\s]+$/.test(query)
        ? query.replace(/\s/g, "")
        : (spelled ?? (integer !== null ? String(integer) : ""));
      if (/^\d{1,12}$/.test(number)) query = number.padStart(7, "0");
    }
    return {
      kind: "member-search",
      query: /^(?:soci|socios|miembros)$/i.test(query) ? "" : query,
      to: "/soci/gestisci",
    };
  }
  const nav: [RegExp, string][] = [
    [/\b(informes?|report|statistiche|estadisticas)\b/, "/ajustes/informes"],
    [/\b(cassa|caja)\b/, "/caja"],
    [/\b(colaboradores|collaboratori|dipendenti)\b/, "/ajustes/colaboradores"],
    [/\b(impostazioni|ajustes)\b/, "/ajustes"],
    [/^(?:apri|abre|vai a|ir a)?\s*(?:soci|socios|miembros)\s*[.!]?$/, "/soci/gestisci"],
  ];
  for (const [rx, to] of nav) if (rx.test(norm)) return { kind: "navigate", to };
  if (path === "/soci/nuovo") return { kind: "unrecognized-member", to: "/soci/nuovo" };
  return null;
}
export function voiceIntentAllowed(access: AccountAccess, to: string) {
  return (
    access.status === "active" &&
    !!access.clubId &&
    access.role !== "super_admin" &&
    accessRedirect(access, to) === null
  );
}
export function voiceMemberDraft(
  fields: Partial<MemberDictation>,
  scope: VoiceScope,
  at = Date.now(),
) {
  return JSON.stringify({ version: 2, fields, ...scope, at });
}
export function scopedMemberDraft(raw: string | null, scope: VoiceScope, now = Date.now()) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version === 2 && (value.userId !== scope.userId || value.clubId !== scope.clubId))
      return null;
    return decodeMemberDraft(raw, now);
  } catch {
    return null;
  }
}
export function scopedMemberSearch(
  raw: string | null,
  scope: VoiceScope,
  now = Date.now(),
): string | null {
  if (!raw || raw.length > 3000) return null;
  try {
    const v = JSON.parse(raw);
    if (
      typeof v.at !== "number" ||
      now < v.at ||
      now - v.at > 15000 ||
      typeof v.query !== "string" ||
      v.query.length > 120
    )
      return null;
    if (v.version === 2 && (v.userId !== scope.userId || v.clubId !== scope.clubId)) return null;
    return v.query.trim();
  } catch {
    return null;
  }
}
export function voiceDraftSummary(fields: Partial<MemberDictation>) {
  const labels: Record<keyof MemberDictation, string> = {
    first_name: "Nombre",
    last_name: "Apellidos",
    birth_date: "Nacimiento",
    city: "Ciudad",
    phone: "Teléfono",
    email: "Email",
    dni_number: "Documento",
    plan_name: "Cuota",
  };
  return Object.entries(fields)
    .filter(([k, v]) => k in labels && v)
    .map(([k, v]) => `${labels[k as keyof MemberDictation]}: ${v}`)
    .join(" · ");
}
