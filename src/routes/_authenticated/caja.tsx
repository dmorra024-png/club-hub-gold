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

type OrderRow = { id: string; total_cents: number; created_by: string | null; created_at: string; cash_session_id: string | null };

function fmtEur(cents: number) {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayRange(dateISO: string) {
  const start = new Date(dateISO + "T00:00:00");
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function CajaPage() {
  return (
    <SnoopLayout title="Caja" subtitle="Abre y cierra tu caja, consulta los informes del día">
      <Tabs defaultValue="mia" className="w-full">
        <TabsList className="bg-card/60 border border-neon/20">
          <TabsTrigger value="mia">Mi caja</TabsTrigger>
          <TabsTrigger value="hoy">Informe de hoy</TabsTrigger>
          <TabsTrigger value="fecha">Informe por fecha</TabsTrigger>
        </TabsList>
        <TabsContent value="mia"><MyCash /></TabsContent>
        <TabsContent value="hoy"><DayReport dateISO={todayISO()} title="Hoy" /></TabsContent>
        <TabsContent value="fecha"><DateReportPicker /></TabsContent>
      </Tabs>
    </SnoopLayout>
  );
}

function MyCash() {
  const { user } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("0");
  const [notes, setNotes] = useState("");
  const [sales, setSales] = useState<OrderRow[]>([]);

  async function load() {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("cash_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSession((data as Session) ?? null);
    if (data) {
      const { data: orders } = await supabase
        .from("orders")
        .select("id, total_cents, created_by, created_at, cash_session_id")
        .eq("cash_session_id", (data as any).id);
      setSales((orders as OrderRow[]) ?? []);
    } else {
      setSales([]);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, [user?.id]);

  const totalVendido = sales.reduce((a, o) => a + (o.total_cents ?? 0), 0);
  const esperado = (session?.opening_cash_cents ?? 0) + totalVendido;

  async function open() {
    const cents = Math.round((Number(opening.replace(",", ".")) || 0) * 100);
    const { error } = await supabase.from("cash_sessions").insert({
      user_id: user!.id,
      club_id: (await supabase.rpc("current_club_id")).data,
      opening_cash_cents: cents,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Caja abierta");
    setOpening("0");
    load();
  }

  async function close() {
    if (!session) return;
    const cents = Math.round((Number(closing.replace(",", ".")) || 0) * 100);
    const { error } = await supabase.from("cash_sessions")
      .update({ status: "closed", closed_at: new Date().toISOString(), closing_cash_cents: cents, notes })
      .eq("id", session.id);
    if (error) return toast.error(error.message);
    toast.success("Caja cerrada");
    setClosing("0"); setNotes("");
    load();
  }

  if (loading) return <div className="text-sm text-muted-foreground">Cargando…</div>;

  if (!session) {
    return (
      <Card className="p-6 bg-card/60 border-neon/30 max-w-md">
        <div className="flex items-center gap-2 mb-4 text-neon"><Unlock className="w-5 h-5" /><h3 className="font-display text-lg">Abrir caja</h3></div>
        <Label>Dinero inicial (€)</Label>
        <Input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" className="mt-1" />
        <Button onClick={open} className="mt-4 bg-neon text-background hover:bg-neon/90 w-full">Abrir caja</Button>
      </Card>
    );
  }

  const diferencia = closing !== "" ? Math.round((Number(closing.replace(",", ".")) || 0) * 100) - esperado : null;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1">Caja abierta</div>
        <div className="text-xs text-muted-foreground">Desde {new Date(session.opened_at).toLocaleString("es-ES")}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Stat label="Inicial" value={fmtEur(session.opening_cash_cents)} />
          <Stat label="Ventas" value={fmtEur(totalVendido)} sub={`${sales.length} pedidos`} />
          <Stat label="Esperado en caja" value={fmtEur(esperado)} highlight />
        </div>
      </Card>

      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="flex items-center gap-2 mb-3 text-neon"><Lock className="w-5 h-5" /><h3 className="font-display text-lg">Cerrar caja</h3></div>
        <Label>Dinero contado (€)</Label>
        <Input value={closing} onChange={(e) => setClosing(e.target.value)} inputMode="decimal" className="mt-1" />
        <Label className="mt-3 block">Notas</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
        {diferencia !== null && (
          <div className={`mt-3 text-sm ${diferencia === 0 ? "text-neon" : "text-amber-400"}`}>
            Diferencia: {fmtEur(diferencia)}
          </div>
        )}
        <Button onClick={close} className="mt-4 bg-neon text-background hover:bg-neon/90 w-full">Cerrar caja</Button>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-neon/60 bg-neon/5" : "border-neon/15 bg-card/40"}`}>
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</div>
      <div className={`mt-1 font-display text-xl ${highlight ? "text-neon" : "text-foreground"}`}>{value}</div>
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
          <Label className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Fecha</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
        </div>
      </Card>
      <DayReport dateISO={date} title={new Date(date + "T00:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} />
    </div>
  );
}

type Collab = { user_id: string; full_name: string | null; email: string | null };

function DayReport({ dateISO, title }: { dateISO: string; title: string }) {
  const { isAdmin, user } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [people, setPeople] = useState<Map<string, Collab>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { start, end } = dayRange(dateISO);

      let oq = supabase.from("orders")
        .select("id, total_cents, created_by, created_at, cash_session_id")
        .gte("created_at", start).lt("created_at", end);
      if (!isAdmin && user) oq = oq.eq("created_by", user.id);
      const { data: o } = await oq;

      let sq = supabase.from("cash_sessions")
        .select("*")
        .gte("opened_at", start).lt("opened_at", end);
      if (!isAdmin && user) sq = sq.eq("user_id", user.id);
      const { data: s } = await sq;

      // collect user ids and load profiles
      const ids = Array.from(new Set([
        ...((o as any[]) ?? []).map((x) => x.created_by).filter(Boolean),
        ...((s as any[]) ?? []).map((x) => x.user_id).filter(Boolean),
      ]));
      const pmap = new Map<string, Collab>();
      if (ids.length) {
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        (profs as any[] ?? []).forEach((p) => pmap.set(p.id, { user_id: p.id, full_name: p.full_name, email: null }));
      }

      if (cancel) return;
      setOrders((o as OrderRow[]) ?? []);
      setSessions((s as Session[]) ?? []);
      setPeople(pmap);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [dateISO, isAdmin, user?.id]);

  const byUser = useMemo(() => {
    const m = new Map<string, { user_id: string; total: number; count: number }>();
    for (const o of orders) {
      const uid = o.created_by ?? "—";
      const e = m.get(uid) ?? { user_id: uid, total: 0, count: 0 };
      e.total += o.total_cents ?? 0; e.count += 1;
      m.set(uid, e);
    }
    return Array.from(m.values()).sort((a, b) => b.total - a.total);
  }, [orders]);

  const total = orders.reduce((a, o) => a + (o.total_cents ?? 0), 0);

  if (loading) return <div className="text-sm text-muted-foreground">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={title} value={fmtEur(total)} highlight />
        <Stat label="Pedidos" value={String(orders.length)} />
        <Stat label="Cajas abiertas" value={String(sessions.length)} />
        <Stat label="Colaboradores activos" value={String(byUser.length)} />
      </div>

      <Card className="p-5 bg-card/60 border-neon/30">
        <div className="flex items-center gap-2 mb-3 text-neon"><UsersIcon className="w-4 h-4" /><h3 className="font-display text-lg">Por colaborador</h3></div>
        {byUser.length === 0 ? (
          <div className="text-sm text-muted-foreground">Sin ventas este día.</div>
        ) : (
          <div className="divide-y divide-neon/10">
            {byUser.map((row) => {
              const sess = sessions.filter((s) => s.user_id === row.user_id);
              const opening = sess.reduce((a, s) => a + (s.opening_cash_cents ?? 0), 0);
              const closing = sess.reduce((a, s) => a + (s.closing_cash_cents ?? 0), 0);
              const name = people.get(row.user_id)?.full_name ?? (row.user_id === "—" ? "Sin asignar" : row.user_id.slice(0, 8));
              return (
                <div key={row.user_id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-display text-foreground">{name}</div>
                    <div className="text-[11px] text-muted-foreground">{row.count} pedidos · {sess.length} caja(s)</div>
                  </div>
                  <div className="flex gap-4 text-right">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-neon-dim">Vendido</div>
                      <div className="font-display text-neon">{fmtEur(row.total)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-neon-dim">Inicial</div>
                      <div className="text-sm">{fmtEur(opening)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-neon-dim">Cerrado</div>
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
        <div className="flex items-center gap-2 mb-3 text-neon"><Banknote className="w-4 h-4" /><h3 className="font-display text-lg">Cajas del día</h3></div>
        {sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground">Ninguna caja abierta.</div>
        ) : (
          <div className="divide-y divide-neon/10 text-sm">
            {sessions.map((s) => (
              <div key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-foreground">{people.get(s.user_id)?.full_name ?? s.user_id.slice(0, 8)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(s.opened_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    {s.closed_at ? ` → ${new Date(s.closed_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : " · abierta"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-neon-dim">{s.status === "open" ? "Abierta" : "Cerrada"}</div>
                  <div className="text-sm">Inicial {fmtEur(s.opening_cash_cents)}{s.closing_cash_cents != null ? ` · Cerrado ${fmtEur(s.closing_cash_cents)}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
