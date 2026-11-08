import { useEffect, useState } from "react";
import { getMembershipShifts } from "@/lib/administrative-shifts.functions";
import {
  receiptShift,
  reconcileAdministrativeShifts,
  CLUB_SHIFTS,
} from "@/lib/administrative-shifts";
export function MembershipShifts() {
  const [day, setDay] = useState<string | null>(null),
    [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
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
          reconciliation: reconcileAdministrativeShifts(result.report.rows, result.report.day),
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
  }, [day]);
  const money = (v: number) =>
    (v / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  const current = data ? receiptShift(data.server_now) : null;
  return (
    <section
      className="space-y-3 border border-neon/25 p-4 rounded-xl"
      aria-label="Caja administrativa por turnos"
    >
      <h2>Caja de cuotas · colaborador y turno</h2>
      <p>
        Solo cuotas asociativas. No modifica ni representa pedidos u otras operaciones del catálogo.
      </p>
      {error && <p role="alert">{error}</p>}
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
          {data.admin &&
            Object.entries(data.reconciliation.operators).map(([id, total]) => (
              <p key={id}>
                Colaborador: {data.rows.find((r: any) => r.recorded_by === id)?.operator_name ?? id}{" "}
                · {money(total as number)}
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
                  {r.type} · {money(r.amount_cents)} · {r.payment_method}
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
