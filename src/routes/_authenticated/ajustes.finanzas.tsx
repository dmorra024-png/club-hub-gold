import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Truck, ChartNoAxesCombined, Plus, AlertTriangle } from "lucide-react";
import { useVoiceToolPort } from "@/hooks/useVoiceToolPort";

export const Route = createFileRoute("/_authenticated/ajustes/finanzas")({
  component: Finanzas,
});

type Supplier = { id:string; name:string; contact:string; notes:string };
type Expense = { id:string; category:string; description:string; amount_cents:number; payment_method:string; occurred_on:string; created_at:string; supplier_id:string|null; cancelled_at:string|null; cancel_reason:string|null };
type Purchase = { id:string; supplier_id:string; reference:string; description:string; amount_cents:number; status:string; created_at:string };
type Tab = "gastos"|"proveedores"|"compras"|"contabilidad";
const categories=[["alquiler","Alquiler"],["suministros","Suministros"],["personal","Personal"],["mantenimiento","Mantenimiento"],["compras","Compras"],["otros","Otros"]] as const;
const euros=(n:number)=>new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(n/100);
function parseCents(value:string) {
  if(!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim())) throw Error("Importe no válido. Usa por ejemplo 12,50");
  const [whole,dec=""]=value.trim().replace(",",".").split(".");
  const amount=Number(whole)*100+Number(dec.padEnd(2,"0"));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000) throw Error("Importe fuera del límite");
  return amount;
}
const input="w-full rounded-xl border border-neon/25 bg-card/75 p-3 text-foreground outline-none focus:border-neon";
const btn="rounded-xl border border-neon/35 bg-card/75 px-4 py-3 text-foreground hover:border-neon disabled:opacity-40";
function Finanzas(){
 const {isAdmin,loading,access,user}=useAuth();
 const nav=useNavigate();
 const [tab,setTab]=useState<Tab>("gastos");
 const [suppliers,setSuppliers]=useState<Supplier[]>([]);
 const [expenses,setExpenses]=useState<Expense[]>([]);
 const [purchases,setPurchases]=useState<Purchase[]>([]);
 const [busy,setBusy]=useState(false);
 const [loadingRows,setLoadingRows]=useState(true);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [supplierName,setSupplierName]=useState("");
 const [supplierContact,setSupplierContact]=useState("");
 const [supplierNotes,setSupplierNotes]=useState("");
 const [category,setCategory]=useState("otros");
 const [description,setDescription]=useState("");
 const [amount,setAmount]=useState("");
 const [method,setMethod]=useState("pendiente");
 const [supplierId,setSupplierId]=useState("");
 const [purchaseSupplier,setPurchaseSupplier]=useState("");
 const [purchaseDescription,setPurchaseDescription]=useState("");
 const [purchaseAmount,setPurchaseAmount]=useState("");
 const [purchaseRef,setPurchaseRef]=useState("");
 const db=supabase as any;
 useVoiceToolPort("finance.page",{refresh:reload});
 useEffect(()=>{if(!loading&&!isAdmin) void nav({to:"/ajustes"});},[loading,isAdmin,nav]);
 async function reload(){
  if(!access.clubId||!isAdmin)return;
  setLoadingRows(true);
  try {
   const [s,e,p]=await Promise.all([
    db.from("snoop_suppliers").select("id,name,contact,notes").eq("club_id",access.clubId).order("name").limit(500),
    db.from("snoop_expenses").select("id,category,description,amount_cents,payment_method,occurred_on,created_at,supplier_id,cancelled_at,cancel_reason").eq("club_id",access.clubId).order("created_at",{ascending:false}).limit(500),
    db.from("snoop_purchases").select("id,supplier_id,reference,description,amount_cents,status,created_at").eq("club_id",access.clubId).order("created_at",{ascending:false}).limit(500),
   ]);
   const fail=s.error||e.error||p.error;
   if(fail)throw Error("No se pudieron cargar Finanzas. Revisa los permisos o la instalación del módulo.");
   setSuppliers(s.data??[]);setExpenses(e.data??[]);setPurchases(p.data??[]);
  } catch(e){setError(e instanceof Error?e.message:"Error de conexión");}
  finally{setLoadingRows(false);}
 }
 useEffect(()=>{if(isAdmin&&access.clubId)void reload();},[isAdmin,access.clubId]);
 async function submit(write:()=>Promise<void>){
  if(busy||!access.clubId||!isAdmin)return;
  setBusy(true);setError("");setNotice("");
  try{await write();await reload();setNotice("Registro guardado correctamente.");}
  catch(e){setError(e instanceof Error?e.message:"No se pudo guardar");}
  finally{setBusy(false);}
 }
 const committed=useMemo(()=>expenses.filter(e=>!e.cancelled_at&&e.payment_method!=="pendiente"),[expenses]);
 const totalPaid=committed.reduce((n,e)=>n+e.amount_cents,0);
 const totalDue=expenses.filter(e=>!e.cancelled_at&&e.payment_method==="pendiente").reduce((n,e)=>n+e.amount_cents,0);
 const purchased=purchases.reduce((n,p)=>n+p.amount_cents,0);
 const name=(id:string|null)=>suppliers.find(s=>s.id===id)?.name??"—";
 if(loading||!isAdmin)return <SnoopLayout title="Finanzas"><p className="text-muted-foreground">Verificando permisos…</p></SnoopLayout>;
 return <SnoopLayout title="Finanzas" subtitle="Gastos, proveedores, compras y control administrativo">
  <div className="max-w-5xl space-y-5">
   <div role="note" className="flex items-start gap-2 rounded-xl border border-neon/25 bg-card/50 p-3 text-sm">
    <AlertTriangle size={18} className="mt-0.5 shrink-0 text-neon"/>
    <p>Los registros de este módulo son independientes: no descuentan Caja, no modifican stock y no representan pagos bancarios ejecutados. No duplicar movimientos hasta activar la conciliación contable.</p>
   </div>
   <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {([
      ["gastos","Gastos",ReceiptText],["proveedores","Proveedores",Truck],
      ["compras","Compras",Plus],["contabilidad","Contabilidad",ChartNoAxesCombined],
    ] as const).map(([key,label,Icon])=><button key={key} type="button" onClick={()=>{setTab(key);setError("");setNotice("");}} aria-pressed={tab===key} className={btn+(tab===key?" border-neon bg-neon/10":"")}>
      <Icon size={19} className="mx-auto mb-1 text-neon"/><span className="text-xs sm:text-sm">{label}</span>
    </button>)}
   </div>
   {error&&<p role="alert" className="rounded-xl border border-destructive p-3 text-sm text-destructive">{error}</p>}
   {notice&&<p role="status" className="rounded-xl border border-neon/30 p-3 text-sm">{notice}</p>}
   {tab==="proveedores"&&<section className="space-y-4">
    <form className="rounded-2xl border border-neon/25 bg-card/40 p-4 space-y-3" onSubmit={e=>{e.preventDefault();void submit(async()=>{
     const {error}=await db.from("snoop_suppliers").insert({club_id:access.clubId,created_by:user?.id,name:supplierName.trim(),contact:supplierContact.trim(),notes:supplierNotes.trim()});
     if(error)throw Error("No se pudo guardar el proveedor");setSupplierName("");setSupplierContact("");setSupplierNotes("");
    });}}>
     <h2 className="font-display text-lg">Nuevo proveedor</h2>
     <input className={input} placeholder="Nombre del proveedor" aria-label="Nombre del proveedor" required minLength={2} maxLength={160} value={supplierName} onChange={e=>setSupplierName(e.target.value)}/>
     <input className={input} placeholder="Contacto (opcional)" aria-label="Contacto" maxLength={300} value={supplierContact} onChange={e=>setSupplierContact(e.target.value)}/>
     <textarea className={input} placeholder="Notas (opcional)" aria-label="Notas" maxLength={1000} value={supplierNotes} onChange={e=>setSupplierNotes(e.target.value)}/>
     <button className={btn} type="submit" disabled={busy}>Guardar proveedor</button>
    </form>
    <h2 className="font-display text-lg">Proveedores registrados</h2>
    {loadingRows?<p>Cargando…</p>:suppliers.length===0?<p className="text-muted-foreground">No hay proveedores.</p>:suppliers.map(s=><div key={s.id} className="rounded-xl border border-neon/20 bg-card/40 p-3"><b>{s.name}</b><p className="text-sm text-muted-foreground">{s.contact}</p>{s.notes&&<p className="text-xs">{s.notes}</p>}</div>)}
   </section>}
   {tab==="gastos"&&<section className="space-y-4">
    <form className="rounded-2xl border border-neon/25 bg-card/40 p-4 space-y-3" onSubmit={e=>{e.preventDefault();void submit(async()=>{
      const cents=parseCents(amount);
      const {error}=await db.from("snoop_expenses").insert({club_id:access.clubId,created_by:user?.id,request_id:crypto.randomUUID(),supplier_id:supplierId||null,category,description:description.trim(),amount_cents:cents,payment_method:method});
      if(error)throw Error("No se pudo registrar el gasto");setDescription("");setAmount("");
    });}}>
     <h2 className="font-display text-lg">Registrar gasto</h2>
     <select className={input} aria-label="Categoría" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>
     <input className={input} aria-label="Descripción" placeholder="Concepto del gasto" required minLength={3} maxLength={500} value={description} onChange={e=>setDescription(e.target.value)}/>
     <input className={input} aria-label="Importe en euros" placeholder="Importe € (12,50)" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/>
     <select className={input} aria-label="Proveedor opcional" value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Sin proveedor asociado</option>{suppliers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select>
     <select className={input} aria-label="Estado del pago" value={method} onChange={e=>setMethod(e.target.value)}><option value="pendiente">Pendiente de pago</option><option value="efectivo">Pagado en efectivo (registro)</option><option value="banco">Pagado por banco (registro)</option></select>
     <button className={btn} disabled={busy} type="submit">Registrar gasto</button>
    </form>
    <h2 className="font-display text-lg">Historial de gastos</h2>
    {loadingRows?<p>Cargando…</p>:expenses.length===0?<p className="text-muted-foreground">Sin gastos registrados.</p>:expenses.map(e=><div key={e.id} className="flex items-center justify-between gap-2 rounded-xl border border-neon/20 bg-card/40 p-3">
     <div><b>{e.description}</b><p className="text-xs text-muted-foreground">{e.category} · {name(e.supplier_id)} · {e.occurred_on} · {e.payment_method}{e.cancelled_at?" · ANULADO":""}</p>{!e.cancelled_at&&<button type="button" disabled={busy} className="mt-1 text-xs underline text-muted-foreground" onClick={()=>{const reason=window.prompt("Motivo de anulación (5-500 caracteres)");if(!reason||reason.trim().length<5||reason.length>500)return; if(!window.confirm("¿Anular este gasto? Se conservará el historial."))return;void submit(async()=>{const {error}=await db.rpc("snoop_cancel_expense",{p_id:e.id,p_reason:reason.trim()});if(error)throw Error("No se pudo anular el gasto");});}}>Anular con motivo</button>}</div><b className="whitespace-nowrap">{euros(e.amount_cents)}</b>
    </div>)}
   </section>}
   {tab==="compras"&&<section className="space-y-4">
    <form className="rounded-2xl border border-neon/25 bg-card/40 p-4 space-y-3" onSubmit={e=>{e.preventDefault();void submit(async()=>{
      const cents=parseCents(purchaseAmount);
      const {error}=await db.from("snoop_purchases").insert({club_id:access.clubId,created_by:user?.id,request_id:crypto.randomUUID(),supplier_id:purchaseSupplier,reference:purchaseRef.trim(),description:purchaseDescription.trim(),amount_cents:cents,status:"pendiente"});
      if(error)throw Error("No se pudo registrar la compra");setPurchaseDescription("");setPurchaseAmount("");setPurchaseRef("");
    });}}>
     <h2 className="font-display text-lg">Registrar compra prevista</h2>
     <select className={input} required aria-label="Proveedor" value={purchaseSupplier} onChange={e=>setPurchaseSupplier(e.target.value)}><option value="">Selecciona un proveedor</option>{suppliers.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select>
     <input className={input} aria-label="Referencia" placeholder="Referencia / factura (opcional)" maxLength={120} value={purchaseRef} onChange={e=>setPurchaseRef(e.target.value)}/>
     <input className={input} aria-label="Detalle de compra" placeholder="Descripción de la compra" required minLength={3} maxLength={500} value={purchaseDescription} onChange={e=>setPurchaseDescription(e.target.value)}/>
     <input className={input} aria-label="Coste previsto" placeholder="Coste € (12,50)" inputMode="decimal" required value={purchaseAmount} onChange={e=>setPurchaseAmount(e.target.value)}/>
     <button type="submit" className={btn} disabled={busy||!suppliers.length}>Guardar compra pendiente</button>
    </form>
    <h2 className="font-display text-lg">Compras registradas</h2>
    {loadingRows?<p>Cargando…</p>:purchases.length===0?<p className="text-muted-foreground">Sin compras registradas.</p>:purchases.map(p=><div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-neon/20 bg-card/40 p-3">
     <div><b>{p.description}</b><p className="text-xs text-muted-foreground">{name(p.supplier_id)} · {p.reference||"Sin referencia"} · {p.status}</p></div><b className="whitespace-nowrap">{euros(p.amount_cents)}</b>
    </div>)}
   </section>}
   {tab==="contabilidad"&&<section className="space-y-4">
    <p className="text-sm text-muted-foreground">Resumen administrativo de registros capturados en este módulo. No es un balance contable oficial ni incluye ingresos de Caja.</p>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
     <div className="rounded-xl border border-neon/25 bg-card/50 p-4"><p className="text-sm text-muted-foreground">Gastos pagados (declarados)</p><p className="font-display text-2xl">{euros(totalPaid)}</p></div>
     <div className="rounded-xl border border-neon/25 bg-card/50 p-4"><p className="text-sm text-muted-foreground">Gastos pendientes</p><p className="font-display text-2xl">{euros(totalDue)}</p></div>
     <div className="rounded-xl border border-neon/25 bg-card/50 p-4"><p className="text-sm text-muted-foreground">Compras registradas (no pagadas)</p><p className="font-display text-2xl">{euros(purchased)}</p></div>
    </div>
    <p className="text-xs text-muted-foreground">El cierre de Caja, el libro mayor, las exportaciones fiscales y las transferencias automáticas de stock requieren una conciliación posterior.</p>
   </section>}
  </div>
 </SnoopLayout>;
}
