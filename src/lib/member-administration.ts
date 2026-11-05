export function calendarDate(value: string): string | null {
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const european = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!european) return null;
    match = [european[0], european[3], european[2], european[1]];
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number(year) >= 1900 && date.toISOString().slice(0, 10) === iso ? iso : null;
}

export function madridToday(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isAdult(birth: string, today = madridToday()): boolean {
  const date = calendarDate(birth);
  if (!date || !calendarDate(today) || date > today) return false;
  const age = Number(today.slice(0, 4)) - Number(date.slice(0, 4));
  return age > 18 || (age === 18 && today.slice(5) >= date.slice(5));
}

export function addCalendarDays(value: string, days: number): string {
  if (!calendarDate(value) || !Number.isInteger(days) || days < 0 || days > 36600)
    throw new Error("Duración de cuota no válida");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type MemberDictation = Record<
  | "first_name"
  | "last_name"
  | "birth_date"
  | "city"
  | "phone"
  | "email"
  | "dni_number"
  | "plan_name",
  string
>;

export function mergeUneditedValues<T extends Record<string, unknown>>(
  current: T,
  original: T,
  suggestions: Partial<T>,
): T {
  const out = { ...current };
  for (const key of Object.keys(suggestions) as Array<keyof T>) {
    const value = suggestions[key];
    if (
      Object.hasOwn(original, key) &&
      current[key] === original[key] &&
      typeof value === "string" &&
      value.trim()
    )
      out[key] = value as T[typeof key];
  }
  return out;
}

export function decodeMemberDraft(
  raw: string | null,
  now = Date.now(),
): Partial<MemberDictation> | null {
  if (!raw || raw.length > 10_000) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value.at !== "number" ||
      now - value.at > 120_000 ||
      value.at > now ||
      !value.fields ||
      typeof value.fields !== "object"
    )
      return null;
    const result: Partial<MemberDictation> = {};
    for (const key of [
      "first_name",
      "last_name",
      "birth_date",
      "city",
      "phone",
      "email",
      "dni_number",
      "plan_name",
    ] as const) {
      if (typeof value.fields[key] === "string" && value.fields[key].length <= 500)
        result[key] = value.fields[key];
    }
    return result;
  } catch {
    return null;
  }
}
export function parseAdministrativeDictation(
  transcript: string,
  plans?: string[],
): Partial<MemberDictation> {
  const raw = transcript.replace(/[“”"]/g, " ").replace(/\s+/g, " ").trim();
  const patterns: [keyof MemberDictation, RegExp][] = [
    ["first_name", /\b(?:nombre|nome)\s*:?\s*/i],
    ["last_name", /\b(?:apellidos?|cognomi|cognome)\s*:?\s*/i],
    ["birth_date", /\b(?:fecha de nacimiento|nacimiento|data di nascita|nascita)\s*:?\s*/i],
    ["dni_number", /\b(?:numero de dni|numero dni|dni|nie|documento)\s*:?\s*/i],
    ["city", /\b(?:ciudad|citt[aà]|residencia)\s*:?\s*/i],
    ["phone", /\b(?:tel[eé]fono|movil|móvil|cellulare)\s*:?\s*/i],
    ["email", /\b(?:email|correo|e-mail|mail)\s*:?\s*/i],
    ["plan_name", /\b(?:plan|cuota|quota|abono)\s*:?\s*/i],
  ];
  const hits = patterns
    .flatMap(([key, pattern]) => {
      const found = raw.match(pattern);
      return found?.index === undefined
        ? []
        : [{ key, start: found.index, value: found.index + found[0].length }];
    })
    .sort((a, b) => a.start - b.start);
  const result: Partial<MemberDictation> = {};
  for (let n = 0; n < hits.length; n++) {
    const { key, value } = hits[n];
    const text = raw
      .slice(value, hits[n + 1]?.start ?? raw.length)
      .replace(/^[\s:,-]+|[\s,.]+$/g, "");
    if (!text) continue;
    if (key === "birth_date") {
      const date = calendarDate(text);
      if (date) result[key] = date;
    } else if (key === "dni_number") result[key] = text.replace(/[^a-z0-9]/gi, "").toUpperCase();
    else if (key === "phone") result[key] = text.replace(/(?!^\+)[^0-9]/g, "");
    else if (key === "email") result[key] = text.replace(/\s+/g, "").toLowerCase();
    else result[key] = text;
  }
  if (result.plan_name && plans) {
    const normalize = (s: string) =>
      s
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
    const wanted = normalize(result.plan_name);
    const aliases: Record<string, string[]> = {
      mensile: ["mensual", "mensile"],
      annuale: ["anual", "annuale"],
      trimestrale: ["trimestral", "trimestrale"],
    };
    result.plan_name =
      plans.find(
        (name) => normalize(name) === wanted || (aliases[wanted] ?? []).includes(normalize(name)),
      ) ?? "";
  }
  return result;
}

export function normalizeAdministrativeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Accept an explicit QR code or dictated digits without truncating identifiers. */
export function extractMemberNumber(value: string): string | null {
  const tagged = value.trim().match(/^SNOOP[:\s-]*([0-9]{4,12})$/i);
  if (tagged) return tagged[1].padStart(7, "0");
  if (!/^[\d\s]+$/.test(value)) return null;
  const digits = value.replace(/\s/g, "");
  return digits.length >= 6 && digits.length <= 12 ? digits.padStart(7, "0") : null;
}

/** Parse decimal euros exactly; no negative values, exponents or silent zero fallback. */
export function parseCashCents(value: string): number | null {
  const match = value.trim().match(/^(\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2147483647 ? cents : null;
}
