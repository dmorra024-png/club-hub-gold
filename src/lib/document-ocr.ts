// Client-side document OCR. No document image is sent to a third-party AI endpoint.
// OCR model assets are downloaded separately; images remain in the browser worker.
export type DocumentFields = {
  first_name: string; last_name: string; birth_date: string; dni_number: string;
  address: string; city: string; postal_code: string;
};
const empty = (): DocumentFields => ({
  first_name: "", last_name: "", birth_date: "", dni_number: "",
  address: "", city: "", postal_code: "",
});
const upper = (s: string) => s.toUpperCase().replace(/[^A-Z0-9<]/g, "");
const checkDigit = (s: string) => {
  const weights = [7, 3, 1];
  let sum = 0;
  [...s].forEach((c, i) => {
    const n = c === "<" ? 0 : /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 55;
    sum += n * weights[i % 3];
  });
  return String(sum % 10);
};
const validCheck = (s: string, check: string) => /[0-9]/.test(check) && checkDigit(s) === check;
const normalizeName = (s: string) => s.replace(/<+/g, " ").trim().toLowerCase()
  .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
function birthDate(yyMMdd: string) {
  if (!/^\d{6}$/.test(yyMMdd)) return "";
  const yy = Number(yyMMdd.slice(0, 2)), mm = Number(yyMMdd.slice(2, 4)), dd = Number(yyMMdd.slice(4, 6));
  const today = new Date();
  let year = 2000 + yy;
  if (year > today.getFullYear()) year -= 100;
  const candidate = new Date(Date.UTC(year, mm - 1, dd));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== mm - 1 || candidate.getUTCDate() !== dd) return "";
  if (year < today.getFullYear() - 120) return "";
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
function parsedNames(s: string) {
  const [surname = "", given = ""] = s.split("<<");
  return { first_name: normalizeName(given), last_name: normalizeName(surname) };
}
// ICAO 9303 TD1 (DNI) / TD3 (passport) machine readable zones. Accept checked values only.
export function parseMRZ(text: string): Partial<DocumentFields> {
  const lines = text.split(/\r?\n/).map(upper).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i], b = lines[i + 1], c = lines[i + 2];
    if (/^[A-Z<I][A-Z<][A-Z<]{3}/.test(a) && a.length === 30 && b?.length === 30 && c?.length === 30) {
      const out: Partial<DocumentFields> = parsedNames(c);
      const id = a.slice(5, 14), bd = b.slice(0, 6);
      if (validCheck(id, a[14]) && id.replace(/</g, "")) out.dni_number = id.replace(/</g, "");
      if (validCheck(bd, b[6])) out.birth_date = birthDate(bd);
      return out;
    }
    if (/^P[A-Z<][A-Z<]{3}/.test(a) && a.length === 44 && b?.length === 44) {
      const out: Partial<DocumentFields> = parsedNames(a.slice(5));
      const id = b.slice(0, 9), bd = b.slice(13, 19);
      if (validCheck(id, b[9])) out.dni_number = id.replace(/</g, "");
      if (validCheck(bd, b[19])) out.birth_date = birthDate(bd);
      return out;
    }
  }
  return {};
}
function parseVisibleText(text: string): Partial<DocumentFields> {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const result: Partial<DocumentFields> = {};
  const joined = lines.join("\n");
  const dni = joined.match(/\b(?:DNI|NIE|N[ÚU]M(?:ERO)?\.?\s*(?:DE\s*)?(?:DOCUMENTO|IDENTIDAD))\s*[:#-]?\s*([XYZ]?\d{7,8}[A-Z])\b/i);
  if (dni) result.dni_number = dni[1].toUpperCase();
  const dateIndex = lines.findIndex(s => /(?:FECHA\s*(?:DE\s*)?NACIMIENTO|NACIMIENTO|DATE\s*OF\s*BIRTH|BIRTH|F\.\s*NAC\.?)/i.test(s));
  const birthContext = dateIndex < 0 ? "" : lines.slice(dateIndex, dateIndex + 3).join(" ");
  const dateMatch = birthContext.match(/(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})/);
  if (dateMatch) {
    const [_, dd, mm, yyyy] = dateMatch;
    const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
    if (d.getUTCFullYear() === +yyyy && d.getUTCMonth() === +mm - 1 && d.getUTCDate() === +dd)
      result.birth_date = `${yyyy}-${mm}-${dd}`;
  }
  const pick = (label: RegExp) => {
    const match = lines.findIndex(l => label.test(l));
    if (match < 0) return "";
    const inline = lines[match].replace(label, "").replace(/^\s*[:\-]\s*/, "").trim();
    return inline || lines[match + 1] || "";
  };
  const first = pick(/^(?:(?:NOMBRE|NOMBRES|NAME|GIVEN\s*NAMES?)\b|NOM\b)\s*/i);
  const last = pick(/^(?:APELLIDOS?|SURNAME|SURNAMES?|APELLIDO\s*1\s*\/\s*2)\b\s*/i);
  const plausibleName = (s: string) => /^[\p{L} .'-]{2,80}$/u.test(s) &&
    !/\b(?:NACIMIENTO|FECHA|SEXO|NACIONALIDAD|DOCUMENTO|EXPEDICI[ÓO]N|DOMICILIO)\b/i.test(s);
  if (plausibleName(first)) result.first_name = first;
  if (plausibleName(last)) result.last_name = last;
  const postal = joined.match(/\b\d{5}\b/);
  if (postal && /(?:DOMICILIO|DIRECCI[ÓO]N|ADDRESS|RESIDENCIA|LOCALIDAD|MUNICIPIO|CP|C\.P\.)/i.test(joined))
    result.postal_code = postal[0];
  const address = pick(/^(?:DOMICILIO|DIRECCI[ÓO]N|ADDRESS|ADRESSE)\b\s*/i);
  if (address && /^.{5,100}$/.test(address) && /[\p{L}]/u.test(address)
      && !/^(?:NOMBRE|APELLIDOS?|NACIMIENTO|LOCALIDAD|MUNICIPIO|PROVINCIA|NATIONALITY)/i.test(address)) {
    result.address = address;
  }
  const city = pick(/^(?:LOCALIDAD|MUNICIPIO|CIUDAD|CITY|POBLACI[ÓO]N)\b\s*/i);
  if (city && /^[\p{L} .'-]{2,65}$/u.test(city)) result.city = city;
  // Never infer an address/city from unrelated fields or an unlabeled number.
  return result;
}
export async function scanDocumentLocally(images: Blob[]): Promise<{ fields: DocumentFields; rawText: string }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["spa", "eng"]);
  try {
    const texts: string[] = [];
    for (const img of images) {
      const url = URL.createObjectURL(img);
      try {
        const { data } = await worker.recognize(url);
        texts.push(data.text);
      } finally { URL.revokeObjectURL(url); }
    }
    const rawText = texts.join("\n");
    const visible = parseVisibleText(rawText);
    const mrz = parseMRZ(rawText);
    const fields = { ...empty(), ...visible, ...Object.fromEntries(Object.entries(mrz).filter(([, v]) => !!v)) };
    return { fields, rawText };
  } finally { await worker.terminate(); }
}
