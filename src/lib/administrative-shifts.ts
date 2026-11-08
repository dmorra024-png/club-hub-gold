import { calendarDate } from "./member-administration.ts";
export const CLUB_SHIFTS = [
  { id: 1, name: "Mañana", start: "11:00", end: "17:00" },
  { id: 2, name: "Tarde", start: "17:00", end: "23:00" },
] as const;
/** Only immutable server receipt timestamps; never the device's current clock. */
export function receiptShift(serverTimestamp: string) {
  const at = new Date(serverTimestamp);
  if (!Number.isFinite(at.getTime()) || !/[Zz]|[+-]\d\d:\d\d$/.test(serverTimestamp))
    throw new Error("Fecha del servidor no válida");
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  const day = `${value("year")}-${value("month")}-${value("day")}`,
    minute = Number(value("hour")) * 60 + Number(value("minute"));
  return {
    day,
    shift: minute >= 660 && minute < 1020 ? 1 : minute >= 1020 && minute < 1380 ? 2 : null,
  };
}
export type ShiftReceipt = {
  id: string;
  recorded_at: string;
  recorded_by: string;
  amount_cents: number;
  shift?: number | null;
  shift_day?: string;
};
export function reconcileAdministrativeShifts(rows: ShiftReceipt[], day: string) {
  if (!calendarDate(day)) throw new Error("Fecha no válida");
  const seen = new Map<string, string>(),
    totals = { morning: 0, afternoon: 0, outside: 0, day: 0 },
    operators: Record<string, number> = {};
  for (const r of rows) {
    const signature = JSON.stringify([
      r.recorded_at,
      r.recorded_by,
      r.amount_cents,
      r.shift,
      r.shift_day,
    ]);
    if (seen.has(r.id)) {
      if (seen.get(r.id) !== signature) throw new Error("Recibo duplicado con datos distintos");
      continue;
    }
    seen.set(r.id, signature);
    if (!r.id || !r.recorded_by || !Number.isSafeInteger(r.amount_cents) || r.amount_cents < 0)
      throw new Error("Movimiento no válido");
    const computed = receiptShift(r.recorded_at),
      date = r.shift_day ?? computed.day,
      shift = r.shift === undefined ? computed.shift : r.shift;
    if (date !== day) continue;
    if (![1, 2, null].includes(shift)) throw new Error("Turno no válido");
    const key = shift === 1 ? "morning" : shift === 2 ? "afternoon" : "outside";
    totals[key] += r.amount_cents;
    totals.day += r.amount_cents;
    operators[r.recorded_by] = (operators[r.recorded_by] ?? 0) + r.amount_cents;
    if (!Number.isSafeInteger(totals.day)) throw new Error("Total fuera de rango");
  }
  if (totals.day !== totals.morning + totals.afternoon + totals.outside)
    throw new Error("No se pudo reconciliar el día");
  return { totals, operators };
}
