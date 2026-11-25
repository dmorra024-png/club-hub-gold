import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, RefreshCw, Coins } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { madridToday } from "@/lib/member-administration";

type Recharge={date:string;quantity:number;reason:string};
type ProductEconomics={
 id:string;name:string;unit:string;buy_price:number|null;sell_price:number|null;
 loaded_qty:number;recharge_count:number;loaded_cost:number;
 projected_loaded_revenue:number;projected_gross_margin:number;
 dispensed_qty:number;actual_revenue:number;actual_gross_margin:number;
 remaining_qty:number;remaining_revenue:number;remaining_cost:number;
 missing_buy:boolean;missing_sell:boolean;invalid_stock:boolean;recharges:Recharge[];
};
type Totals={
 loaded_cost:number;projected_loaded_revenue:number;projected_loaded_gross_margin:number;
 actual_revenue:number;actual_gross_margin:number;remaining_revenue:number;
 remaining_cost:number;missing_buy:number;missing_sell:number;invalid_stock:number;
};
type Report={day:string;as_of:string;basis:string;totals:Totals;products:ProductEconomics[]};
const eur=(n:number)=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const qty=(n:number)=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:3}).format(Number(n)||0);
const datetime=(s:string)=>new Intl.DateTimeFormat("es-ES",{timeZone:"Europe/Madrid",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(s));
const metric="rounded-xl border border-neon/20 bg-input/20 p-3";

export function ProductEconomicsReport({clubId}:{clubId:string}) {
 const [day,setDay]=useState(()=>madridToday());
 const [selected,setSelected]=useState("");
 const [report,setReport]=useState<Report|null>(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
   let alive=true;
   setLoading(true);setError("");setReport(null);
   void (async()=>{
     const {data,error:e}=await (supabase as any).rpc("snoop_product_economics_report",{p_day:day});
     if(!alive)return;
     if(e||!data)setError("No se pudieron calcular los informes por producto.");
     else setReport(data as Report);
     setLoading(false);
   })();
   return ()=>{alive=false};
 },[clubId,day,refresh]);
 useEffect(()=>{
   const onFocus=()=>{if(document.visibilityState==="visible"&&day===madridToday())setRefresh(v=>v+1);};
   document.addEventListener("visibilitychange",onFocus);
   const interval=setInterval(()=>{if(document.visibilityState==="visible"&&day===madridToday())setRefresh(v=>v+1);},60000);
   return ()=>{document.removeEventListener("visibilitychange",onFocus);clearInterval(interval)};
 },[day]);
 const current=useMemo(()=>report?.products.find(p=>p.id===selected)??null,[report,selected]);
 const totals=report?.totals;
 const incomplete=!!totals&&(totals.missing_buy>0||totals.missing_sell>0||totals.invalid_stock>0);
 return <section className="space-y-4 rounded-2xl border border-neon/30 bg-card/60 p-4 sm:p-5" aria-label="Rentabilidad por producto">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div><p className="text-[10px] uppercase tracking-wider text-neon-dim">Informes · Productos</p>
      <h2 className="font-display text-xl text-foreground">Rentabilidad por producto</h2>
      <p className="text-xs text-muted-foreground">Entradas, ingresos registrados y margen previsto, para cualquier fecha.</p>
    </div>
    <button type="button" onClick={()=>setRefresh(v=>v+1)} disabled={loading} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-neon/35 px-3 text-xs disabled:opacity-50"><RefreshCw size={16}/> Actualizar</button>
   </div>
   <label className="flex flex-wrap items-center gap-3 text-sm font-medium">
    <CalendarDays size={17}/> Consultar hasta el día
    <input className="min-h-11 rounded-xl border border-neon/35 bg-input px-3" aria-label="Fecha de corte del informe por producto"
      type="date" max={madridToday()} value={day}
      onChange={e=>{if(e.target.value&&e.target.value<=madridToday())setDay(e.target.value);}}/>
   </label>
   <p className="text-xs text-muted-foreground">Corte: {day===madridToday()?"hoy hasta ahora":"final del día seleccionado"}, horario de Madrid. Las entradas muestran cuándo se registró cada alta o ajuste positivo.</p>
   {loading&&<p role="status" className="text-sm text-muted-foreground">Consultando productos y movimientos…</p>}
   {error&&<p role="alert" className="rounded-xl border border-destructive/50 p-3 text-sm text-destructive">{error}</p>}
   {!loading&&totals&&report&&<>
      <div className="rounded-xl border border-neon/40 bg-neon/5 p-4 space-y-2">
       <div className="flex items-center gap-2"><Coins size={20} className="text-neon"/><h3 className="font-display text-sm">Total del club</h3></div>
       <div className="grid grid-cols-2 gap-3">
        <div><p className="text-xs text-muted-foreground">Coste de entradas registradas</p><p className="font-display text-xl">{eur(totals.loaded_cost)}</p></div>
        <div><p className="text-xs text-muted-foreground">Valor previsto de lo cargado</p><p className="font-display text-xl">{eur(totals.projected_loaded_revenue)}</p></div>
        <div><p className="text-xs text-muted-foreground">Ingresos registrados hasta la fecha</p><p className="font-display text-xl">{eur(totals.actual_revenue)}</p></div>
        <div><p className="text-xs text-muted-foreground">Valor previsto del stock restante</p><p className="font-display text-xl">{eur(totals.remaining_revenue)}</p></div>
       </div>
       <div className="border-t border-neon/20 pt-3"><p className="text-xs text-muted-foreground">Margen bruto previsto de todas las entradas</p><p className="font-display text-2xl text-neon">{eur(totals.projected_loaded_gross_margin)}</p></div>
       <p className="text-xs text-muted-foreground">Margen bruto registrado estimado: {eur(totals.actual_gross_margin)}. No es beneficio neto: no descuenta alquiler, salarios, suministros, mermas ni impuestos.</p>
      </div>
      {incomplete&&<p role="alert" className="rounded-xl border border-amber-500/40 p-3 text-xs">Informe orientativo: {totals.missing_buy} productos sin coste de compra, {totals.missing_sell} sin precio de dispensación, {totals.invalid_stock} con diferencias históricas. Completa o revisa estos datos antes de utilizar los totales.</p>}
      <label className="block space-y-2 text-sm font-medium">
       Ver informe individual
       <div className="relative">
        <select className="min-h-12 w-full appearance-none rounded-xl border border-neon/40 bg-input px-4 pr-10 text-foreground"
         value={selected} onChange={e=>setSelected(e.target.value)}>
         <option value="">Selecciona un producto</option>
         {report.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select><ChevronDown size={18} className="pointer-events-none absolute right-3 top-4 text-neon"/>
       </div>
      </label>
      {current&&<div className="space-y-3 rounded-2xl border border-neon/30 bg-input/10 p-3 sm:p-4">
        <h3 className="font-display text-base text-neon">{current.name}</h3>
        <p className="text-xs text-muted-foreground">Precio compra: {eur(Number(current.buy_price??0))} / {current.unit==="gr"?"g":"u"} · Precio dispensación: {eur(Number(current.sell_price??0))} / {current.unit==="gr"?"g":"u"}</p>
        <div className="grid grid-cols-2 gap-2">
         <div className={metric}><p className="text-xs text-muted-foreground">Cantidad cargada hasta la fecha</p><p className="font-display text-lg">{qty(current.loaded_qty)} {current.unit==="gr"?"g":"u"}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Coste estimado de las entradas</p><p className="font-display text-lg">{eur(current.loaded_cost)}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Total esperado de lo cargado</p><p className="font-display text-lg">{eur(current.projected_loaded_revenue)}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Margen bruto previsto</p><p className="font-display text-lg text-neon">{eur(current.projected_gross_margin)}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Dispensado hasta la fecha</p><p className="font-display text-lg">{qty(current.dispensed_qty)} {current.unit==="gr"?"g":"u"}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Ingresos registrados hasta la fecha</p><p className="font-display text-lg">{eur(current.actual_revenue)}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Cantidad restante</p><p className="font-display text-lg">{qty(current.remaining_qty)} {current.unit==="gr"?"g":"u"}</p></div>
         <div className={metric}><p className="text-xs text-muted-foreground">Valor previsto aún dispensable</p><p className="font-display text-lg">{eur(current.remaining_revenue)}</p></div>
        </div>
        <p className="text-xs text-muted-foreground">Margen bruto realizado estimado: {eur(current.actual_gross_margin)} (ingresos registrados menos coste estimado del dispensado).</p>
        {(current.missing_buy||current.missing_sell||current.invalid_stock)&&<p role="alert" className="text-xs text-destructive">Hay datos incompletos o inconsistentes. Los importes pueden ser incorrectos.</p>}
        <details className="rounded-xl border border-neon/25 p-3">
         <summary className="cursor-pointer text-sm font-semibold">Fechas de carga y recargas ({current.recharge_count})</summary>
         <p className="mt-2 text-xs text-muted-foreground">Se incluyen altas iniciales y ajustes positivos del stock. Un ajuste no certifica por sí solo una compra pagada.</p>
         {current.recharges.length===0?<p className="mt-3 text-xs text-muted-foreground">No hay entradas registradas hasta la fecha seleccionada.</p>:<div className="mt-3 space-y-2">{current.recharges.map((r,i)=><div key={r.date+"-"+i} className="flex items-center justify-between border-t border-border/50 pt-2 text-xs"><span>{datetime(r.date)}</span><span className="font-semibold">+{qty(r.quantity)} {current.unit==="gr"?"g":"u"}</span></div>)}</div>}
         {current.recharge_count>current.recharges.length&&<p className="mt-2 text-xs text-muted-foreground">Mostrando las últimas 50 entradas.</p>}
        </details>
      </div>}
      <p className="text-[11px] text-muted-foreground">Ingresos = importes de líneas de pedidos actualmente completados hasta la fecha, no verificación bancaria del cobro. Los pedidos cancelados se excluyen según su estado actual. Los márgenes previstos utilizan precios de compra y dispensación actuales; no hay aún costes históricos por lote. No equivale a beneficio neto contable.</p>
   </>}
  </section>;
}
