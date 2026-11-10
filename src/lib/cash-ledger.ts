import { calendarDate } from "./member-administration.ts";
import { uniqueLedgerRows } from "./cash-summary.ts";
/** Explicit UTC/offset timestamps only. Never interpret ledger times in device local time. */
export function cashInstant(raw: string | Date): number {
  if (raw instanceof Date) {
    if (!Number.isFinite(raw.getTime())) throw new Error("Fecha contable no válida");
    return raw.getTime();
  }
  if (typeof raw !== "string") throw new Error("Fecha contable no válida");
  const m =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(\.\d{1,9})?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(
      raw,
    );
  if (!m) throw new Error("Fecha contable sin zona horaria o no válida");
  if (!calendarDate(m[1]) || m[2].split(":").some((n, i) => Number(n) > (i === 0 ? 23 : 59)))
    throw new Error("Fecha contable no válida");
  const clock = m[2].length === 5 ? m[2] + ":00" : m[2];
  const zone =
    m[4] === "Z"
      ? "Z"
      : m[4].length === 3
        ? `${m[4]}:00`
        : m[4].length === 5
          ? `${m[4].slice(0, 3)}:${m[4].slice(3)}`
          : m[4];
  const fraction = m[3] ? `.${m[3].slice(1).padEnd(3, "0").slice(0, 3)}` : "";
  const stamp = `${m[1]}T${clock}${fraction}${zone}`,
    at = Date.parse(stamp);
  if (!Number.isFinite(at)) throw new Error("Fecha contable no válida");
  return at;
}
export function cashRange(start: string, end: string) {
  const from = cashInstant(start),
    until = cashInstant(end);
  if (until <= from) throw new Error("Periodo de caja no válido");
  return { from, until };
}
export async function cashRows(query: any) {
  const { data, error } = await query;
  if (error || !Array.isArray(data)) throw new Error("No se pudo cargar la caja");
  return data;
}
export async function cashPages(make: () => any) {
  const result: any[] = [];
  for (let n = 0; ; n += 1000) {
    const query = make()
      .order("id")
      .range(n, n + 999);
    // PostgREST exposes setHeader; isolated SQL adapters do not use an HTTP cache.
    if (typeof query.setHeader === "function")
      query.setHeader("Cache-Control", "no-cache, no-store");
    const page = await cashRows(query);
    result.push(...page);
    if (page.length < 1000) return uniqueLedgerRows(result);
  }
}
export async function readCashLedger(
  client: any,
  scope: { clubId: string; userId: string; admin: boolean },
  start: string,
  end: string,
  includeCancelled = false,
) {
  cashRange(start, end);
  const own = (query: any, key: string) => (scope.admin ? query : query.eq(key, scope.userId));
  const orders = await cashPages(() => {
    let q = client
      .from("orders")
      .select("id,total_cents,created_by,created_at,cash_session_id,status")
      .eq("club_id", scope.clubId)
      .gte("created_at", start)
      .lt("created_at", end);
    if (!includeCancelled) q = q.eq("status", "completed");
    return own(q, "created_by");
  });
  const fees = await cashPages(() =>
    own(
      client
        .from("membership_receipts")
        .select("id,amount_cents,recorded_by,recorded_at,payment_method")
        .eq("club_id", scope.clubId)
        .gte("recorded_at", start)
        .lt("recorded_at", end),
      "recorded_by",
    ),
  );
  if (
    orders.some(
      (o) => typeof o.status !== "string" || (!includeCancelled && o.status !== "completed"),
    )
  )
    throw new Error("Estado contable no válido");
  return {
    orders: orders.map((o) => ({
      ...o,
      created_at: new Date(cashInstant(o.created_at)).toISOString(),
    })),
    fees: fees.map((r) => ({
      ...r,
      recorded_at: new Date(cashInstant(r.recorded_at)).toISOString(),
    })),
  };
}
