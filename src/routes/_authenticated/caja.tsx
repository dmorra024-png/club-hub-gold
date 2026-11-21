import { useVoiceToolPort } from "@/hooks/useVoiceToolPort";
import { useCashRefresh } from "@/hooks/useCashRefresh";
import { paymentMethodLabel } from "@/lib/administrative-payment";
import { FinancialRecordStatus } from "@/components/FinancialRecordDialog";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { getCashReport, openCash, closeCash } from "@/lib/cash-sessions.functions";
import {
  inCashDay,
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
import { Clock3, Wallet, ReceiptText, CalendarDays, UserRound, AlertTriangle } from "lucide-react";
export const Route = createFileRoute("/_authenticated/caja")({ component: Caja });
const money = (c: number) =>
  (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const time = (s: string) => new Date(s).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
const hour = (s: string) => new Date(s).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
function Caja() {
  const { user, access, loading, accessError, can, retryAccess } = useAuth();
  const scope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
  ]);
  const [voiceTab, setVoiceTab] = useState("mia");
  const [refresh, setRefresh] = useCashRefresh();
  const [stored, setStored] = useState<any>(null),
    [error, setError] = useState(""),
    [updating, setUpdating] = useState(false),
    [day, setDay] = useState<string | null>(null),
    [opening, setOpening] = useState("0"),
    [closing, setClosing] = useState(""),
    [notes, setNotes] = useState(""),
    [busy, setBusy] = useState(false);
  const data = stored?.scope === scope && stored?.requestedDay === day ? stored : null;
  useVoiceToolPort("cash.page", {
    open: () => {
      if (can("view_reports")) {
        setDay(null);
        setVoiceTab("informe");
      }
    },
  });
  useEffect(() => {
    if (loading || accessError || !can("use_cash")) return;
    let active = true;
    setError("");
    setUpdating(true);
    getCashReport({ data: { day } })
      .then((result) => {
        if (active) {
          if (
            !result ||
            !Array.isArray(result.movements) ||
            !Array.isArray(result.sessions) ||
            !Array.isArray(result.profiles)
          )
            throw new Error("Respuesta de caja no válida");
          const daily = cashDaySummary(result.movements, result.sessions, result.start, result.end);
          setStored({ ...result, daily, scope, requestedDay: day });
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("No se pudo cargar la caja. Vuelve a intentarlo.");
      })
      .finally(() => {
        if (active) setUpdating(false);
      });
    return () => {
      active = false;
    };
  }, [day, scope, loading, accessError, refresh]);
  const name = (id: string | null | undefined) =>
    id ? data?.profiles.find((p: any) => p.id === id)?.full_name || "Colaborador" : "No registrado";
  const session: CashSession | undefined = data?.sessions.find(
    (s: CashSession) => s.user_id === user?.id && s.status === "open",
  );
  const daily = data?.daily ?? null;
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
      setRefresh();
      toast.success(kind === "open" ? "Caja abierta" : "Caja cerrada");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar la caja");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SnoopLayout title="Caja" contentClassName="snoop-caja-premium">
      {accessError && (
        <div role="alert">
          No se pudo verificar el acceso. <button onClick={retryAccess}>Reintentar acceso</button>
        </div>
      )}
      {!loading && !accessError && !can("use_cash") ? (
        <p role="alert">No tienes permiso para usar la caja.</p>
      ) : (
        <>
          {updating && <p role="status">Actualizando caja…</p>}
          {error && (
            <p role="alert">
              {error} <button onClick={() => setRefresh()}>Reintentar</button>
            </p>
          )}
          <fieldset
            hidden={!!error || !!accessError}
            disabled={busy || loading || !!accessError || !data || !!error}
          >
            <Tabs
              value={voiceTab}
              onValueChange={(value) => {
                setVoiceTab(value);
                if (value === "mia") setDay(null);
              }}
            >
              <TabsList className="snoop-caja-switch grid grid-cols-2 h-auto w-full">
                <TabsTrigger value="mia">Mi caja</TabsTrigger>
                <TabsTrigger value="informe">Informe de caja</TabsTrigger>
              </TabsList>
              <TabsContent value="mia" className="snoop-caja-pane">
                {!data && !error && <p role="status">Cargando…</p>}
                {data && (
                  <Card className="snoop-caja-session-card p-5 space-y-3 bg-card/60">
                    <div className="snoop-caja-session-top"><span><UserRound size={17}/> {name(user?.id)}</span><span className={`snoop-caja-status ${session ? "is-open" : "is-closed"}`}>{session ? "Activa" : "Sin caja abierta"}</span></div>
                    {session ? (
                      <>
                        <div className="snoop-caja-session-time"><Clock3 size={17}/> Caja abierta · {time(session.opened_at)}</div>
                        <p>Fondo inicial: {money(session.opening_cash_cents)}</p>
                        <p>
                          Ingresos registrados:{" "}
                          <strong>{money(sessionRevenue(session, data.movements))}</strong>
                        </p>
                        <p>Ingresos en efectivo: {money(reconciliation!.cash)}</p>
                        {(session.refund_cash_cents ?? 0) > 0 && (
                          <p>
                            Reembolsos de efectivo registrados: {money(session.refund_cash_cents!)}
                          </p>
                        )}
                        <p>
                          Efectivo esperado:{" "}
                          {reconciliation!.expected === null
                            ? session.unverified_cancelled_cash
                              ? "No determinable: revisa el pago original de las anulaciones."
                              : "No determinable: hay pagos sin método identificado"
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
              <TabsContent value="informe" className="snoop-caja-pane space-y-4">
                <label className="snoop-caja-date-label block">
                  <span><CalendarDays size={17}/> Fecha del informe</span>
                  <Input
                    aria-label="Fecha del informe"
                    type="date"
                    value={day ?? data?.day ?? ""}
                    onChange={(e) => setDay(e.target.value || null)}
                  />
                </label>
                {data && (
                  <>
                    <section className="snoop-caja-overview" aria-label="Resumen de caja">
                      <div className="snoop-caja-overview-head">
                        <span><Wallet size={19}/> {data.admin ? "Caja del día" : "Mi caja del día"}</span>
                        <span className="snoop-caja-date-pill">{new Date(data.day + "T12:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}</span>
                      </div>
                      <div className="snoop-caja-total" aria-label="Total del día">{money(daily!.totalCents)}</div>
                      <p className="snoop-caja-total-caption">Ingresos registrados del día · sin duplicar Monedero ni fondos iniciales</p>
                      <div className="snoop-caja-metrics">
                        <div><span>Aportaciones asociativas</span><strong aria-label="Aportaciones del día">{money(daily!.feeCents)}</strong></div>
                        <div><span>Otros ingresos registrados</span><strong>{money(daily!.orderCents)}</strong></div>
                        <div><span>Efectivo identificado</span><strong aria-label="Efectivo del día">{money(daily!.cashCents)}</strong></div>
                        <div><span>Contado en cierres</span><strong>{money(daily!.countedCents)}</strong></div>
                        <div><span>Ingresos fuera de sesión</span><strong>{money(daily!.outsideSessionCents)}</strong></div>
                        {daily!.walletPaidCents > 0 && <div><span>Pedidos pagados con Monedero (separados)</span><strong>{money(daily!.walletPaidCents)}</strong></div>}
                        {daily!.topupCents > 0 && <div><span>Recargas Monedero en efectivo</span><strong>{money(daily!.topupCents)}</strong></div>}
                        {(data.refunds ?? []).some((r: any) => r.method === "cash" && inCashDay(r, data.start, data.end)) && (
                          <div><span>Reembolsos en efectivo (salidas)</span><strong>{money((data.refunds ?? []).filter((r: any) => r.method === "cash" && inCashDay(r, data.start, data.end)).reduce((n: number, r: any) => n + r.cents, 0))}</strong></div>
                        )}
                      </div>
                      {daily!.unidentifiedCents > 0 && <div className="snoop-caja-unknown" role="status">
                        <AlertTriangle size={17}/>
                        <span><strong>{money(daily!.unidentifiedCents)} sin método de pago identificado.</strong> No se clasifica automáticamente como efectivo: verifica el registro original. POS y Monedero permanecen disponibles.</span>
                      </div>}
                    </section>
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
                    <section aria-label="Sesiones de caja" className="snoop-caja-section">
                      <div className="snoop-caja-section-heading"><h3><Clock3 size={21}/> Sesiones de caja</h3><span>{data.sessions.length} registradas</span></div>
                      {data.sessions.length === 0 && <div className="snoop-caja-empty"><Clock3 size={22}/><strong>Sin sesiones este día</strong><span>Las aperturas y cierres aparecerán aquí al registrarse.</span></div>}
                      {data.sessions.map((s: CashSession) => {
                        const balance = reconcileCash(s, data.movements);
                        const isOpen = s.status === "open" && !s.closed_at;
                        return <article key={s.id} className="snoop-caja-shift">
                          <div className="snoop-caja-shift-head">
                            <div className="snoop-caja-shift-person"><UserRound size={19}/><strong>{name(s.user_id)}</strong></div>
                            <span className={`snoop-caja-status ${isOpen ? "is-open" : "is-closed"}`}>{isOpen ? "Activa" : "Cerrada"}</span>
                          </div>
                          <div className="snoop-caja-shift-times">
                            <div><span>Apertura</span><strong>{hour(s.opened_at)}</strong><small>{new Date(s.opened_at).toLocaleDateString("es-ES", {timeZone:"Europe/Madrid"})}</small></div>
                            <div><span>Cierre</span><strong>{s.closed_at ? hour(s.closed_at) : "—"}</strong><small>{s.closed_at ? `Cerrada por: ${name(s.closed_by ?? s.user_id)}` : "Caja en curso"}</small></div>
                          </div>
                          <div className="snoop-caja-shift-revenue"><span>Ingresos registrados</span><strong>{money(sessionRevenue(s, data.movements))}</strong></div>
                          <div className="snoop-caja-shift-detail"><span>Fondo inicial</span><strong>{money(s.opening_cash_cents)}</strong></div>
                          {s.closing_cash_cents !== null && <div className="snoop-caja-shift-detail"><span>Efectivo contado al cierre</span><strong>{money(s.closing_cash_cents)}</strong></div>}
                          <div className="snoop-caja-shift-detail"><span>Efectivo esperado</span><strong>{balance.expected === null ? "No determinable" : money(balance.expected)}</strong></div>
                          {balance.expected === null && <p className="snoop-caja-shift-note">No determinable: hay pagos sin método identificado o anulaciones sin efectivo verificado.</p>}
                          {balance.difference !== null && <div className="snoop-caja-shift-detail"><span>Diferencia:</span><strong>{money(balance.difference)}</strong></div>}
                          {s.notes && <p className="snoop-caja-shift-note">Notas: {s.notes}</p>}
                          <details className="snoop-caja-shift-movements">
                            <summary>Ver movimientos de la sesión</summary>
                            {data.movements.filter((m: any) => m.session_id === s.id && m.by === s.user_id).map((m: any) => (
                              <p key={`${m.source}:${m.id}`}>{m.source === "fee" ? "Cuota asociativa" : m.source === "topup" ? "Recarga Monedero" : m.payment_method === "wallet" ? "Pedido · Monedero" : "Pedido"} · {money(m.cents)} · {name(m.by)} · {time(m.at)}</p>
                            ))}
                          </details>
                        </article>;
                      })}
                    </section>
                    <section aria-label="Movimientos de caja" className="snoop-caja-section snoop-caja-movements">
                      <div className="snoop-caja-section-heading"><h3><ReceiptText size={21}/> Movimientos del día</h3></div>
                      {data.movements
                        .filter((m: any) => inCashDay(m, data.start, data.end))
                        .map((m: any) => (
                          <div
                            key={`${m.source}:${m.id}`}
                            className="snoop-caja-movement-row text-sm"
                          >
                            <p>
                              {m.source === "order" ? (m.payment_method === "wallet" ? "Pedido · Monedero" : "Pedido") : m.source === "topup" ? "Recarga Monedero · efectivo" : "Cuota asociativa"} ·{" "}
                              {money(m.cents)}
                            </p>
                            <p>
                              {name(m.by)} · {time(m.at)}
                              {!m.session_id ? " · Sin sesión" : ""}
                            </p>
                          </div>
                        ))}
                      {(data.refunds ?? [])
                        .filter((r: any) => inCashDay(r, data.start, data.end))
                        .map((r: any) => (
                          <div
                            key={`refund:${r.id}`}
                            className="rounded-xl border border-border p-4 text-sm space-y-1"
                          >
                            <p>
                              Reembolso registrado: {money(-r.cents)} ·{" "}
                              {paymentMethodLabel(r.method)}
                            </p>
                            <p>
                              {name(r.by)} · {time(r.at)}
                            </p>
                            <p>{r.reason}</p>
                            <p className="text-muted-foreground">
                              Salida separada del total contable neto; no se descuenta dos veces.
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
                        <div className="snoop-caja-empty"><ReceiptText size={22}/><strong>Sin movimientos</strong><span>Los registros del día aparecerán aquí.</span></div>
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
