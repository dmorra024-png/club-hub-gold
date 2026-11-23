import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addCalendarDays, madridToday } from "@/lib/member-administration";
import { clubDayRange } from "@/lib/cash-summary";
import { InventoryCostReport } from "@/components/InventoryCostReport";
import { ProductEconomicsReport } from "@/components/ProductEconomicsReport";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Euro,
  Package,
  ArrowRight,
  ArrowLeft as ArrowLeftIcon,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/ajustes/informes")({
  component: InformesPage,
});

// All chart accents inherit the club's live theme; never pin a fixed palette.
const NEON = "var(--snoop-accent)";
const NEON_DIM = "var(--snoop-border)";
const RED = "var(--destructive)";
const PIE_COLORS = ["var(--snoop-accent)", "var(--snoop-electric)", "var(--snoop-border)", "var(--snoop-foreground)"];

type Range = "7d" | "30d" | "90d" | "365d" | "custom";
const RANGES: { id: Exclude<Range, "custom">; label: string; days: number }[] = [
  { id: "7d", label: "7 días", days: 7 },
  { id: "30d", label: "30 días", days: 30 },
  { id: "90d", label: "90 días", days: 90 },
  { id: "365d", label: "1 año", days: 365 },
];

function InformesPage() {
  const { can, loading, access } = useAuth();
  const isAdmin = can("view_reports");
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !isAdmin) nav({ to: "/" });
  }, [loading, isAdmin, nav]);

  const [range, setRange] = useState<Range>("30d");
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(() => madridToday());
  const [draftTo, setDraftTo] = useState(() => madridToday());
  const [appliedCustom, setAppliedCustom] = useState(() => ({ from: madridToday(), to: madridToday() }));
  const customValid = /^\d{4}-\d{2}-\d{2}$/.test(draftFrom) && /^\d{4}-\d{2}-\d{2}$/.test(draftTo) && draftFrom <= draftTo && draftTo <= madridToday() && (Date.parse(draftTo) - Date.parse(draftFrom)) / 86400000 <= 730;
  const madridDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const period = useMemo(() => {
    const to = range === "custom" ? appliedCustom.to : madridToday();
    const from = range === "custom" ? appliedCustom.from : new Date(Date.parse(`${to}T00:00:00Z`) - (RANGES.find((r) => r.id === range)!.days - 1) * 86400000).toISOString().slice(0, 10);
    const days: string[] = [];
    for (let date = from; date <= to && days.length <= 731; date = addCalendarDays(date, 1)) days.push(date);
    return { days, from, to, start: clubDayRange(from).start, end: clubDayRange(to).end };
  }, [range, appliedCustom]);
  const [items, setItems] = useState<any[]>([]);
  const [movs, setMovs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [completedOrderCount, setCompletedOrderCount] = useState(0);

  useEffect(() => {
    const clubId = access.clubId;
    if (!isAdmin || !clubId) return;
    const since = period.start;
    const until = period.end;
    setDataLoading(true);
    setDataError(null);
    let cancelled = false;
    (async () => {
      async function pages(make: () => any) {
        const data: any[] = [];
        for (let offset = 0; ; offset += 1000) {
          const result = await make()
            .order("id")
            .range(offset, offset + 999);
          if (result.error) return result;
          data.push(...(result.data ?? []));
          if ((result.data ?? []).length < 1000) return { data, error: null };
        }
      }
      const [oi, sm, pr, ct, ci, orders] = await Promise.all([
        pages(() =>
          supabase.from("order_items").select("*").eq("club_id", clubId).gte("created_at", since).lt("created_at", until),
        ),
        supabase.from("stock_movements").select("*").gte("created_at", since).lt("created_at", until),
        supabase.from("products").select("id,name,stock,buy_price,sell_price,category_id"),
        supabase.from("product_categories").select("id,name,unit_type"),
        supabase
          .from("check_ins")
          .select("id,direction,created_at,member_id")
          .gte("created_at", since).lt("created_at", until),
        pages(() =>
          supabase
            .from("orders")
            .select("id,status")
            .eq("club_id", clubId)
            .eq("status", "completed")
            .gte("created_at", since).lt("created_at", until),
        ),
      ]);
      if (cancelled) return;
      if ([oi, sm, pr, ct, ci, orders].some((result) => result.error)) {
        setDataError(
          "No se pudieron cargar los informes. Comprueba la conexión y vuelve a intentarlo.",
        );
        setDataLoading(false);
        return;
      }
      const completedIds = new Set(
        (orders.data ?? []).filter((o: any) => o.status === "completed").map((o: any) => o.id),
      );
      setItems((oi.data ?? []).filter((i: any) => completedIds.has(i.order_id)));
      setCompletedOrderCount(completedIds.size);
      setMovs(sm.data ?? []);
      setProducts(pr.data ?? []);
      setCats(ct.data ?? []);
      setCheckIns(ci.data ?? []);
      setDataLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [period.start, period.end, isAdmin, access.clubId]);

  const accessStats = useMemo(() => {
    const todayStart = clubDayRange(madridToday()).start;
    const todayEnd = clubDayRange(madridToday()).end;
    const today = checkIns.filter((c) => c.created_at >= todayStart && c.created_at < todayEnd);
    const inToday = today.filter((c) => c.direction === "in").length;
    const outToday = today.filter((c) => c.direction === "out").length;
    // Currently inside: last direction per member today
    const lastPerMember = new Map<string, string>();
    for (const c of [...today].sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    )) {
      if (!lastPerMember.has(c.member_id)) lastPerMember.set(c.member_id, c.direction);
    }
    let insideNow = 0;
    lastPerMember.forEach((d) => {
      if (d === "in") insideNow++;
    });

    // Daily series
    const buckets = new Map<string, { day: string; entradas: number; salidas: number }>();
    for (const key of period.days) buckets.set(key, { day: key.slice(5), entradas: 0, salidas: 0 });
    for (const c of checkIns) {
      const key = madridDay(String(c.created_at));
      const b = buckets.get(key);
      if (!b) continue;
      if (c.direction === "in") b.entradas++;
      else b.salidas++;
    }
    return { inToday, outToday, insideNow, total: checkIns.length, daily: [...buckets.values()] };
  }, [checkIns, period.days]);

  const stats = useMemo(() => {
    const revenue = items.reduce((s, i) => s + Number(i.line_total_cents || 0), 0) / 100;
    const soldQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const added = movs.filter((m) => Number(m.delta) > 0).reduce((s, m) => s + Number(m.delta), 0);
    const removed = movs
      .filter((m) => Number(m.delta) < 0)
      .reduce((s, m) => s + Math.abs(Number(m.delta)), 0);
    return { revenue, soldQty, added, removed };
  }, [items, movs]);

  // Read-only insights from data already loaded for this club and period.
  const usefulStats = useMemo(() => {
    const ticket = completedOrderCount > 0 ? stats.revenue / completedOrderCount : 0;
    const daysWithActivity = new Map<string, { cents: number; orders: Set<string> }>();
    const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}:00`, pedidos: 0, ingresos: 0 }));
    const byOrderHour = new Map<string, { hour: number; cents: number }>();
    for (const item of items) {
      const cents = Number(item.line_total_cents || 0);
      const date = new Date(item.created_at);
      if (!Number.isFinite(date.getTime())) continue;
      const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
      const bucket = daysWithActivity.get(dayKey) ?? { cents: 0, orders: new Set<string>() };
      bucket.cents += cents;
      if (item.order_id) bucket.orders.add(item.order_id);
      daysWithActivity.set(dayKey, bucket);
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" }).format(date));
      if (hour >= 0 && hour < 24) {
        hours[hour].ingresos += cents / 100;
        const key = String(item.order_id ?? item.id);
        const record = byOrderHour.get(key);
        byOrderHour.set(key, { hour, cents: (record?.cents ?? 0) + cents });
      }
    }
    for (const o of byOrderHour.values()) hours[o.hour].pedidos++;
    const bestHour = hours.reduce<(typeof hours)[number] | null>((a, b) => !a || b.pedidos > a.pedidos ? b : a, null);
    const bestDay = [...daysWithActivity.entries()].sort((a, b) => b[1].cents - a[1].cents)[0];
    return { ticket, bestHour: bestHour?.pedidos ? bestHour : null, bestDay, hours };
  }, [items, stats.revenue, completedOrderCount]);

  // Top vendidos
  const topSold = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const i of items) {
      const key = i.product_id || i.product_name;
      const prev = map.get(key) ?? { name: i.product_name, qty: 0, revenue: 0 };
      prev.qty += Number(i.quantity || 0);
      prev.revenue += Number(i.line_total_cents || 0) / 100;
      map.set(key, prev);
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [items]);

  // Serie diaria de ventas
  const daily = useMemo(() => {
    const buckets = new Map<string, { day: string; revenue: number; qty: number }>();
    for (const key of period.days) buckets.set(key, { day: key.slice(5), revenue: 0, qty: 0 });
    for (const it of items) {
      const key = madridDay(String(it.created_at));
      const b = buckets.get(key);
      if (!b) continue;
      b.revenue += Number(it.line_total_cents || 0) / 100;
      b.qty += Number(it.quantity || 0);
    }
    return [...buckets.values()];
  }, [items, period.days]);

  // Movimientos por día (entradas / salidas por ventas o retiradas)
  const dailyMovs = useMemo(() => {
    const buckets = new Map<string, { day: string; entradas: number; salidas: number }>();
    for (const key of period.days) buckets.set(key, { day: key.slice(5), entradas: 0, salidas: 0 });
    for (const m of movs) {
      const key = madridDay(String(m.created_at));
      const b = buckets.get(key);
      if (!b) continue;
      const d = Number(m.delta);
      if (d >= 0) b.entradas += d;
      else b.salidas += Math.abs(d);
    }
    return [...buckets.values()];
  }, [movs, period.days]);

  // Reparto por categoría (ingresos)
  const byCategory = useMemo(() => {
    const prodCat = new Map(products.map((p) => [p.id, p.category_id]));
    const catName = new Map(cats.map((c) => [c.id, c.name]));
    const map = new Map<string, number>();
    for (const i of items) {
      const cId = prodCat.get(i.product_id) ?? "otros";
      const name = catName.get(cId) ?? "Otros";
      map.set(name, (map.get(name) ?? 0) + Number(i.line_total_cents || 0) / 100);
    }
    return [...map.entries()].map(([name, value]) => ({ name, value }));
  }, [items, products, cats]);

  // Stock actual bajo
  const lowStock = useMemo(() => {
    return [...products]
      .filter((p) => Number(p.stock) < 10)
      .sort((a, b) => Number(a.stock) - Number(b.stock))
      .slice(0, 8);
  }, [products]);

  const movementRows = useMemo(() => {
    const prodMap = new Map(products.map((p) => [p.id, p]));
    const byProduct = new Map<string, any[]>();
    for (const m of movs) {
      const arr = byProduct.get(m.product_id) ?? [];
      arr.push(m);
      byProduct.set(m.product_id, arr);
    }

    const totals = new Map<string, Map<string, number>>();
    for (const [productId, list] of byProduct.entries()) {
      const p = prodMap.get(productId);
      let running = Number(p?.stock ?? 0);
      const totalByMovement = new Map<string, number>();
      [...list]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .forEach((m) => {
          totalByMovement.set(m.id, running);
          running -= Number(m.delta || 0);
        });
      totals.set(productId, totalByMovement);
    }

    return [...movs]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((m) => {
        const p = prodMap.get(m.product_id);
        const delta = Number(m.delta || 0);
        return {
          id: m.id,
          productId: m.product_id,
          productName: p?.name ?? "Producto eliminado",
          day: String(m.created_at).slice(0, 10),
          time: new Date(m.created_at).toLocaleTimeString("es-ES", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          delta,
          reason: String(m.reason || "manual"),
          notes: m.notes || "",
          totalAfter: totals.get(m.product_id)?.get(m.id) ?? Number(p?.stock ?? 0),
        };
      });
  }, [movs, products]);

  const dailyProductHistory = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        day: string;
        productName: string;
        added: number;
        removed: number;
        sold: number;
        totalAfter: number;
      }
    >();
    for (const row of [...movementRows].reverse()) {
      const key = `${row.day}|${row.productId}`;
      const prev = map.get(key) ?? {
        key,
        day: row.day,
        productName: row.productName,
        added: 0,
        removed: 0,
        sold: 0,
        totalAfter: row.totalAfter,
      };
      if (row.reason === "sale") prev.sold += Math.abs(row.delta);
      else if (row.delta > 0) prev.added += row.delta;
      else prev.removed += Math.abs(row.delta);
      prev.totalAfter = row.totalAfter;
      map.set(key, prev);
    }
    return [...map.values()].sort(
      (a, b) => b.day.localeCompare(a.day) || a.productName.localeCompare(b.productName),
    );
  }, [movementRows]);

  if (loading || !isAdmin)
    return (
      <SnoopLayout>
        <div className="p-8 text-muted-foreground">Cargando…</div>
      </SnoopLayout>
    );

  if (dataError)
    return (
      <SnoopLayout title="Informes">
        <div role="alert" className="p-6 text-destructive">
          {dataError}
        </div>
      </SnoopLayout>
    );

  return (
    <SnoopLayout title="Informes" subtitle="Estadísticas de stock y ventas" contentClassName="snoop-informes-premium">
      {/* Range selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => { setRange(r.id); setCustomOpen(false); }}
            className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border transition ${
              range === r.id
                ? "border-neon text-neon bg-neon/10"
                : "border-border text-muted-foreground hover:text-neon hover:border-neon/40"
            }`}
          >
            {r.label}
          </button>
        ))}
        <button type="button" onClick={() => setCustomOpen((open) => !open)} className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border transition ${range === "custom" ? "border-neon text-neon bg-neon/10" : "border-border text-muted-foreground hover:text-neon hover:border-neon/40"}`} aria-expanded={customOpen}>Personalizar búsqueda</button>
      </div>
      {customOpen && (
        <div className="snoop-informes-custom-range" aria-label="Personalizar búsqueda por fechas">
          <label>Desde<input type="date" value={draftFrom} max={madridToday()} onChange={(e) => setDraftFrom(e.target.value)} /></label>
          <label>Hasta<input type="date" value={draftTo} max={madridToday()} onChange={(e) => setDraftTo(e.target.value)} /></label>
          {!customValid && <p role="alert">Selecciona fechas válidas: Desde debe ser anterior o igual a Hasta, sin fechas futuras (máximo 731 días).</p>}
          <button type="button" disabled={!customValid} onClick={() => { setAppliedCustom({ from: draftFrom, to: draftTo }); setRange("custom"); setCustomOpen(false); }}>Aplicar fechas</button>
        </div>
      )}
      {range === "custom" && <p className="snoop-informes-selected-period">Periodo seleccionado: {appliedCustom.from === appliedCustom.to ? appliedCustom.from : `${appliedCustom.from} — ${appliedCustom.to}`}</p>}

      {dataLoading ? (
        <div className="text-muted-foreground">Calculando…</div>
      ) : (
        <div className="space-y-6">
          {access.clubId&&<InventoryCostReport clubId={access.clubId} />}
          {access.clubId&&<ProductEconomicsReport clubId={access.clubId} />}
          <section className="snoop-informes-insights" aria-label="Indicadores útiles">
            <div className="snoop-informes-section-heading"><span>ANÁLISIS DEL PERIODO</span><h2>Lo importante, de un vistazo</h2></div>
            <div className="snoop-informes-quick-grid">
              <div><span>Pedidos completados</span><strong>{completedOrderCount}</strong><small>En el periodo seleccionado</small></div>
              <div><span>Media por pedido</span><strong>{usefulStats.ticket.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</strong><small>Ingresos de artículos / pedidos</small></div>
              <div><span>Hora con más pedidos</span><strong>{usefulStats.bestHour?.label ?? "—"}</strong><small>{usefulStats.bestHour ? `${usefulStats.bestHour.pedidos} pedidos` : "Sin actividad registrada"}</small></div>
              <div><span>Productos con stock bajo</span><strong>{lowStock.length}{lowStock.length === 8 ? "+" : ""}</strong><small>Ver sección Stock bajo</small></div>
            </div>
            <div className="snoop-informes-tip" role="status">
              {completedOrderCount === 0 ? "No hay pedidos completados en este periodo." :
                usefulStats.bestDay ? `El día con mayores ingresos registrados fue el ${usefulStats.bestDay[0]}, con ${(usefulStats.bestDay[1].cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}.` :
                "Consulta los movimientos del periodo para encontrar oportunidades."}
            </div>
          </section>
          <ChartCard title="Actividad por hora · pedidos">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={usefulStats.hours} margin={{ left: -18, right: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--snoop-border)" strokeOpacity={0.25} strokeDasharray="3 6" />
                <XAxis dataKey="label" tick={{ fill: "var(--snoop-foreground)", fontSize: 10 }} interval={3} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--snoop-foreground)", fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--snoop-panel)", border: "1px solid var(--snoop-border)", borderRadius: 12, color: "var(--snoop-foreground)" }} />
                <Bar dataKey="pedidos" name="Pedidos" fill={NEON} radius={[5, 5, 0, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Euro} label="Ingresos" value={`€${stats.revenue.toFixed(2)}`} tint="neon" />
            <Kpi icon={Package} label="Vendido" value={`${stats.soldQty.toFixed(2)}`} tint="neon" />
            <Kpi
              icon={TrendingUp}
              label="Añadido a stock"
              value={`+${stats.added.toFixed(2)}`}
              tint="neon"
            />
            <Kpi
              icon={TrendingDown}
              label="Salidas stock"
              value={`-${stats.removed.toFixed(2)}`}
              tint="red"
            />
          </div>

          {/* Control de acceso */}
          <div>
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon-dim mb-3">
              Control de acceso
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <Kpi
                icon={Users}
                label="Dentro ahora"
                value={String(accessStats.insideNow)}
                tint="neon"
              />
              <Kpi
                icon={ArrowRight}
                label="Entradas hoy"
                value={String(accessStats.inToday)}
                tint="neon"
              />
              <Kpi
                icon={ArrowLeftIcon}
                label="Salidas hoy"
                value={String(accessStats.outToday)}
                tint="red"
              />
              <Kpi
                icon={Users}
                label={`Total accesos (${range})`}
                value={String(accessStats.total)}
                tint="neon"
              />
            </div>
            <ChartCard title="Entradas y salidas por día">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={accessStats.daily}>
                  <CartesianGrid stroke="var(--snoop-border)" strokeOpacity={0.25} strokeDasharray="3 6" />
                  <XAxis dataKey="day" stroke="var(--snoop-foreground)" fontSize={10} />
                  <YAxis stroke="var(--snoop-foreground)" fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "var(--snoop-panel)", border: "1px solid var(--snoop-border)" }} />
                  <Legend />
                  <Bar dataKey="entradas" fill={NEON} name="Entradas" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="salidas" fill={RED} name="Salidas" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Ventas diarias */}
          <ChartCard title="Ingresos por día">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily}>
                <CartesianGrid stroke="var(--snoop-border)" strokeOpacity={0.25} strokeDasharray="3 6" />
                <XAxis dataKey="day" stroke="var(--snoop-foreground)" fontSize={11} />
                <YAxis stroke="var(--snoop-foreground)" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "var(--snoop-panel)", border: `1px solid ${NEON}` }}
                  labelStyle={{ color: NEON }}
                  formatter={(v: any) => [`€${Number(v).toFixed(2)}`, "Ingresos"]}
                />
                <Line type="monotone" dataKey="revenue" stroke={NEON} strokeWidth={3} dot={false} activeDot={{ r: 5, stroke: "var(--snoop-electric)", strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Top vendidos */}
          <ChartCard title="Top productos por ingresos">
            {topSold.length === 0 ? (
              <div className="text-xs text-muted-foreground">Sin ventas en este periodo.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topSold} layout="vertical" margin={{ left: 16 }}>
                  <CartesianGrid stroke="var(--snoop-border)" strokeOpacity={0.25} strokeDasharray="3 6" />
                  <XAxis type="number" stroke="var(--snoop-foreground)" fontSize={11} />
                  <YAxis type="category" dataKey="name" stroke="var(--snoop-foreground)" fontSize={11} width={110} />
                  <Tooltip
                    contentStyle={{ background: "var(--snoop-panel)", border: `1px solid ${NEON}` }}
                    formatter={(v: any, n: string) =>
                      n === "revenue"
                        ? [`€${Number(v).toFixed(2)}`, "Ingresos"]
                        : [Number(v).toFixed(2), "Cantidad"]
                    }
                  />
                  <Bar dataKey="revenue" fill={NEON} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Movimientos de stock */}
          <ChartCard title="Movimientos de stock por día">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={dailyMovs}>
                <CartesianGrid stroke="var(--snoop-border)" strokeOpacity={0.25} strokeDasharray="3 6" />
                <XAxis dataKey="day" stroke="var(--snoop-foreground)" fontSize={11} />
                <YAxis stroke="var(--snoop-foreground)" fontSize={11} />
                <Tooltip contentStyle={{ background: "var(--snoop-panel)", border: `1px solid ${NEON}` }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="entradas" fill={NEON} name="Entradas" radius={[5, 5, 0, 0]} />
                <Bar dataKey="salidas" fill={RED} name="Salidas" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Histórico diario por producto">
            {dailyProductHistory.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Sin movimientos de stock en este periodo.
              </div>
            ) : (
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full min-w-[620px] text-sm">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-widest text-neon-dim border-b border-neon/20">
                      <th className="text-left py-2 font-normal">Día</th>
                      <th className="text-left py-2 font-normal">Producto</th>
                      <th className="text-right py-2 font-normal">Más</th>
                      <th className="text-right py-2 font-normal">Ventas</th>
                      <th className="text-right py-2 font-normal">Menos</th>
                      <th className="text-right py-2 font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {dailyProductHistory.map((row) => (
                      <tr key={row.key}>
                        <td className="py-2 text-muted-foreground whitespace-nowrap">{row.day}</td>
                        <td className="py-2 text-foreground">{row.productName}</td>
                        <td className="py-2 text-right text-neon font-mono">
                          +{row.added.toFixed(2)}
                        </td>
                        <td className="py-2 text-right text-destructive font-mono">
                          -{row.sold.toFixed(2)}
                        </td>
                        <td className="py-2 text-right text-destructive/80 font-mono">
                          -{row.removed.toFixed(2)}
                        </td>
                        <td className="py-2 text-right text-foreground font-mono">
                          {row.totalAfter.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>

          <ChartCard title="Lista completa de movimientos">
            {movementRows.length === 0 ? (
              <div className="text-xs text-muted-foreground">Sin movimientos en este periodo.</div>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {movementRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-input/35 border border-border/60 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate">{row.productName}</div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {row.day} · {row.time} · {movementLabel(row.reason)}
                      </div>
                      {row.notes && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {row.notes}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`font-display text-sm ${row.delta >= 0 ? "text-neon" : "text-destructive"}`}
                      >
                        {row.delta >= 0 ? "+" : ""}
                        {row.delta.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        total {row.totalAfter.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          {/* Ingresos por categoría: mobile-safe donut + full accessible legend. */}
          {byCategory.length > 0 && (
            <ChartCard title="Ingresos por categoría">
              <div className="snoop-informes-category-chart">
                <ResponsiveContainer width="100%" height={218}>
                  <PieChart>
                    <Pie
                      data={byCategory}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={52}
                      outerRadius={86}
                      paddingAngle={byCategory.length > 1 ? 2 : 0}
                      labelLine={false}
                      label={false}
                      stroke="var(--snoop-panel)"
                      strokeWidth={2}
                    >
                      {byCategory.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "var(--snoop-panel)", color: "var(--snoop-foreground)", border: "1px solid var(--snoop-border)", borderRadius: 12 }}
                      formatter={(v: any) => [Number(v).toLocaleString("es-ES", { style: "currency", currency: "EUR" }), "Ingresos"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="snoop-informes-category-legend" aria-label="Desglose de ingresos por categoría">
                  {byCategory
                    .slice()
                    .sort((a, b) => b.value - a.value)
                    .map(({ name, value }) => {
                      const index = byCategory.findIndex((c) => c.name === name);
                      const total = byCategory.reduce((sum, c) => sum + c.value, 0);
                      return (
                        <div className="snoop-informes-category-item" key={name}>
                          <span className="snoop-informes-category-dot" style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} aria-hidden="true" />
                          <span className="snoop-informes-category-name">{name}</span>
                          <strong>{value.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</strong>
                          <span className="snoop-informes-category-percent">{total > 0 ? (value / total * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : "0"} %</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </ChartCard>
          )}

          {/* Stock bajo */}
          <ChartCard title="Stock bajo (menos de 10)">
            {lowStock.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Todos los productos tienen buen stock 🎉
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {lowStock.map((p) => (
                  <li key={p.id} className="flex justify-between py-2 text-sm">
                    <span className="text-foreground">{p.name}</span>
                    <span className="text-destructive font-mono">{Number(p.stock).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      )}
    </SnoopLayout>
  );
}

function movementLabel(reason: string) {
  if (reason === "sale") return "venta";
  if (reason.includes("add")) return "carga";
  if (reason.includes("remove")) return "retirada";
  return reason || "manual";
}

function Kpi({
  icon: Icon,
  label,
  value,
  tint,
}: {
  icon: any;
  label: string;
  value: string;
  tint: "neon" | "red";
}) {
  const color = tint === "neon" ? "text-neon" : "text-destructive";
  return (
    <div className="snoop-informes-kpi bg-card/60 border border-neon/20 rounded-2xl p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <Icon className={`w-4 h-4 ${color}`} />
        {label}
      </div>
      <div className={`mt-1 font-display text-xl ${color}`}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="snoop-informes-chart-card bg-card/60 border border-neon/20 rounded-2xl p-4 sm:p-5">
      <div className="font-display text-sm text-neon tracking-wide uppercase mb-3">{title}</div>
      {children}
    </div>
  );
}
