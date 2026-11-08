/** Strict IT/ES integer/decimal interpretation for administrative fields, never executes actions. */
const units: Record<string, number> = {
  zero: 0,
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  dos: 2,
  tre: 3,
  tres: 3,
  quattro: 4,
  cuatro: 4,
  cinque: 5,
  cinco: 5,
  sei: 6,
  seis: 6,
  sette: 7,
  siete: 7,
  otto: 8,
  ocho: 8,
  nove: 9,
  nueve: 9,
  dieci: 10,
  diez: 10,
  undici: 11,
  once: 11,
  dodici: 12,
  doce: 12,
  tredici: 13,
  trece: 13,
  quattordici: 14,
  catorce: 14,
  quindici: 15,
  quince: 15,
  sedici: 16,
  dieciseis: 16,
  diciassette: 17,
  diecisiete: 17,
  diciotto: 18,
  dieciocho: 18,
  diciannove: 19,
  diecinueve: 19,
  venti: 20,
  veinte: 20,
  trenta: 30,
  treinta: 30,
  quaranta: 40,
  cuarenta: 40,
  cinquanta: 50,
  cincuenta: 50,
  sessanta: 60,
  sesenta: 60,
  settanta: 70,
  setenta: 70,
  ottanta: 80,
  ochenta: 80,
  novanta: 90,
  noventa: 90,
  cento: 100,
  cien: 100,
  ciento: 100,
};
const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
function tokenNumber(word: string): number | null {
  if (/^\d{1,4}$/.test(word)) return Number(word);
  if (word in units) return units[word];
  const spanish = /^veinti(.+)$/.exec(word);
  if (spanish && units[spanish[1]] > 0 && units[spanish[1]] < 10) return 20 + units[spanish[1]];
  for (const [ten, value] of Object.entries(units).filter(
    ([, v]) => v >= 20 && v < 100 && v % 10 === 0,
  )) {
    for (const stem of [ten, ten.slice(0, -1)])
      if (word.startsWith(stem)) {
        const rest = word.slice(stem.length);
        if (rest in units && units[rest] > 0 && units[rest] < 10) return value + units[rest];
      }
  }
  const italian = /^(.+)cento(.*)$/.exec(word);
  if (italian && units[italian[1]] > 0 && units[italian[1]] < 10) {
    const tail = italian[2] ? tokenNumber(italian[2]) : 0;
    return tail !== null && tail < 100 ? units[italian[1]] * 100 + tail : null;
  }
  const hundreds: Record<string, number> = {
    doscientos: 200,
    trescientos: 300,
    cuatrocientos: 400,
    quinientos: 500,
    seiscientos: 600,
    setecientos: 700,
    ochocientos: 800,
    novecientos: 900,
  };
  if (word in hundreds) return hundreds[word];
  if (word.startsWith("mille") && word.length > 5) {
    const tail = tokenNumber(word.slice(5));
    return tail !== null && tail < 1000 ? 1000 + tail : null;
  }
  const thou = /^(.+?)(?:mila|mil)(.*)$/.exec(word);
  if (thou) {
    const n = tokenNumber(thou[1]),
      tail = thou[2] ? tokenNumber(thou[2]) : 0;
    return n !== null && n < 10 && tail !== null && tail < 1000 ? n * 1000 + tail : null;
  }
  return null;
}
export function voiceInteger(raw: string): number | null {
  const s = norm(raw);
  if (!s) return null;
  const words = s.split(/\s+/).filter((w) => !["e", "y"].includes(w));
  let total = 0,
    group = 0,
    last = Infinity;
  for (const word of words) {
    if (word === "mil" || word === "mille") {
      if (group > 9) return null;
      total += (group || 1) * 1000;
      group = 0;
      last = Infinity;
      continue;
    }
    const n = tokenNumber(word);
    if (n === null) return null;
    // Reject arbitrary digit concatenation and additive guesses such as 'dos tres'.
    if (n >= last || (last < 20 && n > 0)) return null;
    group += n;
    last = n;
  }
  const result = total + group;
  return result >= 0 && result <= 9999 ? result : null;
}
export function voiceDecimal(raw: string): number | null {
  const s = norm(raw);
  if (/^\d+(?:[.,]\d{1,2})?$/.test(s)) {
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) && n <= 9999 ? n : null;
  }
  const parts = s.split(/\s+(?:virgola|coma|punto)\s+/);
  if (parts.length === 1) return voiceInteger(s);
  if (parts.length !== 2) return null;
  const whole = voiceInteger(parts[0]);
  let decimal = parts[1].trim();
  if (!/^\d{1,2}$/.test(decimal)) {
    const tokens = decimal.split(/\s+/);
    if (tokens.every((t) => t in units && units[t] < 10))
      decimal = tokens.map((t) => units[t]).join("");
    else {
      const n = voiceInteger(decimal);
      if (n === null || n > 99) return null;
      decimal = String(n);
    }
  }
  return whole !== null && /^\d{1,2}$/.test(decimal)
    ? whole + Number(decimal) / 10 ** decimal.length
    : null;
}
