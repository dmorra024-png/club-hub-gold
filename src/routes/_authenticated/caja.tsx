import { FinancialRecordStatus, RECORDS_CHANGED } from "@/components/FinancialRecordDialog";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { getCashReport, openCash, closeCash } from "@/lib/cash-sessions.functions";
import {
  inCashDay,
  dayRevenue,
  sessionRevenue,
  reconcileCash,
  cashDaySummary,
  type CashSession,
} from "@/lib/cash-sessions";
import { parseCashCents } from "@/lib/member-administration";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
export const Route = createFileRoute("/_authenticated/caja")({ component: Caja });
const money = (c: number) =>
  (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const time = (s: string) => new Date(s).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
function Caja() {
  const { user, access, loading, accessError, can, retryAccess } = useAuth();
  const scope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
  ]);
  const [stored, setStored] = useState<any>(null),
    [error, setError] = useState(""),
    [day, setDay] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [opening, setOpening] = useState("0"),
    [closing, setClosing] = useState(""),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false);
  const data = stored?.scope === scope && stored?.requestedDay === day ? stored : null;
  useEffect(() => {
    if (loading || accessError || !can("use_cash")) return;
    let active = true;
    getCashReport({ data: { day } })
      .then((result) => {
        if (active) {
          setStored({ ...result, scope, requestedDay: day });
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("No se pudo cargar la caja. Vuelve a intentarlo.");
      });
    return () => {
      active = false;
    };
  }, [day, scope, loading, accessError, refresh]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    };
    window.addEventListener(RECORDS_CHANGED, update);
    window.addEventListener("focus", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener(RECORDS_CHANGED, update);
      window.removeEventListener("focus", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const name = (id: string | null | undefined) =>
    id ? data?.profiles.find((p: any) => p.id === id)?.full_name || "Colaborador" : "No registrado";
  const session: CashSession | undefined = data?.sessions.find(
    (s: CashSession) => s.user_id === user?.id && s.status === "open",
  );
  const daily = data ? cashDaySummary(data.movements, data.sessions, data.start, data.end) : null;
  const reconciliation = session && data ? reconcileCash(session, data.movements) : null;
  async function submit(kind: "open" | "close") {
    if (busy || !can("use_cash") || !navigator.onLine) return;
    const cents = parseCashCents(kind === "open" ? opening : closing);
    if (cents === null || cents > 2147483647) return toast.error("Importe no válido");
    setBusy(true);
    try {
      if (kind === "open") await openCash({ data: { openingCash: cents } });
      else if (session)
        await closeCash({ data: { sessionId: session.id, closingCash: cents, notes } });
      else return;
      setOpening("0");
      setClosing("");
      setNotes("");
      setDay(null);
      setRefresh((n) => n + 1);
      toast.success(kind === "open" ? "Caja abierta" : "Caja cerrada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la caja");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SnoopLayout title="Caja">
      {accessError && (
        <div role="alert">
          No se pudo verificar el acceso. <button onClick={retryAccess}>Reintentar acceso</button>
        </div>
      )}
      {!loading && !accessError && !can("use_cash") ? (
        <p role="alert">No tienes permiso para usar la caja.</p>
      ) : (
        <>
          {error && (
            <p role="alert">
              {error} <button onClick={() => setRefresh((n) => n + 1)}>Reintentar</button>
            </p>
          )}
          <fieldset
            hidden={!!error || !!accessError}
            disabled={busy || loading || !!accessError || !data || !!error}
          >
            <Tabs
              defaultValue="mia"
              onValueChange={(value) => {
                if (value === "mia") setDay(null);
              }}
            >
              <TabsList className="grid grid-cols-2 h-auto w-full sm:w-fit">
                <TabsTrigger value="mia">Mi caja</TabsTrigger>
                <TabsTrigger value="informe">Informe de caja</TabsTrigger>
              </TabsList>
              <TabsContent value="mia">
                {!data && !error && <p role="status">Cargando…</p>}
                {data && (
                  <Card className="p-5 space-y-3 bg-card/60">
                    <p>
                      Colaborador: <strong>{name(user?.id)}</strong>
                    </p>
                    {session ? (
                      <>
                        <p>Caja abierta · {time(session.opened_at)}</p>
                        <p>Fondo inicial: {money(session.opening_cash_cents)}</p>
                        <p>
                          Ingresos registrados:{" "}
                          <strong>{money(sessionRevenue(session, data.movements))}</strong>
                        </p>
                        <p>Ingresos en efectivo: {money(reconciliation!.cash)}</p>
                        <p>
                          Efectivo esperado:{" "}
                          {reconciliation!.expected === null
                            ? "No determinable: hay pagos sin método identificado"
                            : money(reconciliation!.expected)}
                        </p>
                        {reconciliation!.expected !== null && parseCashCents(closing) !== null && (
                          <p>
                            Diferencia: {money(parseCashCents(closing)! - reconciliation!.expected)}
                          </p>
                        )}
                        <label className="block">
                          Dinero contado (€)
                          <Input
                            aria-label="Dinero contado (€)"
                            inputMode="decimal"
                            value={closing}
                            onChange={(e) => setClosing(e.target.value)}
                          />
                        </label>
                        <label className="block">
                          Notas
                          <Input
                            aria-label="Notas de cierre"
                            maxLength={2000}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                          />
                        </label>
                        <Button onClick={() => submit("close")}>Cerrar caja</Button>
                      </>
                    ) : (
                      <>
                        <label className="block">
                          Dinero inicial (€)
                          <Input
                            aria-label="Dinero inicial (€)"
                            inputMode="decimal"
                            value={opening}
                            onChange={(e) => setOpening(e.target.value)}
                          />
                        </label>
                        <Button onClick={() => submit("open")}>Abrir caja</Button>
                      </>
                    )}
                  </Card>
                )}
              </TabsContent>
              <TabsContent value="informe" className="space-y-4">
                <label className="block">
                  Fecha
                  <Input
                    aria-label="Fecha del informe"
                    type="date"
                    value={day ?? data?.day ?? ""}
                    onChange={(e) => setDay(e.target.value || null)}
                  />
                </label>
                {data && (
                  <>
                    <h2>
                      {data.admin ? "Caja del día" : "Mi caja del día"} · {data.day}
                    </h2>
                    <p className="text-2xl" aria-label="Total del día">
                      {money(dayRevenue(data.movements, data.start, data.end))}
                    </p>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 text-sm">
                      <dt>Aportaciones asociativas (cuotas)</dt>
                      <dd aria-label="Aportaciones del día">{money(daily!.feeCents)}</dd>
                      <dt>Otros ingresos registrados</dt>
                      <dd>{money(daily!.orderCents)}</dd>
                      <dt>Efectivo identificado</dt>
                      <dd aria-label="Efectivo del día">{money(daily!.cashCents)}</dd>
                      <dt>Contado en cierres del día</dt>
                      <dd>{money(daily!.countedCents)}</dd>
                      <dt>Ingresos fuera de sesión</dt>
                      <dd>{money(daily!.outsideSessionCents)}</dd>
                    </dl>
                    {daily!.unidentifiedCents > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Método de pago sin identificar: {money(daily!.unidentifiedCents)}
                      </p>
                    )}
                    {daily!.closedSessions > 0 && (
                      <details className="text-sm">
                        <summary className="cursor-pointer py-2">Conciliación de cierres</summary>
                        <p>
                          Previsto en los cierres:{" "}
                          {daily!.expectedAtClosures === null
                            ? "No determinable"
                            : money(daily!.expectedAtClosures)}
                        </p>
                        <p>
                          Diferencia total de cierres:{" "}
                          {daily!.differenceAtClosures === null
                            ? "No determinable"
                            : money(daily!.differenceAtClosures)}
                        </p>
                        <p className="text-muted-foreground">
                          Los fondos iniciales y el dinero contado no son ingresos del día.
                        </p>
                      </details>
                    )}
                    <section aria-label="Sesiones de caja" className="space-y-3">
                      <h3>Sesiones</h3>
                      {data.sessions.length === 0 && <p>Sin sesiones este día.</p>}
                      {data.sessions.map((s: CashSession) => (
                        <Card key={s.id} className="p-4 space-y-1 bg-card/60">
                          <p>
                            Abierta por: {name(s.user_id)} · {time(s.opened_at)}
                          </p>
                          <p>
                            {s.closed_at
                              ? `Cerrada por: ${name(s.closed_by)} · ${time(s.closed_at)}`
                              : "Abierta"}
                          </p>
                          <p>Ingresos: {money(sessionRevenue(s, data.movements))}</p>
                          <p>
                            Fondo inicial: {money(s.opening_cash_cents)}
                            {s.closing_cash_cents !== null
                              ? ` · Contado al cierre: ${money(s.closing_cash_cents)}`
                              : ""}
                          </p>
                          <p>
                            Efectivo esperado:{" "}
                            {reconcileCash(s, data.movements).expected === null
                              ? "No determinable: hay pagos sin método identificado"
                              : money(reconcileCash(s, data.movements).expected!)}
                          </p>
                          {reconcileCash(s, data.movements).difference !== null && (
                            <p>Diferencia: {money(reconcileCash(s, data.movements).difference!)}</p>
                          )}
                          {s.notes && <p>Notas: {s.notes}</p>}
                          <details>
                            <summary className="cursor-pointer py-2">
                              Ver movimientos de la sesión
                            </summary>
                            {data.movements
                              .filter((m: any) => m.session_id === s.id && m.by === s.user_id)
                              .map((m: any) => (
                                <p
                                  key={`${m.source}:${m.id}`}
                                  className="border-b border-border py-2 text-sm"
                                >
                                  {m.source === "fee" ? "Cuota asociativa" : "Pedido"} ·{" "}
                                  {money(m.cents)} · {name(m.by)} · {time(m.at)}
                                </p>
                              ))}
                          </details>
                        </Card>
                      ))}
                    </section>
                    <section aria-label="Movimientos de caja" className="space-y-2">
                      <h3>Movimientos del día</h3>
                      {data.movements
                        .filter((m: any) => inCashDay(m, data.start, data.end))
                        .map((m: any) => (
                          <div
                            key={`${m.source}:${m.id}`}
                            className="border-b border-border py-2 text-sm"
                          >
                            <p>
                              {m.source === "order" ? "Pedido" : "Cuota asociativa"} ·{" "}
                              {money(m.cents)}
                            </p>
                            <p>
                              {name(m.by)} · {time(m.at)}
                              {!m.session_id ? " · Sin sesión" : ""}
                            </p>
                          </div>
                        ))}
                      {data.auditRecords?.map((r: any) => (
                        <div
                          key={`audit:${r.id}`}
                          className="rounded-xl border border-red-400/25 p-4 text-sm space-y-2"
                        >
                          <p>
                            <FinancialRecordStatus status={r.status} /> · {r.reference}
                          </p>
                          <p>
                            Original: {money(r.cents)} · {r.operator || name(r.by)} · {time(r.at)}
                          </p>
                          {r.reversal ? (
                            <>
                              <p>
                                Rectificación {r.reversal.reference}: {money(r.reversal.cents)}
                              </p>
                              <p>
                                {r.reversal.by} · {time(r.reversal.at)}
                              </p>
                              <p>Motivo: {r.reversal.reason}</p>
                              <p>Neto: {money(r.cents + r.reversal.cents)}</p>
                            </>
                          ) : (
                            <p>Rectificación anterior no registrada. Excluido del total neto.</p>
                          )}
                        </div>
                      ))}
                      {!data.movements.some((m: any) => inCashDay(m, data.start, data.end)) && (
                        <p>Sin movimientos.</p>
                      )}
                    </section>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </fieldset>
        </>
      )}
    </SnoopLayout>
  );
}
