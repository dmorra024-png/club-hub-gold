import { cashShiftBreakdown } from "@/lib/administrative-shifts";
import { MembershipShifts } from "@/components/MembershipShifts";
import { clubDayRange, cashAmounts, uniqueLedgerRows } from "@/lib/cash-summary";
import { madridToday } from "@/lib/member-administration";
import type { Receipt } from "@/lib/membership-receipts";
import { MembershipIncome } from "@/components/MembershipIncome";
import { parseCashCents } from "@/lib/member-administration";
import { createFileRoute } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Lock, Unlock, Banknote, Users as UsersIcon, Calendar } from "lucide-react";

export const Route = createFileRoute("/_authenticated/caja")({
  component: CajaPage,
});

type Session = {
  id: string;
  user_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash_cents: number;
  closing_cash_cents: number | null;
  status: "open" | "closed";
  notes: string | null;
};

type OrderRow = {
  id: string;
  total_cents: number;
  created_by: string | null;
  created_at: string;
  cash_session_id: string | null;
};

function fmtEur(cents: number) {
  return (cents / 100).toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
  });
}
function todayISO() {
  return madridToday();
}
function dayRange(dateISO: string) {
  return clubDayRange(dateISO);
}

function CajaPage() {
  const { can, loading, accessError, retryAccess } = useAuth();
  if (loading) return <SnoopLayout title="Caja">Cargando…</SnoopLayout>;
  if (!can("use_cash") && !accessError)
    return (
      <SnoopLayout title="Caja">
        <div role="alert">No tienes permiso para usar la caja.</div>
      </SnoopLayout>
    );
  return (
    <SnoopLayout title="Caja" subtitle="Abre y cierra tu caja, consulta los informes del día">
      {accessError && (
        <div role="alert">
          No se pudo verificar el acceso. Los datos del formulario se conservan.{" "}
          <button onClick={retryAccess}>Reintentar</button>
        </div>
      )}
      <fieldset disabled={!!accessError}>
        <Tabs defaultValue="mia" className="w-full">
          <TabsList className="grid grid-cols-2 sm:flex h-auto w-full sm:w-fit gap-1 bg-card/60 border border-neon/20">
            <TabsTrigger value="turnos">Turnos administrativos</TabsTrigger>
            <TabsTrigger value="mia">Mi caja</TabsTrigger>
            <TabsTrigger value="hoy">Informe de hoy</TabsTrigger>
            <TabsTrigger value="fecha">Informe por fecha</TabsTrigger>
            <TabsTrigger value="cuotas">Historial de cuotas</TabsTrigger>
          </TabsList>
          <TabsContent value="turnos">
            <MembershipShifts />
          </TabsContent>
          <TabsContent value="mia">
            <MyCash />
          </TabsContent>
          <TabsContent value="hoy">
            <DayReport dateISO={todayISO()} title="Hoy" />
          </TabsContent>
          <TabsContent value="fecha">
            <DateReportPicker />
          </TabsContent>
          <TabsContent value="cuotas">
            <MembershipIncome />
          </TabsContent>
        </Tabs>
      </fieldset>
    </SnoopLayout>
  );
}

function MyCash() {
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("0");
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notes, setNotes] = useState("");
  const [membershipCash, setMembershipCash] = useState(0);
  const [sales, setSales] = useState<OrderRow[]>([]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setLoadError(Boolean(error));
    setSession((data as Session) ?? null);
    if (data) {
      const { data: orders, error: ordersError } = await supabase
        .from("orders")
        .select("id, total_cents, created_by, created_at, cash_session_id")
        .eq("status", "completed")
        .eq("cash_session_id", (data as any).id);
      const { data: receipts, error: receiptError } = await supabase
        .from("membership_receipts")
        .select("amount_cents")
        .eq("recorded_by", user.id)
        .eq("payment_method", "cash")
        .gte("recorded_at", (data as any).opened_at);
      setMembershipCash((receipts ?? []).reduce((sum, r) => sum + r.amount_cents, 0));
      setLoadError(Boolean(ordersError || receiptError));
      setSales((orders as OrderRow[]) ?? []);
    } else {
      setSales([]);
      setMembershipCash(0);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, [user?.id]);

  const totalVendido = sales.reduce((a, o) => a + (o.total_cents ?? 0), 0);
  const esperado = (session?.opening_cash_cents ?? 0) + totalVendido + membershipCash;

  async function open() {
    if (busy || !user || !navigator.onLine) return;
    const cents = parseCashCents(opening);
    if (cents === null) return toast.error("Importe no válido");
    setBusy(true);
    try {
      const { data: clubId, error: clubError } = await supabase.rpc("current_club_id");
      if (clubError || !clubId) throw new Error("No tienes un club asignado");
      const { error } = await supabase.from("cash_sessions").insert({
        user_id: user.id,
        club_id: clubId,
        opening_cash_cents: cents,
      });
      if (error) throw error;
      toast.success("Caja abierta");
      setOpening("0");
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (!session || busy || !navigator.onLine) return;
    const cents = parseCashCents(closing);
    if (cents === null) return toast.error("Importe no válido");
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("cash_sessions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closing_cash_cents: cents,
          notes,
        })
        .eq("id", session.id)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      if (error || !data)
        throw new Error(error?.message ?? "La caja ya está cerrada o no tienes permiso");
      toast.success("Caja cerrada");
      setClosing("0");
      setNotes("");
      await load();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground">Cargando…</div>;

  if (loadError)
    return (
      <div role="alert" className="text-destructive">
        No se pudo cargar la caja. Comprueba la conexión y vuelve a intentarlo.
      </div>
    );

  if (!session) {
    return (
      <Card className="p-6 bg-card/60 border-neon/30 max-w-md">
        <div className="flex items-center gap-2 mb-4 text-neon">
          <Unlock className="w-5 h-5" />
          <h3 className="font-display text-lg">Abrir caja</h3>
        </div>
        <Label>Dinero inicial (€)</Label>
        <Input
          value={opening}
          onChange={(e) => setOpening(e.target.value)}
          inputMode="decimal"
          className="mt-1"
        />
        <Button
          disabled={busy}
          onClick={open}
          className="mt-4 bg-neon text-background hover:bg-neon/90 w-full"
        >
          Abrir caja
        </Button>
      </Card>
    );
  }

  const closingCents = parseCashCents(closing);
  const diferencia = closingCents === null ? null : closingCents - esperado;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1">
          Caja abierta
        </div>
        <div className="text-xs text-muted-foreground">
          Desde {new Date(session.opened_at).toLocaleString("es-ES")}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Stat label="Inicial" value={fmtEur(session.opening_cash_cents)} />
          <Stat label="Ventas" value={fmtEur(totalVendido)} sub={`${sales.length} pedidos`} />
          <Stat label="Cuotas en efectivo" value={fmtEur(membershipCash)} />
          <Stat label="Esperado en caja" value={fmtEur(esperado)} highlight />
        </div>
      </Card>

      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="flex items-center gap-2 mb-3 text-neon">
          <Lock className="w-5 h-5" />
          <h3 className="font-display text-lg">Cerrar caja</h3>
        </div>
        <Label>Dinero contado (€)</Label>
        <Input
          value={closing}
          onChange={(e) => setClosing(e.target.value)}
          inputMode="decimal"
          className="mt-1"
        />
        <Label className="mt-3 block">Notas</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
        {diferencia !== null && (
          <div className={`mt-3 text-sm ${diferencia === 0 ? "text-neon" : "text-amber-400"}`}>
            Diferencia: {fmtEur(diferencia)}
          </div>
        )}
        <Button
          disabled={busy}
          onClick={close}
          className="mt-4 bg-neon text-background hover:bg-neon/90 w-full"
        >
          Cerrar caja
        </Button>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${highlight ? "border-neon/60 bg-neon/5" : "border-neon/15 bg-card/40"}`}
    >
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</div>
      <div className={`mt-1 font-display text-xl ${highlight ? "text-neon" : "text-foreground"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function DateReportPicker() {
  const [date, setDate] = useState(todayISO());
  return (
    <div>
      <Card className="p-4 bg-card/60 border-neon/30 max-w-sm mb-4 flex items-end gap-3">
        <div className="flex-1">
          <Label className="flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Fecha
          </Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1"
          />
        </div>
      </Card>
      <DayReport
        dateISO={date}
        title={new Date(date + "T00:00:00").toLocaleDateString("es-ES", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      />
    </div>
  );
}

type Collab = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

function DayReport({ dateISO, title }: { dateISO: string; title: string }) {
  const { isAdmin, user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const accessScope = `${user?.id ?? ""}:${isAdmin}`;
  const [reportScope, setReportScope] = useState("");
  const [fees, setFees] = useState<Receipt[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [people, setPeople] = useState<Map<string, Collab>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { start, end } = dayRange(dateISO);

      let oq = supabase
        .from("orders")
        .select("id, total_cents, created_by, created_at, cash_session_id")
        .eq("status", "completed")
        .gte("created_at", start)
        .lt("created_at", end);
      if (!isAdmin && user) oq = oq.eq("created_by", user.id);
      const { data: o, error: orderError } = await oq;

      let sq = supabase
        .from("cash_sessions")
        .select("*")
        .gte("opened_at", start)
        .lt("opened_at", end);
      if (!isAdmin && user) sq = sq.eq("user_id", user.id);
      const { data: s, error: sessionError } = await sq;
      let fq = supabase
        .from("membership_receipts")
        .select("*")
        .gte("recorded_at", start)
        .lt("recorded_at", end);
      if (!isAdmin && user) fq = fq.eq("recorded_by", user.id);
      const { data: receipts, error: receiptError } = await fq;
      if (cancel) return;
      setLoadError(Boolean(orderError || sessionError || receiptError));
      try {
        setFees(uniqueLedgerRows((receipts ?? []) as Receipt[]));
        setOrders(uniqueLedgerRows((o ?? []) as OrderRow[]));
      } catch {
        setLoadError(true);
      }

      // collect user ids and load profiles
      const ids = Array.from(
        new Set([
          ...((o as any[]) ?? []).map((x) => x.created_by).filter(Boolean),
          ...((s as any[]) ?? []).map((x) => x.user_id).filter(Boolean),
          ...((receipts as any[]) ?? []).map((x) => x.recorded_by).filter(Boolean),
        ]),
      );
      const pmap = new Map<string, Collab>();
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", ids);
        ((profs as any[]) ?? []).forEach((p) =>
          pmap.set(p.id, {
            user_id: p.id,
            full_name: p.full_name,
            email: null,
          }),
        );
      }

      if (cancel) return;

      setSessions((s as Session[]) ?? []);
      setPeople(pmap);
      setReportScope(accessScope);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [dateISO, isAdmin, user?.id]);

  const byUser = useMemo(() => {
    const m = new Map<
      string,
      { user_id: string; total: number; count: number; receipts: number }
    >();
    for (const o of orders) {
      const uid = o.created_by ?? "—";
      const e = m.get(uid) ?? { user_id: uid, total: 0, count: 0, receipts: 0 };
      e.total += o.total_cents ?? 0;
      e.count += 1;
      m.set(uid, e);
    }
    for (const fee of fees) {
      const uid = fee.recorded_by ?? "—",
        e = m.get(uid) ?? { user_id: uid, total: 0, count: 0, receipts: 0 };
      e.total += fee.amount_cents;
      e.receipts += 1;
      m.set(uid, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [orders, fees]);

  const amounts = cashAmounts(orders, fees);
  const feeTotal = amounts.feeCents;
  const total = amounts.totalCents;
  let shiftReport: ReturnType<typeof cashShiftBreakdown> | null = null;
  try {
    shiftReport = cashShiftBreakdown(
      [
        ...orders.map((o) => ({
          id: o.id,
          source: "order" as const,
          recorded_at: o.created_at,
          recorded_by: o.created_by,
          amount_cents: o.total_cents,
        })),
        ...fees.map((r) => ({
          id: r.id,
          source: "fee" as const,
          recorded_at: r.recorded_at,
          recorded_by: r.recorded_by,
          amount_cents: r.amount_cents,
        })),
      ],
      dateISO,
    );
  } catch {
    /* Invalid server timestamps must not produce an invented shift. */
  }

  if (loading || reportScope !== accessScope)
    return <div className="text-sm text-muted-foreground">Cargando…</div>;

  if (loadError)
    return (
      <div role="alert">
        No se pudo cargar el informe completo. Recarga antes de utilizar sus importes.
      </div>
    );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={title} value={fmtEur(total)} highlight />
        <Stat label="Pedidos" value={String(orders.length)} />
        <Stat label="Cuotas registradas" value={fmtEur(feeTotal)} sub={`${fees.length} recibos`} />
        <Stat label="Cajas abiertas" value={String(sessions.length)} />
        <Stat label="Colaboradores activos" value={String(byUser.length)} />
      </div>

      <section aria-label="Resumen de turnos" className="space-y-2">
        <h3>Turnos · Europe/Madrid</h3>
        {shiftReport ? (
          <>
            <p>11:00–17:00 · Mañana: {fmtEur(shiftReport.totals.morning)}</p>
            <p>17:00–23:00 · Tarde: {fmtEur(shiftReport.totals.afternoon)}</p>
            <p>Fuera de turno: {fmtEur(shiftReport.totals.outside)}</p>
            <p>Total día: {fmtEur(shiftReport.totals.day)} · Fondo inicial excluido</p>
          </>
        ) : (
          <p role="alert">
            No se pudieron verificar las fechas de los movimientos. No se atribuyen turnos.
          </p>
        )}
      </section>
      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="flex items-center gap-2 mb-3 text-neon">
          <UsersIcon className="w-4 h-4" />
          <h3 className="font-display text-lg">Por colaborador</h3>
        </div>
        {byUser.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sin ingresos este día.</div>
        ) : (
          <div className="divide-y divide-neon/10">
            {byUser.map((row) => {
              const sess = sessions.filter((s) => s.user_id === row.user_id);
              const opening = sess.reduce((a, s) => a + (s.opening_cash_cents ?? 0), 0);
              const closing = sess.reduce((a, s) => a + (s.closing_cash_cents ?? 0), 0);
              const name =
                people.get(row.user_id)?.full_name ??
                (row.user_id === "—" ? "Sin asignar" : row.user_id.slice(0, 8));
              return (
                <div
                  key={row.user_id}
                  className="py-3 flex flex-wrap items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-display text-foreground">{name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.count} pedidos · {row.receipts} cuotas · {sess.length} caja(s)
                    </div>
                    {shiftReport?.staff[row.user_id === "—" ? "unassigned" : row.user_id] && (
                      <p className="text-xs">
                        Mañana:{" "}
                        {fmtEur(
                          shiftReport.staff[row.user_id === "—" ? "unassigned" : row.user_id]
                            .morning,
                        )}{" "}
                        · Tarde:{" "}
                        {fmtEur(
                          shiftReport.staff[row.user_id === "—" ? "unassigned" : row.user_id]
                            .afternoon,
                        )}{" "}
                        · Fuera de turno:{" "}
                        {fmtEur(
                          shiftReport.staff[row.user_id === "—" ? "unassigned" : row.user_id]
                            .outside,
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-4 text-right">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-neon-dim">
                        Ingresos
                      </div>
                      <div className="font-display text-neon">{fmtEur(row.total)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-neon-dim">
                        Inicial
                      </div>
                      <div className="text-sm">{fmtEur(opening)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-neon-dim">
                        Cerrado
                      </div>
                      <div className="text-sm">{fmtEur(closing)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="flex items-center gap-2 mb-3 text-neon">
          <Banknote className="w-4 h-4" />
          <h3 className="font-display text-lg">Cajas del día</h3>
        </div>
        {sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">Ninguna caja abierta.</div>
        ) : (
          <div className="divide-y divide-neon/10 text-sm">
            {sessions.map((s) => (
              <div key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-foreground">
                    {people.get(s.user_id)?.full_name ?? s.user_id.slice(0, 8)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(s.opened_at).toLocaleTimeString("es-ES", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Madrid",
                    })}
                    {s.closed_at
                      ? ` → ${new Date(s.closed_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })}`
                      : " · abierta"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-neon-dim">
                    {s.status === "open" ? "Abierta" : "Cerrada"}
                  </div>
                  <div className="text-sm">
                    Inicial {fmtEur(s.opening_cash_cents)}
                    {s.closing_cash_cents != null
                      ? ` · Cerrado ${fmtEur(s.closing_cash_cents)}`
                      : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
