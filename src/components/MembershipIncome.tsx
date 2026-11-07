import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  currentReceiptMonth,
  madridMidnight,
  receiptPeriod,
  PAYMENT_METHODS,
  type Receipt,
  type ReceiptSummary,
} from "@/lib/membership-receipts";
export function MembershipIncome() {
  const { access } = useAuth(),
    initial = currentReceiptMonth();
  const [from, setFrom] = useState(initial.from),
    [through, setThrough] = useState(initial.through),
    [group, setGroup] = useState("day");
  const [rows, setRows] = useState<Receipt[]>([]),
    [summary, setSummary] = useState<ReceiptSummary[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!access.clubId) return;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const range = receiptPeriod(from, through);
        const [history, report] = await Promise.all([
          supabase
            .from("membership_receipts")
            .select("*")
            .eq("club_id", access.clubId!)
            .gte("recorded_at", madridMidnight(range.from))
            .lt("recorded_at", madridMidnight(range.to))
            .order("recorded_at", { ascending: false })
            .limit(100),
          supabase.rpc("membership_receipt_report", {
            p_club_id: access.clubId!,
            p_from: range.from,
            p_to: range.to,
            p_group: group,
          }),
        ]);
        if (history.error || report.error)
          throw new Error("No se pudo consultar la contabilidad de cuotas");
        if (!cancelled) {
          setRows(history.data as Receipt[]);
          setSummary((report.data ?? []) as unknown as ReceiptSummary[]);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access.clubId, from, through, group]);
  return (
    <section className="border border-neon/20 rounded-xl p-4 space-y-3">
      <h2 className="font-display text-neon">Cuotas asociativas</h2>
      <p className="text-xs text-muted-foreground">
        Inscripciones y renovaciones registradas una sola vez desde la ficha del socio. No se crean
        pedidos ni movimientos duplicados.
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        <label>
          Desde
          <input
            aria-label="Cuotas desde"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="block bg-input p-2"
          />
        </label>
        <label>
          Hasta
          <input
            aria-label="Cuotas hasta"
            type="date"
            value={through}
            onChange={(e) => setThrough(e.target.value)}
            className="block bg-input p-2"
          />
        </label>
        <select
          aria-label="Agrupar cuotas"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="bg-input p-2"
        >
          <option value="day">Diario</option>
          <option value="month">Mensual</option>
        </select>
      </div>
      {loading && <p>Cargando…</p>}
      {error && <p role="alert">{error}</p>}
      <div data-testid="cash-membership-summary" className="space-y-1 text-sm">
        {summary.map((r) => (
          <p key={r.period + r.payment_method}>
            {r.period} · {PAYMENT_METHODS[r.payment_method as keyof typeof PAYMENT_METHODS]} ·{" "}
            {r.receipts} recibos · {(r.total_cents / 100).toFixed(2)} €
          </p>
        ))}
      </div>
      <details>
        <summary className="text-sm text-neon">Historial (últimos 100 del período)</summary>
        {rows.map((r) => (
          <div key={r.id} className="text-xs border-t border-border py-2 break-words">
            {new Date(r.recorded_at).toLocaleString("es-ES")} · {r.member_name} ({r.member_number})
            · {(r.amount_cents / 100).toFixed(2)} € · {r.payment_method} · {r.operator_name} ·{" "}
            {r.description} · {r.id}
          </div>
        ))}
      </details>
    </section>
  );
}
