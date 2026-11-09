import {
  financialReversals,
  financialReversalsInPeriod,
  reversalDetail,
  financialRefundsInPeriod,
} from "./financial-reversals.server.ts";
import { clubDayRange } from "./cash-summary.ts";
import { cashMovements } from "./cash-sessions.ts";
import { uniqueLedgerRows } from "./cash-summary.ts";
export type CashScope = { userId: string; clubId: string };
async function rows(query: any) {
  const { data, error } = await query;
  if (error) throw new Error("No se pudo cargar la caja");
  return data ?? [];
}
export async function openSession(client: any, scope: CashScope, opening: number) {
  const { data, error } = await client
    .from("cash_sessions")
    .insert({ club_id: scope.clubId, user_id: scope.userId, opening_cash_cents: opening })
    .select("id")
    .single();
  if (error || !data)
    throw new Error("No se pudo abrir la caja. Comprueba si ya tienes una abierta.");
  return { id: data.id };
}
export async function closeSession(
  client: any,
  scope: CashScope,
  id: string,
  closing: number,
  notes: string,
  now = () => new Date(),
) {
  const { data, error } = await client
    .from("cash_sessions")
    .update({
      status: "closed",
      closed_at: now().toISOString(),
      closing_cash_cents: closing,
      notes,
    })
    .eq("id", id)
    .eq("club_id", scope.clubId)
    .eq("user_id", scope.userId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("No se pudo cerrar la caja o ya está cerrada.");
  return { id: data.id };
}
export async function loadCash(client: any, scope: CashScope, day: string, now = () => new Date()) {
  const { data: admin, error } = await client.rpc("is_current_user_club_admin", {
    _club_id: scope.clubId,
  });
  if (error || typeof admin !== "boolean")
    throw new Error("No se pudieron verificar los permisos de caja");
  const { start, end } = clubDayRange(day);
  const own = (query: any, key: string) => (admin ? query : query.eq(key, scope.userId));
  async function all(make: () => any) {
    const result: any[] = [];
    for (let n = 0; ; n += 1000) {
      const page = await rows(
        make()
          .order("id")
          .range(n, n + 999),
      );
      result.push(...page);
      if (page.length < 1000) return uniqueLedgerRows(result);
    }
  }
  const sessions = await all(() =>
    own(
      client
        .from("cash_sessions")
        .select("*")
        .eq("club_id", scope.clubId)
        .lt("opened_at", end)
        .or(`closed_at.is.null,closed_at.gte.${start}`)
        .order("opened_at", { ascending: false }),
      "user_id",
    ),
  );
  // Full session intervals are needed for overnight sessions; day totals are filtered separately.
  const earliest = sessions.reduce((a: any, s: any) => (s.opened_at < a ? s.opened_at : a), start);
  const latest = sessions.reduce((a: any, s: any) => {
    const until = s.closed_at ?? now().toISOString();
    return Date.parse(until) > Date.parse(a) ? until : a;
  }, end);
  const orders = await all(() =>
    own(
      client
        .from("orders")
        .select("id,total_cents,created_by,created_at,cash_session_id,status")
        .eq("club_id", scope.clubId)
        .gte("created_at", earliest)
        .lt("created_at", latest)
        .order("created_at"),
      "created_by",
    ),
  );
  const fees = await all(() =>
    own(
      client
        .from("membership_receipts")
        .select("id,amount_cents,recorded_by,recorded_at,payment_method")
        .eq("club_id", scope.clubId)
        .gte("recorded_at", earliest)
        .lt("recorded_at", latest)
        .order("recorded_at"),
      "recorded_by",
    ),
  );
  const refunds = await financialRefundsInPeriod(
    client,
    scope.clubId,
    earliest,
    latest,
    admin ? undefined : scope.userId,
  );
  for (const session of sessions) {
    session.refund_cash_cents = refunds
      .filter(
        (r: any) =>
          r.method === "cash" &&
          r.cash_session_id === session.id &&
          r.recorded_by === session.user_id,
      )
      .reduce((n: number, r: any) => n + r.cents, 0);
    // Original orders do not record payment method: annulment cannot imply cash was returned.
    session.unverified_cancelled_cash = orders.some(
      (o: any) =>
        o.status === "cancelled" &&
        o.cash_session_id === session.id &&
        o.created_by === session.user_id,
    );
  }
  const movements = cashMovements(orders, fees, sessions);
  const cancelled = orders.filter((o: any) => o.status === "cancelled");
  const [linkedReversals, dayReversals] = await Promise.all([
    financialReversals(
      client,
      scope.clubId,
      cancelled.map((o: any) => o.id),
    ),
    financialReversalsInPeriod(client, scope.clubId, start, end, admin ? undefined : scope.userId),
  ]);
  const reversals = [
    ...new Map(
      [...linkedReversals.rows, ...dayReversals.rows].map((r: any) => [r.order_id, r]),
    ).values(),
  ];
  const auditRecords = [
    ...new Set([...cancelled.map((o: any) => o.id), ...reversals.map((r: any) => r.order_id)]),
  ]
    .map((id) => {
      const original = cancelled.find((o: any) => o.id === id),
        reversal = reversals.find((r: any) => r.order_id === id);
      return {
        id,
        reference: `REG-${id.replaceAll("-", "").slice(-12).toUpperCase()}`,
        status: "cancelled",
        at: reversal?.original_at ?? original.created_at,
        cents: reversal?.original_cents ?? original.total_cents,
        by: reversal?.original_actor ?? original.created_by,
        operator: reversal?.original_actor_name ?? null,
        reversal: reversalDetail(reversal),
      };
    })
    .filter(
      (r) =>
        (Date.parse(r.at) >= Date.parse(start) && Date.parse(r.at) < Date.parse(end)) ||
        (r.reversal &&
          Date.parse(r.reversal.at) >= Date.parse(start) &&
          Date.parse(r.reversal.at) < Date.parse(end)),
    );
  const ids = [
    ...new Set(
      [
        scope.userId,
        ...sessions.flatMap((s: any) => [s.user_id, s.closed_by]),
        ...movements.map((m) => m.by),
        ...auditRecords.map((m) => m.by),
        ...refunds.map((r: any) => r.recorded_by),
      ].filter(Boolean),
    ),
  ];
  const profiles: any[] = [];
  for (let n = 0; n < ids.length; n += 100)
    profiles.push(
      ...(await rows(
        client
          .from("profiles")
          .select("id,full_name")
          .in("id", ids.slice(n, n + 100)),
      )),
    );
  return {
    day,
    start,
    end,
    sessions,
    movements,
    auditRecords,
    refunds: refunds.map((r: any) => ({
      id: r.id,
      at: r.recorded_at,
      by: r.recorded_by,
      cents: r.cents,
      method: r.method,
      reason: r.reason,
      session_id: r.cash_session_id,
    })),
    profiles,
    admin: !!admin,
    userId: scope.userId,
  };
}
