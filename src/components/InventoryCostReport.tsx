import { useEffect, useState } from "react";
import { CalendarDays, RefreshCw, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { madridToday } from "@/lib/member-administration";
import {InventoryCostReportData} from "@/lib/inventory-report";

type CostLine = {
 id:string;name:string;opening_qty:number;incoming_qty:number;outgoing_qty:number;
 closing_qty:number;cost:number|null;sale_price:number|null;product_cost_eur:number;expected_sale_eur:number;expected_profit_eur:number;unpriced:boolean;unpriced_sale:boolean;
};
type Report = {
 day:string;start_at:string;end_at:string;cost_basis:string;
 opening_eur:number;incoming_eur:number;outgoing_eur:number;closing_eur:number;
 opening_sale_eur:number;incoming_sale_eur:number;outgoing_sale_eur:number;
 closing_sale_eur:number;closing_expected_profit_eur:number;missing_sale_price:number;
 missing_cost:number;invalid_quantities:number;lines:CostLine[];
};
const eur=(n:number)=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n);
const dateLabel=(d:string)=>new Intl.DateTimeFormat("es-ES",{timeZone:"Europe/Madrid",day:"2-digit",month:"long",year:"numeric"}).format(new Date(d+"T12:00:00Z"));
export function InventoryCostReport({clubId}:{clubId:string}){
 const [day,setDay]=useState(()=>madridToday());
 const [report,setReport]=useState<Report|null>(null);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [revision,setRevision]=useState(0);
 const [expanded,setExpanded]=useState(false);
 useEffect(()=>{
  let active=true;
  setLoading(true);setError("");setReport(null);
  void (async()=>{
    const {data,error}=await (supabase as any).rpc("snoop_inventory_cost_report",{p_day:day});
    if(!active)return;
    const checked=InventoryCostReportData.safeParse(data);
    if(error||!checked.success){setError("No se ha podido verificar el valor del inventario. Vuelve a intentarlo.");}
    else setReport(checked.data);
    setLoading(false);
  })();
  return ()=>{active=false};
 },[clubId,day,revision]);
 useEffect(()=>{
  const reload=()=>setRevision(v=>v+1);
  const onVisible=()=>{if(document.visibilityState==="visible")reload();};
  const interval=setInterval(()=>{if(document.visibilityState==="visible"&&day===madridToday())reload();},45000);
  document.addEventListener("visibilitychange",onVisible);
  return ()=>{clearInterval(interval);document.removeEventListener("visibilitychange",onVisible);};
 },[day]);
 return <section className="rounded-2xl border border-neon/35 bg-card/60 p-4 sm:p-5 space-y-4" aria-label="Valor del inventario">
  <div className="flex flex-wrap items-start justify-between gap-3">
   <div>
    <p className="text-[10px] uppercase tracking-widest text-neon-dim">Informes · Mercancía</p>
    <h2 className="font-display text-xl text-foreground">Valor del inventario</h2>
    <p className="text-xs text-muted-foreground">Solo productos con stock: gramos o unidades × precio de venta.</p>
   </div>
   <button type="button" disabled={loading} onClick={()=>setRevision(v=>v+1)}
    className="flex min-h-11 items-center gap-2 rounded-xl border border-neon/30 px-3 text-xs text-foreground disabled:opacity-50">
     <RefreshCw size={15}/> Actualizar
   </button>
  </div>
  <label className="flex flex-wrap items-center gap-3 text-sm">
   <span className="inline-flex items-center gap-2 font-medium"><CalendarDays size={17}/> Fecha del informe</span>
   <input type="date" aria-label="Fecha para valorar inventario al inicio del día" max={madridToday()}
    value={day} onChange={e=>{if(e.target.value&&e.target.value<=madridToday())setDay(e.target.value);}}
    className="min-h-11 rounded-xl border border-neon/30 bg-input px-3 text-foreground"/>
  </label>
  <p className="text-xs text-muted-foreground">Desde las 00:00 del {dateLabel(day)} (hora de España) {day===madridToday()?"hasta ahora":"hasta las 00:00 del día siguiente"}.</p>
  {loading&&<p role="status" className="text-sm text-muted-foreground">Calculando valor al inicio del día y movimientos…</p>}
  {error&&<p role="alert" className="rounded-xl border border-destructive/40 p-3 text-xs text-destructive">{error}</p>}
  {!loading&&report&&<>
   <div className="rounded-2xl border-2 border-neon/50 bg-neon/10 p-5 space-y-2" aria-label="Valor principal de la mercancía del club">
    <p className="text-xs font-display uppercase tracking-wider text-neon">VALOR DE VENTA DEL STOCK DEL CLUB</p>
    <p className="font-display text-4xl text-foreground" data-testid="inventory-sale-value">{report.missing_sale_price||report.invalid_quantities?"—":eur(Number(report.closing_sale_eur))}</p>
    <p className="text-xs text-muted-foreground">Solo productos activos con stock · gramos o unidades × precio de venta · {day===madridToday()?"ahora":"cierre del día seleccionado"}. No es dinero ya cobrado.</p>
   </div>
   <div className="rounded-xl border border-neon/25 bg-input/25 p-4">
    <p className="text-xs text-muted-foreground">Valor de venta al inicio del día · 00:00</p>
    <p className="mt-1 font-display text-3xl text-foreground" data-testid="inventory-opening-eur">{eur(Number(report.opening_sale_eur))}</p>
   </div>
   <div className="rounded-xl border border-neon/25 bg-input/20 p-4 space-y-1">
    <p className="text-xs text-muted-foreground">Variación neta del valor del stock {day===madridToday()?"hoy":"en la fecha elegida"}</p>
    <p className="font-display text-xl text-foreground" data-testid="inventory-net-change">{report.missing_sale_price||report.invalid_quantities?"—":eur(Number(report.closing_sale_eur)-Number(report.opening_sale_eur))}</p>
    <p className="text-xs text-muted-foreground">Valor final menos valor inicial. Los pedidos anulados y sus devoluciones se compensan; no son ingresos de Caja.</p>
   </div>
   <div className="rounded-xl border border-neon/40 bg-neon/5 p-4 space-y-3">
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Warehouse size={16}/> Costo y margen estimado del inventario</p>
    <div className="grid grid-cols-2 gap-3 border-t border-neon/20 pt-3">
     <div><p className="text-xs text-muted-foreground">Coste teórico (P. compra configurado)</p><p className="font-display text-xl text-foreground" data-testid="inventory-product-cost">{report.missing_cost||report.invalid_quantities?"—":eur(Number(report.closing_eur))}</p></div>
     <div><p className="text-xs text-muted-foreground">Margen teórico previsto</p><p className="font-display text-xl text-neon" data-testid="inventory-expected-profit">{report.missing_cost||report.missing_sale_price||report.invalid_quantities?"—":eur(Number(report.closing_expected_profit_eur))}</p></div>
    </div>
    <p className="text-xs text-muted-foreground">Valor de venta = cantidad restante × P. venta. El coste teórico se calcula con P. compra; <b>no es dinero realmente pagado</b> sin facturas o registros de compras. El margen tampoco es beneficio neto ni dinero cobrado.</p>
   </div>
   {report.missing_sale_price>0&&<p role="alert" className="rounded-xl border border-amber-500/35 p-3 text-xs">Falta el precio de dispensación en {report.missing_sale_price} productos: la ganancia estimada no está disponible.</p>}
   {report.missing_cost>0&&<p role="alert" className="rounded-xl border border-amber-500/35 p-3 text-xs">
    Faltan precios de compra en {report.missing_cost} productos con movimientos o existencias. Los importes son parciales y podrían ser inferiores al valor real.
   </p>}
   {report.invalid_quantities>0&&<p role="alert" className="rounded-xl border border-destructive/40 p-3 text-xs text-destructive">
    Hay {report.invalid_quantities} productos con cantidades históricas inconsistentes. Revisa el historial de stock antes de usar esta valoración.
   </p>}
   <p className="text-xs text-muted-foreground">
    <b>Importante:</b> se usan los precios de compra y venta <b>configurados actualmente</b>. No se conocen aquí facturas pagadas ni los precios históricos por lote. El coste no equivale a dinero gastado.
   </p>
   <details className="rounded-xl border border-neon/20 p-3" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-semibold">Ver productos con stock ({report.lines.length})</summary>
    <div className="mt-3 space-y-2">
     {report.lines.map(l=><div key={l.id} className="border-t border-border/40 pt-2 text-xs">
      <p className="font-semibold">{l.name}{l.unpriced?" · Sin precio de compra":""}</p>
      <p className="text-muted-foreground">Inicio {l.opening_qty} · +{l.incoming_qty} · −{l.outgoing_qty} · Final {l.closing_qty}</p>
      <p className="text-muted-foreground">Precio de compra: {l.cost!=null?eur(Number(l.cost)):"—"} / unidad · Precio de dispensación: {l.sale_price!=null?eur(Number(l.sale_price)):"—"} / unidad</p>
      <p className="text-muted-foreground">Valor venta: {l.unpriced_sale?"—":eur(Number(l.expected_sale_eur))} · Coste teórico: {l.unpriced?"—":eur(Number(l.product_cost_eur))} · Margen previsto: {l.unpriced||l.unpriced_sale?"—":eur(Number(l.expected_profit_eur))}</p>
     </div>)}
    </div>
   </details>
  </>}
 </section>;
}
