import { addCalendarDays, calendarDate, madridToday } from "./member-administration.ts";
export type Receipt = {
  id: string;
  club_id: string;
  member_id: string;
  member_number: string;
  member_name: string;
  recorded_by: string;
  operator_name: string;
  recorded_at: string;
  amount_cents: number;
  payment_method: string;
  description: string;
};
export type ReceiptSummary = {
  period: string;
  payment_method: string;
  receipts: number;
  total_cents: number;
};
export const PAYMENT_METHODS = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  other: "Otro",
} as const;
export function receiptPeriod(from: string, through: string) {
  if (!calendarDate(from) || !calendarDate(through) || through < from)
    throw new Error("Periodo no válido");
  const to = addCalendarDays(through, 1);
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > 3660)
    throw new Error("Periodo demasiado largo");
  return { from, to };
}
export function currentReceiptMonth() {
  const today = madridToday();
  return { from: today.slice(0, 7) + "-01", through: today };
}

export function madridMidnight(date: string): string {
  if (!calendarDate(date)) throw new Error("Fecha no válida");
  const utc = new Date(date + "T00:00:00Z");
  const offset = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Madrid",
    timeZoneName: "longOffset",
  })
    .formatToParts(utc)
    .find((p) => p.type === "timeZoneName")!.value;
  return new Date(date + "T00:00:00" + offset.replace("GMT", "")).toISOString();
}
