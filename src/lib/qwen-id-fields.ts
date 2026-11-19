// Strict, pure validation of Cloudflare Qwen Vision's JSON response.
// No image or document fields are logged or persisted by this module.
export const QWEN_DOCUMENT_MODEL = "@cf/qwen/qwen3.8-27b";
export type QwenIdFields = {
  first_name: string;
  last_name: string;
  birth_date: string;
  dni_number: string;
  address: string;
  city: string;
  postal_code: string;
};
const KEYS = ["first_name", "last_name", "birth_date", "dni_number", "address", "city", "postal_code"] as const;
const empty = (): QwenIdFields => ({
  first_name: "", last_name: "", birth_date: "", dni_number: "",
  address: "", city: "", postal_code: "",
});
function validISO(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d &&
    y >= 1900 && date.getTime() <= Date.now();
}
function normalizedDate(value: string) {
  if (validISO(value)) return value;
  const match = value.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/);
  if (!match) return "";
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return validISO(date) ? date : "";
}
function normalizeField(key: keyof QwenIdFields, value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || /^(?:null|undefined|unknown|not visible|no legible|no visible|n\/a)$/i.test(clean)) return "";
  if (key === "birth_date") return normalizedDate(clean);
  if (key === "dni_number") {
    const id = clean.toUpperCase().replace(/[ \-]/g, "");
    return /^[A-Z0-9]{5,18}$/.test(id) ? id : "";
  }
  if (key === "postal_code") return /^\d{5}$/.test(clean) ? clean : "";
  if (key === "first_name" || key === "last_name" || key === "city")
    return /^[\p{L}\p{M} .'-]{2,100}$/u.test(clean) ? clean : "";
  if (key === "address") return clean.length >= 4 && clean.length <= 140 ? clean : "";
  return "";
}
export function parseQwenDocumentResult(result: unknown): QwenIdFields {
  if (!result || typeof result !== "object") throw new Error("SNOOP_QWEN_RESPONSE_INVALID");
  const obj = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  let response: unknown = obj.response ?? obj.choices?.[0]?.message?.content ?? result;
  if (typeof response === "string") {
    // Qwen may surround JSON in markdown or short explanatory prose.
    const first = response.indexOf("{"), last = response.lastIndexOf("}");
    if (first < 0 || last <= first) throw new Error("SNOOP_QWEN_JSON_MISSING");
    try { response = JSON.parse(response.slice(first,last+1)); }
    catch { throw new Error("SNOOP_QWEN_JSON_INVALID"); }
  }
  if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("SNOOP_QWEN_JSON_INVALID");
  const values = response as Record<string,unknown>;
  const fields = empty();
  for (const key of KEYS) fields[key] = normalizeField(key, values[key]);
  return fields;
}
export function hasQwenDocumentFields(fields: QwenIdFields) {
  return KEYS.some(key => Boolean(fields[key]));
}
export const QWEN_DOCUMENT_PROMPT = `Lee las fotografías de un documento de identidad (DNI, NIE, pasaporte o similar). Transcribe SOLO los datos realmente visibles. Devuelve exclusivamente un objeto JSON plano con estas siete propiedades de texto: first_name, last_name, birth_date, dni_number, address, city, postal_code. Nombre y apellidos de la persona titular, fecha de nacimiento en YYYY-MM-DD, número de documento íntegro, dirección, localidad y código postal de residencia, si aparecen. Si hay varias imágenes, son las dos caras del MISMO documento. Si un dato no aparece, se ve borroso, hay varios candidatos o no estás seguro, usa "". No confundas la fecha de expedición/caducidad con nacimiento; no confundas número de soporte con número de identidad; no inventes información. Nunca añadas texto fuera del JSON.`;
