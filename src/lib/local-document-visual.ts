/**
 * Conservative local VIZ (visual inspection zone) parser for printed Spanish
 * labels. Never guesses unlabeled names or document numbers. Fields are review
 * suggestions, not verified identity, unlike a checksum-validated ICAO MRZ.
 */
export type VisualDocumentFields = Partial<{
  first_name: string;
  last_name: string;
  birth_date: string;
  dni_number: string;
  address: string;
  city: string;
  postal_code: string;
}>;

const labelValue = (line: string, labels: RegExp): string | undefined => {
  const match = line.match(labels);
  if (!match || match.index !== 0) return;
  return line.slice(match[0].length).replace(/^\s*[:.\-–|]\s*/, "").trim();
};
const squash = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const neat = (s: string) => s.replace(/^[\s:;|._-]+|[\s:;|._-]+$/g, "").replace(/\s+/g, " ").trim();
const safeName = (s: string) => /^[\p{L}][\p{L}'’\- ]{1,79}$/u.test(s) && !/\b(?:REPUBLICA|ESPANA|PASAPORTE|DOCUMENTO|IDENTIDAD|NACIMIENTO|DOMICILIO|NACIONALIDAD)\b/i.test(s);
const DATE_RE = /(?:^|\s)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?=\s|$)/;
function dateOfBirth(text: string): string | undefined {
  const m = neat(text).match(DATE_RE);
  if (!m) return;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > new Date().getUTCFullYear() || check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1 || check.getUTCFullYear() !== y) return;
  return `${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}
export function parsePrintedDocumentText(text: string): VisualDocumentFields {
  const lines = text.split(/\r?\n/).map(neat).filter(Boolean).slice(0, 90);
  const results: VisualDocumentFields = {};
  // Only recognize explicit labels at the start of lines; no positional
  // assumptions on passports from different countries or document versions.
  for (let i=0;i<lines.length;i++) {
    const line=lines[i], norm=squash(line);
    const get = (re: RegExp): string | undefined => {
      const same=labelValue(norm,re);
      if (same && same.length>1) return neat(line.slice(line.length-same.length));
      if (same !== undefined && i+1<lines.length) return neat(lines[i+1]);
    };
    const first=get(/^(?:NOMBRE(?:S)?|GIVEN NAMES?|FORENAMES?|PRENOM(?:S)?)\s*(?:[:.\-–|]|$)/);
    if (!results.first_name && first && safeName(first)) results.first_name=first;
    const last=get(/^(?:APELLIDOS?|SURNAME(?:S)?|FAMILY NAME|NOM)\s*(?:[:.\-–|]|$)/);
    if (!results.last_name && last && safeName(last)) results.last_name=last;
    const birth=get(/^(?:FECHA DE NACIMIENTO|F\. NACIMIENTO|DATE OF BIRTH|BIRTH DATE|NACIMIENTO)\s*(?:[:.\-–|]|$)/);
    const parsed=birth ? dateOfBirth(birth) : undefined;
    if (!results.birth_date && parsed) results.birth_date=parsed;
    const doc=get(/^(?:NUM(?:ERO)?(?: DE)? (?:DOCUMENTO|PASAPORTE|DNI)|PASSPORT NO\.?|DOCUMENT NO\.?|DNI(?:\s*\/\s*NIE)?|NIE)\s*(?:[:.\-–|]|$)/);
    if (!results.dni_number && doc) {
      const value=doc.replace(/\s+/g,"").toUpperCase();
      if (/^[A-Z0-9]{6,15}$/.test(value) && /\d/.test(value)) results.dni_number=value;
    }
    const address=get(/^(?:DOMICILIO|DIRECCION|ADDRESS)\s*(?:[:.\-–|]|$)/);
    if (!results.address && address && address.length>=5 && address.length<120) results.address=address;
    const town=get(/^(?:MUNICIPIO|LOCALIDAD|CITY|CIUDAD)\s*(?:[:.\-–|]|$)/);
    if (!results.city && town && safeName(town)) results.city=town;
    const code=get(/^(?:CODIGO POSTAL|POSTAL CODE|C\.P\.)\s*(?:[:.\-–|]|$)/);
    if (!results.postal_code && code && /^\d{5}$/.test(code)) results.postal_code=code;
  }
  return results;
}
