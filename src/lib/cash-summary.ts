import { addCalendarDays, madridToday } from "./member-administration.ts";
import { madridMidnight } from "./membership-receipts.ts";
export function clubDayRange(day = madridToday()) {
  return { start: madridMidnight(day), end: madridMidnight(addCalendarDays(day, 1)) };
}
function total(rows: { id?: string; value: number }[]) {
  const seen = new Map<string, number>();
  let sum = 0;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.value) || row.value < 0)
      throw new Error("Importe contable no válido");
    if (row.id) {
      if (seen.has(row.id)) {
        if (seen.get(row.id) !== row.value) throw new Error("Operación duplicada incoherente");
        continue;
      }
      seen.set(row.id, row.value);
    }
    sum += row.value;
    if (!Number.isSafeInteger(sum)) throw new Error("Total fuera de rango");
  }
  return sum;
}
export function cashAmounts(
  orders: { id?: string; total_cents: number }[],
  fees: { id?: string; amount_cents: number }[],
) {
  const orderCents = total(orders.map((o) => ({ id: o.id, value: o.total_cents }))),
    feeCents = total(fees.map((r) => ({ id: r.id, value: r.amount_cents })));
  const sum = orderCents + feeCents;
  if (!Number.isSafeInteger(sum)) throw new Error("Total fuera de rango");
  return { orderCents, feeCents, totalCents: sum };
}
