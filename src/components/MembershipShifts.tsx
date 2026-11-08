import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { getMembershipShifts } from "@/lib/administrative-shifts.functions";
import { receiptShift, cashShiftBreakdown, CLUB_SHIFTS } from "@/lib/administrative-shifts";
export function MembershipShifts() {
  const { user, access, loading, accessError, can } = useAuth();
  const scope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
  ]);
  const [day, setDay] = useState<string | null>(null),
    [stored, setData] = useState<any>(null),
    [error, setError] = useState("");
  const data = stored?.scope === scope && !loading && !accessError ? stored : null;
  useEffect(() => {
    setData(null);
    if (loading || accessError || !can("use_cash")) return;
    let valid = true;
    setError("");
    getMembershipShifts({ data: { day, operator: null } })
      .then((result) => {
        if (!valid) return;
        if (!result.available) {
          setError(result.message);
          return;
        }
        setData({
          ...result.report,
          scope,
          reconciliation: cashShiftBreakdown(result.report.rows, result.report.day),
        });
      })
      .catch(() => {
        if (valid)
          setError(
            "No se pudo verificar el informe de turnos. Reintenta al recuperar la conexión.",
          );
      });
    return () => {
      valid = false;
    };
  }, [day, scope, loading, accessError]);
  const money = (v: number) =>
    (v / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const current = data ? receiptShift(data.server_now) : null;
  return (
    <section
      className="space-y-3 border border-neon/25 p-4 rounded-xl"
      aria-label="Caja administrativa por turnos"
    >
      <h2>Caja · pedidos y cuotas por turno</h2>
      <p>Pedidos completados y cuotas registradas. El fondo inicial no es un ingreso.</p>
      <p className="text-sm">
        Los pedidos no registran confirmación bancaria ni método de pago. Los importes son registros
        contables; no acreditan una entrega de efectivo.
      </p>
      {error && <p role="alert">{error}</p>}
      {!error && !data && <p role="status">Cargando informe del servidor…</p>}
      {!error && data && (
        <>
          <p>
            Colaborador autenticado: <strong>{data.operator_name}</strong> · {data.user_id}
          </p>
          <p>Fecha: {data.day} · Europe/Madrid</p>
          <p>
            Turno horario del servidor:{" "}
            {current?.shift
              ? CLUB_SHIFTS[current.shift - 1].name
              : "Fuera de turno — requiere gestión administrativa explícita"}
          </p>
          <label>
            Fecha del informe
            <input
              aria-label="Fecha de turnos administrativos"
              type="date"
              value={day ?? data.day}
              onChange={(e) => {
                setData(null);
                setDay(e.target.value || null);
              }}
              className="block bg-input p-2"
            />
          </label>
          <p>
            11:00–17:00 · Mañana: <strong>{money(data.reconciliation.totals.morning)}</strong>
          </p>
          <p>
            17:00–23:00 · Tarde: <strong>{money(data.reconciliation.totals.afternoon)}</strong>
          </p>
          <p>
            Fuera de turno: {money(data.reconciliation.totals.outside)} — no se asigna un turno
            ficticio.
          </p>
          <p>
            {data.admin ? "TOTAL DÍA (todos los colaboradores)" : "TOTAL PROPIO DEL DÍA"}:{" "}
            <strong>{money(data.reconciliation.totals.day)}</strong>
          </p>
          <p>
            Pedidos: {money(data.reconciliation.sources.orders)} · Cuotas:{" "}
            {money(data.reconciliation.sources.fees)}
          </p>
          {Object.entries(data.reconciliation.operators).map(([id, total]) => (
            <p key={id}>
              Colaborador:{" "}
              {data.rows.find((r: any) => (r.recorded_by ?? "unassigned") === id)?.operator_name ??
                id}{" "}
              · Total: {money(total as number)}
              <span className="block">
                Mañana: {money(data.reconciliation.staff[id].morning)} · Tarde:{" "}
                {money(data.reconciliation.staff[id].afternoon)} · Fuera de turno:{" "}
                {money(data.reconciliation.staff[id].outside)}
              </span>
            </p>
          ))}
          <details>
            <summary>Movimientos administrativos y atribución</summary>
            {data.rows.map((r: any) => (
              <article key={r.id} className="border-t py-2 text-sm break-words">
                <p>
                  {r.member_name
                    ? `Nombre del socio: ${r.member_name} · ${r.member_number ?? ""}`
                    : "Socio: datos personales restringidos"}
                </p>
                <p>Colaborador responsable: {r.operator_name}</p>
                <p>
                  Turno: {r.shift === null ? "Fuera de turno" : CLUB_SHIFTS[r.shift - 1].name} ·{" "}
                  {new Date(r.recorded_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                </p>
                <p>
                  {r.type} · {money(r.amount_cents)} ·{" "}
                  {r.payment_method ?? "Método de pago no registrado"}
                </p>
                <p>{r.attribution_source}</p>
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
