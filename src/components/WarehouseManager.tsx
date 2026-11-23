import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Warehouse, Store, PackageCheck, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Product = { id: string; name: string; stock: number; category_id: string };
type Location = { product_id: string; location: string; quantity: number };
type Transfer = { id: string; product_id: string; from_location: string; to_location: string; quantity: number; created_at: string };
const fmt=(n:number)=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:3}).format(n);
const card="rounded-2xl border border-neon/25 bg-card/55 p-4";
const field="w-full rounded-xl border border-neon/25 bg-input/50 px-3 py-3 text-sm text-foreground focus:border-neon outline-none";
function parseQuantity(raw:string,unit:string) {
  if(!/^\d{1,7}([.,]\d{1,3})?$/.test(raw.trim()))throw Error("Introduce una cantidad válida.");
  const n=Number(raw.trim().replace(",","."));
  if(n<=0||n>1000000||(!Number.isInteger(n)&&unit!=="gr"))throw Error("Cantidad no válida para esta categoría.");
  return n;
}
/** The existing products.stock remains authoritative TOTAL; the order flow is unchanged.
 * The database controls both location balances and records transfers atomically.
 */
export function WarehouseManager({
  products, clubId, unitForProduct, onChange,
}:{
  products:Product[]; clubId:string; unitForProduct:(p:Product)=>string; onChange:()=>void;
}) {
  const [balances,setBalances]=useState<Location[]>([]);
  const [transfers,setTransfers]=useState<Transfer[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [selected,setSelected]=useState("");
  const [view,setView]=useState<"all"|"almacen"|"dispensario">("all");
  const [direction,setDirection]=useState<"almacen"|"dispensario">("almacen");
  const [quantity,setQuantity]=useState("");
  const [confirm,setConfirm]=useState(false);
  const [request,setRequest]=useState<string|null>(null);
  const current=products.find(p=>p.id===selected);
  const read=(p:Product|undefined,location:string)=>p?Number(balances.find(b=>b.product_id===p.id&&b.location===location)?.quantity??0):0;
  const reserve=current?read(current,"almacen"):0;
  const dispensary=current?read(current,"dispensario"):0;
  const sum=useMemo(()=>products.reduce((n,p)=>n+Number(p.stock),0),[products]);
  const reserveSum=useMemo(()=>balances.filter(x=>x.location==="almacen").reduce((n,x)=>n+Number(x.quantity),0),[balances]);
  const load=async()=>{
    setLoading(true);setError("");
    const [b,t]=await Promise.all([
      supabase.from("snoop_stock_locations" as any).select("product_id,location,quantity").eq("club_id",clubId).limit(2000),
      supabase.from("snoop_stock_transfers" as any).select("id,product_id,from_location,to_location,quantity,created_at").eq("club_id",clubId).order("created_at",{ascending:false}).limit(30)
    ]);
    if(b.error||t.error){setError("No se pudo consultar el inventario por ubicación.");}
    else{
      setBalances((b.data??[]) as unknown as Location[]);
      setTransfers((t.data??[]) as unknown as Transfer[]);
    }
    setLoading(false);
  };
  useEffect(()=>{void load();},[clubId,products.map(p=>p.id+":"+p.stock).join("|")]);
  const start=(p:Product,from:"almacen"|"dispensario")=>{
    setSelected(p.id);setDirection(from);setQuantity("");setConfirm(false);setRequest(null);setError("");
  };
  const save=async()=>{
    if(!current||busy)return;
    let qty:number;
    try {qty=parseQuantity(quantity,unitForProduct(current));}catch(e){return toast.error((e as Error).message);}
    const from=direction,to=direction==="almacen"?"dispensario":"almacen";
    if(qty>read(current,from))return toast.error("No hay suficiente stock en origen.");
    if(!confirm){setConfirm(true);return;}
    setBusy(true);
    const id=request??crypto.randomUUID();
    setRequest(id);
    const {data,error:rpcError}=await (supabase as any).rpc("snoop_transfer_stock",{
      p_product_id:current.id,p_quantity:qty,p_from:from,p_to:to,p_request_id:id
    });
    setBusy(false);
    if(rpcError){setError("No se confirmó el traspaso. Puedes reintentar con la misma solicitud sin duplicarlo.");return;}
    toast.success(data?.status==="already_applied"?"Traspaso ya registrado":"Traspaso realizado");
    setSelected("");setQuantity("");setConfirm(false);setRequest(null);
    await load();onChange();
  };
  return <section className="space-y-4" aria-label="Almacén y dispensario">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="font-display text-lg text-neon">Inventario por ubicación</h3>
        <p className="text-xs text-muted-foreground">Reserva y dispensario, un único stock del club.</p>
      </div>
      <button type="button" className="rounded-xl border border-neon/30 px-3 py-2 text-xs" onClick={()=>void load()}>Actualizar</button>
    </div>
    <div className="grid grid-cols-3 gap-2">
      {([
        {key:"all",label:"Total",Icon:PackageCheck,quantity:sum},
        {key:"almacen",label:"Almacén",Icon:Warehouse,quantity:reserveSum},
        {key:"dispensario",label:"Dispensario",Icon:Store,quantity:balances.filter(x=>x.location==="dispensario").reduce((n,x)=>n+Number(x.quantity),0)},
      ] as const).map(({key,label,Icon,quantity})=>
        <button type="button" key={key}
          onClick={()=>setView(key)}
          aria-pressed={view===key}
          aria-label={`Ver stock: ${label}`}
          className={`${card} min-w-0 cursor-pointer text-left touch-manipulation transition-colors ${view===key?"border-neon bg-neon/15 ring-1 ring-neon":"hover:border-neon/60"}`}>
          <Icon size={18} className="text-neon" aria-hidden="true"/>
          <span className="mt-1 block text-[11px] text-muted-foreground">{label}</span>
          <span className="block font-display text-lg">{loading?"…":fmt(quantity)}</span>
        </button>
      )}
    </div>
    <p role="status" className="text-xs text-neon">Vista seleccionada: {view==="all"?"Stock total":view==="almacen"?"Almacén":"Dispensario"}</p>
    {error&&<p role="alert" className="rounded-xl border border-destructive/50 bg-card/60 p-3 text-xs text-destructive">{error}</p>}
    {!loading&&!error&&<div className="space-y-2">
      {products.filter(p=>view==="all"||read(p,view)>0).map(p=>{
        const a=read(p,"almacen"),d=read(p,"dispensario");
        const valid=Math.abs(a+d-Number(p.stock))<0.0001;
        return <div key={p.id} className="rounded-xl border border-neon/20 bg-card/50 p-3">
          <div className="flex justify-between gap-2"><b className="truncate text-sm">{p.name}</b><span className="shrink-0 text-xs text-muted-foreground">Total {fmt(Number(p.stock))} {unitForProduct(p)==="gr"?"g":"u"}</span></div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-input/30 p-2"><span className="text-muted-foreground">Almacén</span><p className="mt-1 font-display text-base">{fmt(a)}</p></div><div className="rounded-lg bg-input/30 p-2"><span className="text-muted-foreground">Dispensario</span><p className="mt-1 font-display text-base">{fmt(d)}</p></div></div>
          {!valid&&<p role="alert" className="mt-2 text-xs text-destructive">Diferencia de inventario: traspasos bloqueados hasta verificar.</p>}
          <button type="button" className="mt-2 inline-flex items-center gap-2 rounded-lg border border-neon/50 px-3 py-2 text-xs text-neon disabled:opacity-40" disabled={!valid} onClick={()=>start(p,a>0?"almacen":"dispensario")}><ArrowLeftRight size={14}/> Traspasar</button>
        </div>;
      })}
    </div>}
    {current&&<div role="dialog" aria-modal="false" aria-label="Traspasar inventario" className="rounded-2xl border-2 border-neon/55 bg-card/90 p-4 space-y-3">
      <h4 className="font-display text-base text-neon">Traspasar · {current.name}</h4>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={"rounded-xl border p-3 text-xs "+(direction==="almacen"?"border-neon bg-neon/10":"border-border")} onClick={()=>{setDirection("almacen");setConfirm(false);setRequest(null);}}>Almacén → Dispensario</button>
        <button type="button" className={"rounded-xl border p-3 text-xs "+(direction==="dispensario"?"border-neon bg-neon/10":"border-border")} onClick={()=>{setDirection("dispensario");setConfirm(false);setRequest(null);}}>Dispensario → Almacén</button>
      </div>
      <p className="text-xs text-muted-foreground">Disponible en origen: {fmt(direction==="almacen"?reserve:dispensary)} {unitForProduct(current)==="gr"?"g":"u"}</p>
      <input className={field} aria-label="Cantidad a traspasar" inputMode="decimal" placeholder="Cantidad (por ejemplo 20)" value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirm(false);setRequest(null);}}/>
      {confirm&&<p className="rounded-xl border border-neon/30 p-3 text-sm">Confirma: mover <b>{quantity} {unitForProduct(current)==="gr"?"g":"u"}</b> de {direction==="almacen"?"Almacén a Dispensario":"Dispensario a Almacén"}. El total no cambia.</p>}
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={()=>void save()} className="flex-1 rounded-xl bg-gradient-neon p-3 text-xs font-display text-primary-foreground">{busy?"Guardando…":confirm?"Confirmar traspaso":"Continuar"}</button><button type="button" disabled={busy} onClick={()=>{setSelected("");setConfirm(false);setRequest(null);}} className="rounded-xl border border-border px-4 text-xs">Cancelar</button></div>
    </div>}
    {transfers.length>0&&<details className={card}><summary className="cursor-pointer text-sm font-display"><History size={15} className="mr-2 inline"/>Historial de traspasos</summary><div className="mt-3 space-y-2">{transfers.map(t=><p key={t.id} className="border-t border-border/30 pt-2 text-xs text-muted-foreground"><b className="text-foreground">{products.find(p=>p.id===t.product_id)?.name??"Producto"}</b> · {fmt(Number(t.quantity))} · {t.from_location} → {t.to_location} · {new Date(t.created_at).toLocaleString("es-ES")}</p>)}</div></details>}
  </section>;
}
