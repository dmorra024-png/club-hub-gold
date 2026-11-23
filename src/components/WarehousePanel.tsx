import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Warehouse, Store, ArrowLeftRight, History } from "lucide-react";
type Product = {id:string;name:string;stock:number;club_id:string};
type Balance = {product_id:string;location:"almacen"|"dispensario";quantity:number};
type Move = {id:string;product_id:string;from_location:string;to_location:string;quantity:number;created_at:string};
const fmt=(n:number)=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:2}).format(n);
const card="rounded-2xl border border-neon/25 bg-card/50 p-4 space-y-3";
export function WarehousePanel({products,onChange}:{products:Product[];onChange:()=>void}){
 const {access,can}=useAuth();
 const [balances,setBalances]=useState<Balance[]>([]);
 const [moves,setMoves]=useState<Move[]>([]);
 const [selected,setSelected]=useState("");
 const [quantity,setQuantity]=useState("");
 const [reverse,setReverse]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [loaded,setLoaded]=useState(false);
 const available=useMemo(()=>{
   const map=new Map<string,{almacen:number;dispensario:number}>();
   for(const p of products)map.set(p.id,{almacen:0,dispensario:0});
   for(const b of balances){const q=map.get(b.product_id);if(q)q[b.location]=Number(b.quantity);}
   return map;
 },[products,balances]);
 const item=products.find(p=>p.id===selected);
 const from=reverse?"dispensario":"almacen",to=reverse?"almacen":"dispensario";
 const source=item?(available.get(item.id)?.[from]??0):0;
 async function reload(){
   if(!access.clubId||!can("manage_products"))return;
   const [b,m]=await Promise.all([
    (supabase as any).from("snoop_stock_locations").select("product_id,location,quantity").eq("club_id",access.clubId).limit(1000),
    (supabase as any).from("snoop_stock_transfers").select("id,product_id,from_location,to_location,quantity,created_at").eq("club_id",access.clubId).order("created_at",{ascending:false}).limit(30),
   ]);
   if(b.error||m.error){setError("No se pudo cargar el inventario. Verifica el módulo.");setLoaded(true);return;}
   setBalances(b.data??[]);setMoves(m.data??[]);setLoaded(true);setError("");
 }
 useEffect(()=>{void reload();},[access.clubId,can("manage_products")]);
 async function send(){
   if(!item||busy)return;
   const clean=quantity.trim().replace(",",".");
   if(!/^\d{1,7}(\.\d{1,2})?$/.test(clean))return toast.error("Cantidad no válida (máximo 2 decimales)");
   const value=Number(clean);
   if(value<=0||value>source)return toast.error("Stock insuficiente en origen");
   if(!window.confirm("¿Trasladar "+fmt(value)+" de "+from+" a "+to+"?"))return;
   setBusy(true);
   const request=crypto.randomUUID();
   const {error:failure}=await (supabase as any).rpc("snoop_transfer_stock",{p_product_id:item.id,p_quantity:value,p_from:from,p_to:to,p_request_id:request});
   if(failure){setError("No se pudo completar el traslado. Comprueba las cantidades y vuelve a cargar.");}
   else {setQuantity("");toast.success("Traslado realizado");await reload();onChange();}
   setBusy(false);
 }
 if(!can("manage_products"))return null;
 return <div className="space-y-4">
  <div className={card}>
   <h2 className="font-display text-lg text-neon">Almacén y dispensario</h2>
   <p className="text-sm text-muted-foreground">Dos ubicaciones, un solo inventario. Trasladar no crea una venta ni modifica el stock total.</p>
   <div className="grid grid-cols-2 gap-3">
    <div className="rounded-xl border border-neon/20 p-3"><Warehouse className="text-neon mb-2"/><p>Almacén</p><p className="text-xs text-muted-foreground">Reserva</p></div>
    <div className="rounded-xl border border-neon/20 p-3"><Store className="text-neon mb-2"/><p>Dispensario</p><p className="text-xs text-muted-foreground">Disponible para pedidos</p></div>
   </div>
  </div>
  <div className={card}>
   <h3 className="flex items-center gap-2 font-display"><ArrowLeftRight className="text-neon"/> Trasladar producto</h3>
   <div className="grid grid-cols-2 gap-2">
    <button aria-pressed={!reverse} onClick={()=>setReverse(false)} className="rounded-xl border border-neon/30 p-3 text-xs">Almacén → Dispensario</button>
    <button aria-pressed={reverse} onClick={()=>setReverse(true)} className="rounded-xl border border-neon/30 p-3 text-xs">Devolver al almacén</button>
   </div>
   <select aria-label="Producto" value={selected} onChange={e=>setSelected(e.target.value)} className="w-full rounded-xl border border-neon/30 bg-input p-3">
    <option value="">Selecciona un producto</option>
    {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
   </select>
   {item&&<div className="grid grid-cols-3 gap-2 rounded-xl bg-background/40 p-3 text-center text-sm">
     <div>Almacén<strong className="block">{fmt(available.get(item.id)?.almacen??0)}</strong></div>
     <div>Dispensario<strong className="block">{fmt(available.get(item.id)?.dispensario??0)}</strong></div>
     <div>Total<strong className="block">{fmt(Number(item.stock))}</strong></div>
   </div>}
   <label className="block text-sm">Cantidad
    <input inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Ej. 20,00" className="mt-2 w-full rounded-xl border border-neon/30 bg-input p-3"/>
   </label>
   <p className="text-xs text-muted-foreground">Disponible en origen: {fmt(source)}</p>
   <button onClick={()=>void send()} disabled={!loaded||busy||!item||!quantity} className="w-full rounded-xl border border-neon bg-neon/10 p-3 font-display text-neon disabled:opacity-40">{busy?"Guardando…":"Confirmar traslado"}</button>
  </div>
  {error&&<p role="alert" className="text-destructive">{error}</p>}
  <div className={card}>
   <h3 className="flex items-center gap-2 font-display"><History className="text-neon"/> Últimos traslados</h3>
   {moves.length===0?<p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>:moves.map(m=><div key={m.id} className="flex justify-between gap-3 border-b border-border/50 py-2 text-sm">
    <div><b>{products.find(p=>p.id===m.product_id)?.name??"Producto"}</b><p className="text-xs text-muted-foreground">{m.from_location} → {m.to_location} · {new Date(m.created_at).toLocaleString("es-ES")}</p></div>
    <b>{fmt(Number(m.quantity))}</b>
   </div>)}
  </div>
 </div>;
}
