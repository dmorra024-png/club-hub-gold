import { cashAmounts, uniqueLedgerRows } from "./cash-summary.ts";
export type CashSession = {
  id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  closed_by?: string | null;
  opening_cash_cents: number;
  closing_cash_cents: number | null;
  status: string;
  notes?: string | null;
};
export type CashMovement = {
  id: string;
  source: "order" | "fee";
  at: string;
  by: string | null;
  cents: number;
  session_id: string | null;
  payment_method: string | null;
};
export function cashMovements(orders: any[], fees: any[], sessions: CashSession[]): CashMovement[] {
  const completed = orders.filter((o) => o.status === "completed");
  const amounts = cashAmounts(completed, fees);
  void amounts;
  return [
    ...uniqueLedgerRows(completed).map((o: any) => ({
      id: o.id,
      source: "order" as const,
      at: o.created_at,
      by: o.created_by ?? null,
      cents: o.total_cents,
      session_id: o.cash_session_id ?? null,
      payment_method: null,
    })),
    ...uniqueLedgerRows(fees).map((r: any) => {
      const at = Date.parse(r.recorded_at);
      const matches = sessions.filter(
        (s) =>
          s.user_id === r.recorded_by &&
          Date.parse(s.opened_at) <= at &&
          (!s.closed_at || at < Date.parse(s.closed_at)),
      );
      return {
        id: r.id,
        source: "fee" as const,
        at: r.recorded_at,
        by: r.recorded_by ?? null,
        cents: r.amount_cents,
        session_id: matches.length === 1 ? matches[0].id : null,
        payment_method: r.payment_method ?? null,
      };
    }),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
export function sessionRevenue(session: CashSession, movements: CashMovement[]) {
  return movements
    .filter((m) => m.session_id === session.id && m.by === session.user_id)
    .reduce((sum, m) => sum + m.cents, 0);
}
export function dayRevenue(movements: CashMovement[], start: string, end: string) {
  return movements.filter((m) => inCashDay(m, start, end)).reduce((sum, m) => sum + m.cents, 0);
}

export function inCashDay(m: CashMovement, start: string, end: string) {
  const at = Date.parse(m.at);
  if (!Number.isFinite(at)) throw new Error("Fecha del movimiento no válida");
  return at >= Date.parse(start) && at < Date.parse(end);
}

/** Unknown payment methods never become assumed cash. Opening floats are balances, not revenue. */
export function reconcileCash(session: CashSession, movements: CashMovement[]) {
  const entries = movements.filter((m) => m.session_id === session.id && m.by === session.user_id);
  const cash = entries.filter((m) => m.payment_method === "cash").reduce((n, m) => n + m.cents, 0);
  const unknown = entries.some(
    (m) => !["cash", "card", "transfer"].includes(m.payment_method ?? ""),
  );
  const expected = unknown ? null : session.opening_cash_cents + cash;
  return {
    cash,
    expected,
    difference:
      expected !== null && session.status === "closed" && session.closing_cash_cents !== null
        ? session.closing_cash_cents - expected
        : null,
  };
}

/** Count closing observations on their closing date, not on every day an overnight session overlaps. */
export function countedCashOnDay(sessions: CashSession[], start: string, end: string) {
  return sessions
    .filter(
      (s) =>
        s.status === "closed" &&
        s.closed_at !== null &&
        Date.parse(s.closed_at) >= Date.parse(start) &&
        Date.parse(s.closed_at) < Date.parse(end) &&
        s.closing_cash_cents !== null,
    )
    .reduce((total, s) => total + s.closing_cash_cents!, 0);
}
