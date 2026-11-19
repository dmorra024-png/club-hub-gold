// Offline MRZ validation for DNI/NIE and passports. Never sends document content to a server.
// Extraction of MRZ characters from images is handled by a separate local OCR engine.
export type MrzMemberFields = {
  first_name: string;
  last_name: string;
  birth_date: string;
  dni_number: string;
  address: "";
  city: "";
  postal_code: "";
};
export type MrzParseResult = { fields: MrzMemberFields; format: "TD1" | "TD3"; verified: true };

const WEIGHTS = [7, 3, 1];
function charValue(c: string): number {
  if (c === "<") return 0;
  if (/^[0-9]$/.test(c)) return c.charCodeAt(0) - 48;
  if (/^[A-Z]$/.test(c)) return c.charCodeAt(0) - 55;
  return NaN;
}
export function mrzCheckDigit(data: string): string {
  const total = [...data].reduce((sum, c, i) => sum + charValue(c) * WEIGHTS[i % 3], 0);
  return Number.isFinite(total) ? String(total % 10) : "";
}
function validCheck(data: string, digit: string): boolean {
  return /^[0-9]$/.test(digit) && mrzCheckDigit(data) === digit;
}
function birthDate(digits: string): string {
  if (!/^\d{6}$/.test(digits)) return "";
  const yy = Number(digits.slice(0, 2)), month = Number(digits.slice(2, 4)), day = Number(digits.slice(4, 6));
  const now = new Date();
  let year = 2000 + yy;
  if (year > now.getUTCFullYear()) year -= 100;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function names(value: string): { first_name: string; last_name: string } | null {
  const parts = value.split("<<");
  if (parts.length < 2) return null;
  const clean = (s: string) => s.replace(/<+/g, " ").trim().replace(/\s+/g, " ");
  const last_name = clean(parts[0]), first_name = clean(parts.slice(1).join(" "));
  if (!/^[A-Z][A-Z ]*$/.test(first_name) || !/^[A-Z][A-Z ]*$/.test(last_name)) return null;
  return { first_name, last_name };
}
function parseTd1(a: string, b: string, c: string): MrzParseResult | null {
  if (a.length !== 30 || b.length !== 30 || c.length !== 30 || !/^[IA C]/.test(a)) return null;
  const number = a.slice(5, 14).replace(/<+$/g, "");
  const dob = birthDate(b.slice(0, 6)), name = names(c);
  if (!number || !dob || !name || !validCheck(a.slice(5, 14), a[14]) || !validCheck(b.slice(0, 6), b[6])) return null;
  // A standard ICAO TD1 has an overall check digit at row 2 column 30.
  if (!validCheck(a.slice(5, 30) + b.slice(0, 7) + b.slice(8, 15) + b.slice(18, 29), b[29])) return null;
  return { format: "TD1", verified: true, fields: { ...name, birth_date: dob, dni_number: number, address: "", city: "", postal_code: "" } };
}
function parseTd3(a: string, b: string): MrzParseResult | null {
  if (a.length !== 44 || b.length !== 44 || a[0] !== "P") return null;
  const number = b.slice(0, 9).replace(/<+$/g, "");
  const dob = birthDate(b.slice(13, 19)), name = names(a.slice(5));
  if (!number || !dob || !name || !validCheck(b.slice(0, 9), b[9]) || !validCheck(b.slice(13, 19), b[19])) return null;
  if (!validCheck(b.slice(0, 10) + b.slice(13, 20) + b.slice(21, 43), b[43])) return null;
  return { format: "TD3", verified: true, fields: { ...name, birth_date: dob, dni_number: number, address: "", city: "", postal_code: "" } };
}
/**
 * OCR commonly inserts spaces, Unicode angle quotes, or merges both MRZ rows.
 * Recover *candidate lines* only; original ICAO check digits still have to pass.
 */
function mrzCandidates(text: string): string[] {
  const clean = (s: string) => s.toUpperCase()
    .replace(/[«‹⟨〈﹤]/g, "<")
    .replace(/\s/g, "")
    .replace(/[^A-Z0-9<]/g, "");
  const rows = text.split(/\r?\n/).map(clean).filter(Boolean);
  const out = new Set<string>(rows);
  for (const row of rows) {
    // OCR may merge both passport lines into one line.
    if (row.length >= 88 && row.length <= 92) {
      for (let start = 0; start <= row.length - 88; start++) {
        out.add(row.slice(start, start + 44));
        out.add(row.slice(start + 44, start + 88));
      }
    }
    // OCR noise at the margins: only accept slices with validated checksums.
    for (const size of [30, 44]) {
      if (row.length > size && row.length <= size + 5) {
        for (let start = 0; start <= row.length - size; start++)
          out.add(row.slice(start, start + size));
      }
    }
    // Name line ends with non-semantic fillers, sometimes dropped by OCR.
    if (row.startsWith("P") && row.includes("<<") && row.length >= 25 && row.length < 44)
      out.add(row.padEnd(44, "<"));
  }
  return [...out];
}

/** Returns null unless all required ICAO MRZ check digits agree; never guesses data. */
export function parseMrzText(text: string): MrzParseResult | null {
  const lines = mrzCandidates(text);
  for (let i = 0; i + 2 < lines.length; i++) {
    const result = parseTd1(lines[i], lines[i + 1], lines[i + 2]);
    if (result) return result;
  }
  for (let i = 0; i + 1 < lines.length; i++) {
    const result = parseTd3(lines[i], lines[i + 1]);
    if (result) return result;
  }
  // Candidate generation can append trimmed or padded lines after the original.
  // Pair only adjacent OCR rows or their recovered variants in the same image.
  for (const a of lines) {
    if (a.length !== 44 || a[0] !== "P") continue;
    for (const b of lines) {
      if (b.length !== 44 || b === a) continue;
      const result = parseTd3(a, b);
      if (result) return result;
    }
  }
  return null;
}
