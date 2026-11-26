import { useEffect, useState } from "react";
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
  const [focusId,setFocusId]=useState("");
  const [direction,setDirection]=useState<"almacen"|"dispensario">("almacen");
  const [quantity,setQuantity]=useState("");
  const [confirm,setConfirm]=useState(false);
  const [request,setRequest]=useState<string|null>(null);
  const current=products.find(p=>p.id===selected);
  const focusProduct=products.find(p=>p.id===focusId)??products[0];
  const read=(p:Product|undefined,location:string)=>p?Number(balances.find(b=>b.product_id===p.id&&b.location===location)?.quantity??0):0;
  const reserve=current?read(current,"almacen"):0;
  const dispensary=current?read(current,"dispensario"):0;

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
    setFocusId(p.id);setSelected(p.id);setDirection(from);setQuantity("");setConfirm(false);setRequest(null);setError("");
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
    <div className="space-y-2">
      <label htmlFor="warehouse-product-selection" className="block text-sm font-semibold text-foreground">
        1. Selecciona un producto
      </label>
      <select id="warehouse-product-selection" className={field} value={focusProduct?.id??""}
        onChange={e=>{setFocusId(e.target.value);setSelected("");setConfirm(false);setQuantity("");setRequest(null);}}>
        {products.length===0&&<option value="">No hay productos</option>}
        {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
    {error&&<p role="alert" className="rounded-xl border border-destructive/50 bg-card/60 p-3 text-xs text-destructive">{error}</p>}
    {focusProduct&&!error&&<div className="space-y-3" aria-live="polite">
      <p className="text-xs text-muted-foreground">
        Cantidades de <b className="text-foreground">{focusProduct.name}</b> · {unitForProduct(focusProduct)==="gr"?"gramos (g)":"unidades (u)"}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {([
          {label:"Almacén",value:read(focusProduct,"almacen"),Icon:Warehouse,detail:"Reserva"},
          {label:"Dispensario",value:read(focusProduct,"dispensario"),Icon:Store,detail:"Para dispensar"},
          {label:"Total",value:Number(focusProduct.stock),Icon:PackageCheck,detail:"Suma de ambos"},
        ] as const).map(({label,value,Icon,detail})=>
          <div key={label} className={`${card} min-w-0 px-2 py-3 sm:px-4`}>
            <Icon size={19} className="mb-2 text-neon" aria-hidden="true"/>
            <p className="text-xs font-semibold text-foreground">{label}</p>
            <p className="mt-1 break-words font-display text-lg sm:text-xl">{loading?"…":fmt(value)} <span className="text-xs">{unitForProduct(focusProduct)==="gr"?"g":"u"}</span></p>
            <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        El total es Almacén + Dispensario. Un traspaso mueve la cantidad de un lugar a otro sin cambiar el total.
      </p>
      {!loading&&Math.abs(read(focusProduct,"almacen")+read(focusProduct,"dispensario")-Number(focusProduct.stock))>=0.0001&&
        <p role="alert" className="text-xs text-destructive">Las cantidades no coinciden. Bloqueado hasta revisar el inventario.</p>}
      <button type="button" className="flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-neon/60 bg-neon/10 px-4 py-3 text-sm font-display text-neon disabled:opacity-40"
        disabled={loading||Math.abs(read(focusProduct,"almacen")+read(focusProduct,"dispensario")-Number(focusProduct.stock))>=0.0001}
        onClick={()=>start(focusProduct,read(focusProduct,"almacen")>0?"almacen":"dispensario")}>
        <ArrowLeftRight size={18}/> 2. Traspasar entre Almacén y Dispensario
      </button>
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
