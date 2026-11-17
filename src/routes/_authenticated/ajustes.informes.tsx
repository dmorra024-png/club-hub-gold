import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { TrendingUp, TrendingDown, Euro, Package, ArrowRight, ArrowLeft as ArrowLeftIcon, Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ajustes/informes")({
  component: InformesPage,
});

const NEON = "#39FF14";
const NEON_DIM = "#1f6a13";
const RED = "#ef4444";
const PIE_COLORS = ["#39FF14", "#22d3ee", "#a855f7", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

type Range = "7d" | "30d" | "90d" | "365d";
const RANGES: { id: Range; label: string; days: number }[] = [
  { id: "7d", label: "7 días", days: 7 },
  { id: "30d", label: "30 días", days: 30 },
  { id: "90d", label: "90 días", days: 90 },
  { id: "365d", label: "1 año", days: 365 },
];

function InformesPage() {
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !isAdmin) nav({ to: "/" });
  }, [loading, isAdmin, nav]);

  const [range, setRange] = useState<Range>("30d");
  const [items, setItems] = useState<any[]>([]);
  const [movs, setMovs] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]);
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    const days = RANGES.find((r) => r.id === range)!.days;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    setDataLoading(true);
    (async () => {
      const [oi, sm, pr, ct, ci] = await Promise.all([
        supabase.from("order_items").select("*").gte("created_at", since),
        supabase.from("stock_movements").select("*").gte("created_at", since),
        supabase.from("products").select("id,name,stock,buy_price,sell_price,category_id"),
        supabase.from("product_categories").select("id,name,unit_type"),
        supabase.from("check_ins").select("id,direction,created_at,member_id").gte("created_at", since),
      ]);
      setItems(oi.data ?? []);
      setMovs(sm.data ?? []);
      setProducts(pr.data ?? []);
      setCats(ct.data ?? []);
      setCheckIns(ci.data ?? []);
      setDataLoading(false);
    })();
  }, [range, isAdmin]);

  const accessStats = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const today = checkIns.filter((c) => new Date(c.created_at) >= startToday);
    const inToday = today.filter((c) => c.direction === "in").length;
    const outToday = today.filter((c) => c.direction === "out").length;
    // Currently inside: last direction per member today
    const lastPerMember = new Map<string, string>();
    for (const c of [...today].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
      if (!lastPerMember.has(c.member_id)) lastPerMember.set(c.member_id, c.direction);
    }
    let insideNow = 0; lastPerMember.forEach((d) => { if (d === "in") insideNow++; });

    // Daily series
    const buckets = new Map<string, { day: string; entradas: number; salidas: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { day: key.slice(5), entradas: 0, salidas: 0 });
    }
    for (const c of checkIns) {
      const key = String(c.created_at).slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      if (c.direction === "in") b.entradas++; else b.salidas++;
    }
    return { inToday, outToday, insideNow, total: checkIns.length, daily: [...buckets.values()] };
  }, [checkIns, range]);

  const stats = useMemo(() => {
    const revenue = items.reduce((s, i) => s + Number(i.line_total_cents || 0), 0) / 100;
    const soldQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);
    const added = movs
      .filter((m) => Number(m.delta) > 0)
      .reduce((s, m) => s + Number(m.delta), 0);
    const removed = movs
      .filter((m) => Number(m.delta) < 0)
      .reduce((s, m) => s + Math.abs(Number(m.delta)), 0);
    return { revenue, soldQty, added, removed };
  }, [items, movs]);

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
    const days = RANGES.find((r) => r.id === range)!.days;
    const buckets = new Map<string, { day: string; revenue: number; qty: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { day: key.slice(5), revenue: 0, qty: 0 });
    }
    for (const it of items) {
      const key = String(it.created_at).slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      b.revenue += Number(it.line_total_cents || 0) / 100;
      b.qty += Number(it.quantity || 0);
    }
    return [...buckets.values()];
  }, [items, range]);

  // Movimientos por día (entradas / salidas por ventas o retiradas)
  const dailyMovs = useMemo(() => {
    const days = RANGES.find((r) => r.id === range)!.days;
    const buckets = new Map<string, { day: string; entradas: number; salidas: number }>();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { day: key.slice(5), entradas: 0, salidas: 0 });
    }
    for (const m of movs) {
      const key = String(m.created_at).slice(0, 10);
      const b = buckets.get(key);
      if (!b) continue;
      const d = Number(m.delta);
      if (d >= 0) b.entradas += d;
      else b.salidas += Math.abs(d);
    }
    return [...buckets.values()];
  }, [movs, range]);

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
          time: new Date(m.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
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
      { key: string; day: string; productName: string; added: number; removed: number; sold: number; totalAfter: number }
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
    return [...map.values()].sort((a, b) => b.day.localeCompare(a.day) || a.productName.localeCompare(b.productName));
  }, [movementRows]);

  if (loading || !isAdmin)
    return (
      <SnoopLayout>
        <div className="p-8 text-muted-foreground">Cargando…</div>
      </SnoopLayout>
    );

  return (
    <SnoopLayout title="Informes" subtitle="Estadísticas de stock y ventas">
      {/* Range selector */}
      <div className="flex flex-wrap gap-2 mb-6">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border transition ${
              range === r.id
                ? "border-neon text-neon bg-neon/10"
                : "border-border text-muted-foreground hover:text-neon hover:border-neon/40"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {dataLoading ? (
        <div className="text-muted-foreground">Calculando…</div>
      ) : (
        <div className="space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi icon={Euro} label="Ingresos" value={`€${stats.revenue.toFixed(2)}`} tint="neon" />
            <Kpi
              icon={Package}
              label="Vendido"
              value={`${stats.soldQty.toFixed(2)}`}
              tint="neon"
            />
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
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon-dim mb-3">Control de acceso</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
              <Kpi icon={Users} label="Dentro ahora" value={String(accessStats.insideNow)} tint="neon" />
              <Kpi icon={ArrowRight} label="Entradas hoy" value={String(accessStats.inToday)} tint="neon" />
              <Kpi icon={ArrowLeftIcon} label="Salidas hoy" value={String(accessStats.outToday)} tint="red" />
              <Kpi icon={Users} label={`Total accesos (${range})`} value={String(accessStats.total)} tint="neon" />
            </div>
            <ChartCard title="Entradas y salidas por día">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={accessStats.daily}>
                  <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                  <XAxis dataKey="day" stroke="#888" fontSize={10} />
                  <YAxis stroke="#888" fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #39FF14" }} />
                  <Legend />
                  <Bar dataKey="entradas" fill={NEON} name="Entradas" />
                  <Bar dataKey="salidas" fill={RED} name="Salidas" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Ventas diarias */}
          <ChartCard title="Ingresos por día">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily}>
                <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#888" fontSize={11} />
                <YAxis stroke="#888" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: `1px solid ${NEON}` }}
                  labelStyle={{ color: NEON }}
                  formatter={(v: any) => [`€${Number(v).toFixed(2)}`, "Ingresos"]}
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={NEON}
                  strokeWidth={2}
                  dot={false}
                />
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
                  <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#888" fontSize={11} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="#888"
                    fontSize={11}
                    width={110}
                  />
                  <Tooltip
                    contentStyle={{ background: "#0a0a0a", border: `1px solid ${NEON}` }}
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
                <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#888" fontSize={11} />
                <YAxis stroke="#888" fontSize={11} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: `1px solid ${NEON}` }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="entradas" fill={NEON} name="Entradas" />
                <Bar dataKey="salidas" fill={RED} name="Salidas" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Histórico diario por producto">
            {dailyProductHistory.length === 0 ? (
              <div className="text-xs text-muted-foreground">Sin movimientos de stock en este periodo.</div>
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
                        <td className="py-2 text-right text-neon font-mono">+{row.added.toFixed(2)}</td>
                        <td className="py-2 text-right text-destructive font-mono">-{row.sold.toFixed(2)}</td>
                        <td className="py-2 text-right text-destructive/80 font-mono">-{row.removed.toFixed(2)}</td>
                        <td className="py-2 text-right text-foreground font-mono">{row.totalAfter.toFixed(2)}</td>
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
                  <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg bg-input/35 border border-border/60 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground truncate">{row.productName}</div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {row.day} · {row.time} · {movementLabel(row.reason)}
                      </div>
                      {row.notes && <div className="text-[10px] text-muted-foreground truncate">{row.notes}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-display text-sm ${row.delta >= 0 ? "text-neon" : "text-destructive"}`}>
                        {row.delta >= 0 ? "+" : ""}{row.delta.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">total {row.totalAfter.toFixed(2)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          {/* Ingresos por categoría */}
          {byCategory.length > 0 && (
            <ChartCard title="Ingresos por categoría">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={byCategory}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={90}
                    label={(e: any) => `${e.name}: €${Number(e.value).toFixed(0)}`}
                  >
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#0a0a0a", border: `1px solid ${NEON}` }}
                    formatter={(v: any) => [`€${Number(v).toFixed(2)}`, "Ingresos"]}
                  />
                </PieChart>
              </ResponsiveContainer>
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
                    <span className="text-destructive font-mono">
                      {Number(p.stock).toFixed(2)}
                    </span>
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
    <div className="bg-card/60 border border-neon/20 rounded-2xl p-4">
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
    <div className="bg-card/60 border border-neon/20 rounded-2xl p-4 sm:p-5">
      <div className="font-display text-sm text-neon tracking-wide uppercase mb-3">{title}</div>
      {children}
    </div>
  );
}
