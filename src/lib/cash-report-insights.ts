import type { CashMovement, CashSession } from "./cash-sessions";

const madridHour = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23",
});
const knownMethods = ["cash", "card", "transfer", "wallet"] as const;
type PaymentMethod = (typeof knownMethods)[number] | "unknown";

export function cashReportInsights(
  movements: CashMovement[],
  sessions: CashSession[],
  from: string,
  until: string,
) {
  const startMs = Date.parse(from);
  const endMs = Date.parse(until);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs)
    throw new Error("Periodo de caja inválido");

  // The server already scopes movements to club and user. Never reclassify
  // unknown payment methods as cash or count wallet orders twice as receipts.
  const day = new Map<string, CashMovement>();
  for (const movement of movements) {
    const ms = Date.parse(movement.at);
    if (ms < startMs || ms >= endMs || !Number.isFinite(ms)) continue;
    const key = `${movement.source}:${movement.id}`;
    if (!day.has(key)) day.set(key, movement);
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    cents: 0,
    orders: 0,
  }));
  const methods: Record<PaymentMethod, number> = {
    cash: 0, card: 0, transfer: 0, wallet: 0, unknown: 0,
  };
  const contributors = new Map<string, { id: string; cents: number; orders: number }>();
  let orderCount = 0;
  let orderCents = 0;
  let unknownOrders = 0;
  for (const movement of day.values()) {
    const hour = Number(madridHour.format(new Date(movement.at)));
    const method: PaymentMethod = knownMethods.includes(movement.payment_method as (typeof knownMethods)[number])
      ? movement.payment_method as (typeof knownMethods)[number]
      : "unknown";
    methods[method] += movement.cents;
    // Wallet orders were paid earlier from wallet balances; a wallet topup is
    // the actual cash receipt, so exclude wallet-paid orders from receipt bars.
    const receiptCents = movement.source === "order" && method === "wallet" ? 0 : movement.cents;
    hourly[hour].cents += receiptCents;
    if (movement.source === "order") {
      orderCount++;
      orderCents += movement.cents;
      hourly[hour].orders++;
      if (method === "unknown") unknownOrders++;
    }
    if (movement.by && receiptCents > 0) {
      const entry = contributors.get(movement.by) ?? { id: movement.by, cents: 0, orders: 0 };
      entry.cents += receiptCents;
      if (movement.source === "order") entry.orders++;
      contributors.set(movement.by, entry);
    }
  }
  const activeSessions = sessions.filter(s => s.status === "open" && s.closed_at === null).length;
  const closedWithoutCount = sessions.filter(s => s.status === "closed" && s.closing_cash_cents === null).length;
  const peak = hourly.reduce<(typeof hourly)[number] | null>(
    (best, item) => item.cents > 0 && (!best || item.cents > best.cents) ? item : best, null,
  );
  return {
    hourly,
    peak,
    methods,
    orders: orderCount,
    ticketAverageCents: orderCount ? Math.round(orderCents / orderCount) : 0,
    unknownOrders,
    activeSessions,
    closedWithoutCount,
    contributors: [...contributors.values()].sort((a, b) => b.cents - a.cents),
  };
}
