import {createFileRoute,Link,useNavigate} from "@tanstack/react-router";
import {SnoopLayout} from "@/components/SnoopLayout";
import {useAuth} from "@/hooks/useAuth";
import {useEffect,useState} from "react";
import {Wallet,ArrowLeft,AlertTriangle,CheckCircle2} from "lucide-react";
import {getClubWalletSettings,changeClubWalletSettings} from "@/lib/wallet-club-settings.functions";
import {toast} from "sonner";

export const Route=createFileRoute("/_authenticated/ajustes/monedero")({
 component:ClubMonederoSettings
});
type Settings={configured:boolean;clubEnabled:boolean;operationsReady:boolean};
function ClubMonederoSettings(){
 const {isAdmin,loading}=useAuth();
 const nav=useNavigate();
 const [state,setState]=useState<Settings|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{if(!loading&&!isAdmin)nav({to:"/"});},[loading,isAdmin,nav]);
 useEffect(()=>{
  if(loading||!isAdmin)return;
  let active=true;
  getClubWalletSettings().then(result=>{if(active){setState(result);setError("");}})
   .catch(()=>{if(active){setError("No se pudo verificar la configuración del club.");setState(null);}});
  return()=>{active=false;};
 },[loading,isAdmin]);
 async function setEnabled(enabled:boolean){
  if(busy||!state?.operationsReady)return;
  const prompt=enabled?
   "¿Activar Monedero para TODOS los socios activos del club? Cada socio tendrá un saldo independiente. Los saldos existentes se conservarán.":
   "¿Desactivar Monedero para TODO el club? No se borrará ningún saldo ni movimiento.";
  if(!window.confirm(prompt))return;
  setBusy(true);setError("");
  try{
   const result=await changeClubWalletSettings({data:{enabled,confirmed:true}});
   setState(result);
   toast.success(enabled?"Monedero activado para el club.":"Monedero desactivado para el club.");
  }catch{
   setError("No se ha confirmado ningún cambio. Comprueba la configuración antes de reintentar.");
  }finally{setBusy(false);}
 }
 if(loading||!isAdmin)return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;
 return <SnoopLayout title="Monedero" subtitle="Configuración única para todo el club">
  <div className="max-w-2xl space-y-5">
   <Link to="/ajustes" className="inline-flex gap-2 items-center text-sm text-muted-foreground hover:text-foreground">
    <ArrowLeft size={16}/> Volver a ajustes
   </Link>
   <section className="rounded-2xl border border-neon/25 bg-card/60 p-6 space-y-4">
    <div className="flex items-center gap-3">
     <Wallet className="text-neon" size={28}/>
     <div>
      <h2 className="font-display text-lg">Monedero del club</h2>
      <p className="text-sm text-muted-foreground">Una sola activación para todos los socios activos.</p>
     </div>
    </div>
    <p className="text-sm text-muted-foreground">
     Al activarlo, todos los socios activos del club pueden utilizar Monedero.
     Cada socio conserva su propio saldo y sus movimientos. No se activa socio por socio.
     Los colaboradores siguen sujetos a sus permisos de caja.
    </p>
    {error&&<p role="alert" className="text-sm text-red-400">{error}</p>}
    {!state?<p role="status" className="text-sm">Verificando configuración…</p>:
     <div className="space-y-3">
      <div className="flex gap-2 items-center text-sm">
       {state.clubEnabled?<CheckCircle2 size={18} className="text-neon"/>:<AlertTriangle size={18} className="text-muted-foreground"/>}
       <span>Estado: <strong>{state.clubEnabled?"Activado para el club":"Desactivado para el club"}</strong></span>
      </div>
      {!state.operationsReady&&<p role="status" className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
       Monedero está preparado en el código, pero aún faltan las migraciones
       y la validación contable necesarias para activarlo. No se han generado saldos ni cargos reales.
      </p>}
      <button type="button" role="switch" aria-checked={state.clubEnabled}
       disabled={busy||!state.operationsReady}
       onClick={()=>void setEnabled(!state.clubEnabled)}
       className="flex items-center gap-3 rounded-xl border border-neon/30 bg-card px-4 py-3 disabled:opacity-50">
       <span className={`relative inline-flex w-12 h-7 items-center rounded-full transition ${state.clubEnabled?"bg-neon":"bg-muted"}`}>
        <span className={`absolute h-5 w-5 rounded-full bg-background transition-all ${state.clubEnabled?"left-6":"left-1"}`}/>
       </span>
       {state.clubEnabled?"Desactivar Monedero del club":"Activar Monedero del club"}
      </button>
     </div>}
   </section>
  </div>
 </SnoopLayout>;
}
