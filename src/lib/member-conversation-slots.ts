import { calendarDate, isAdult, type MemberDictation } from "./member-administration.ts";
import { voiceInteger } from "./voice-numbers.ts";
export type SlotMemory = {
  field?: "last" | "first";
  pendingDate?: { day: number; month: number };
  place?: string;
};
const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\d]+/gu) ?? [];
const fields = new Map([
  ["cognome", "last"],
  ["apellido", "last"],
  ["apellidos", "last"],
  ["nome", "first"],
  ["nombre", "first"],
] as const);
const corrections = new Set(["cambia", "cambiare", "modifica", "corrige", "correggi"]);
const repairs = new Set(["scusa", "perdon", "perdona", "anzi"]);
const articles = new Set([
  "il",
  "el",
  "la",
  "in",
  "a",
  "di",
  "de",
  "del",
  "e",
  "es",
  "è",
  "sono",
  "son",
]);
/** Grammatical field requests and self repairs. Values never leave this local module. */
export function localMemberSlot(
  raw: string,
  current: Partial<MemberDictation>,
  memory: SlotMemory,
  it = false,
) {
  const tokens = [...raw.matchAll(/[\p{L}\d'’-]+/gu)].map((m) => ({
    value: m[0],
    key: words(m[0])[0] ?? "",
    at: m.index!,
  }));
  const repair = [...tokens].reverse().find((t) => repairs.has(t.key));
  const change = tokens.some((t) => corrections.has(t.key));
  const marker = tokens.find((t) => fields.has(t.key as any));
  let value = raw;
  if (repair)
    value = raw
      .slice(repair.at + repair.value.length)
      .trim()
      .replace(/^[,;\s]+/, "");
  if (change && marker) {
    const trailing = tokens.filter(
      (t) => t.at > marker.at && !articles.has(t.key) && !repairs.has(t.key),
    );
    if (!trailing.length)
      return {
        kind: "ask" as const,
        field: fields.get(marker.key as any)!,
        message:
          fields.get(marker.key as any) === "last"
            ? it
              ? "Quale cognome vuoi inserire?"
              : "¿Qué apellidos quieres poner?"
            : it
              ? "Quale nome vuoi inserire?"
              : "¿Qué nombre quieres poner?",
      };
  }
  if (memory.field && !change) {
    const value = raw.trim();
    if (
      value.length <= 120 &&
      words(value).length <= 8 &&
      /^[\p{L}'’ -]+$/u.test(value) &&
      !words(value).some((w) =>
        ["no", "guardar", "salva", "stop", "terminar", "aspetta", "espera"].includes(w),
      )
    )
      return {
        kind: "patch" as const,
        patch: {
          [memory.field === "last" ? "last_name" : "first_name"]: value,
        } as Partial<MemberDictation>,
      };
  }
  if (repair && value && !tokens.some((t) => t.at < repair.at && /\d/.test(t.value))) {
    const parts = value.split(/\s+/);
    const repaired =
      !marker && parts.length === 2 && parts.every((p) => /^[\p{L}'’-]+$/u.test(p))
        ? `Nombre ${parts[0]}, apellido ${parts[1]}`
        : value;
    return { kind: "repair" as const, text: marker ? `${marker.value} ${value}` : repaired };
  }
  if (memory.pendingDate && words(raw).length <= 4) {
    const year = voiceInteger(
      words(raw)
        .filter((w) => !articles.has(w))
        .join(" "),
    );
    if (year !== null && year >= 1900) {
      const { day, month } = memory.pendingDate;
      const date = calendarDate(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
      if (date && isAdult(date)) return { kind: "patch" as const, patch: { birth_date: date } };
    }
  }
  return null;
}
const months = [
  ["gennaio", "enero"],
  ["febbraio", "febrero"],
  ["marzo"],
  ["aprile", "abril"],
  ["maggio", "mayo"],
  ["giugno", "junio"],
  ["luglio", "julio"],
  ["agosto"],
  ["settembre", "septiembre"],
  ["ottobre", "octubre"],
  ["novembre", "noviembre"],
  ["dicembre", "diciembre"],
];
export function localBirthParts(raw: string) {
  const all = words(raw);
  const monthAt = all.findIndex((w) => months.some((m) => m.includes(w)));
  if (monthAt < 0) return null;
  let before = all.slice(0, monthAt);
  const bornAt = before.findIndex((w) =>
    ["nato", "nata", "nacido", "nacida", "nacio", "nascita", "nacimiento"].includes(w),
  );
  if (bornAt >= 0) before = before.slice(bornAt + 1);
  const day = voiceInteger(before.filter((w) => !articles.has(w)).join(" "));
  const after = all.slice(monthAt + 1);
  const placeAt = after.findIndex((w) => ["a", "en"].includes(w));
  const year = voiceInteger(
    (placeAt >= 0 ? after.slice(0, placeAt) : after).filter((w) => !articles.has(w)).join(" "),
  );
  const month = months.findIndex((m) => m.includes(all[monthAt])) + 1;
  if (
    day === null ||
    year === null ||
    !calendarDate(`2000-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
  )
    return null;
  return { day, month, year, hasPlace: placeAt >= 0 };
}
