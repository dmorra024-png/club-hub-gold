import {useAuth} from "@/hooks/useAuth";
import {useEffect,useState} from "react";
import {Wallet} from "lucide-react";
import {getClubWalletSettings,changeClubWalletSettings} from "@/lib/wallet-club-settings.functions";
import {toast} from "sonner";

type Settings={configured:boolean;clubEnabled:boolean;operationsReady:boolean};

/** One premium club-level settings tile; no duplicate menu tile or member toggle. */
export function ClubWalletSettingsPanel(){
 const {isAdmin,loading}=useAuth();
 const [state,setState]=useState<Settings|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(loading||!isAdmin)return;
  let active=true;
  getClubWalletSettings().then(result=>{
   if(active){setState(result);setError("");}
  }).catch(()=>{
   if(active){setError("No se pudo consultar el estado. Vuelve a intentarlo.");setState(null);}
  });
  return()=>{active=false;};
 },[loading,isAdmin]);
 async function setEnabled(enabled:boolean){
  if(busy||!state?.operationsReady||!state.configured)return;
  if(!window.confirm(enabled?
   "¿Activar Monedero para todos los socios activos? Cada socio conserva su propio saldo.":
   "¿Desactivar Monedero para todo el club? Los saldos se conservarán."))return;
  setBusy(true);setError("");
  try{
   const result=await changeClubWalletSettings({data:{enabled,confirmed:true}});
   setState(result);
   toast.success(enabled?"Monedero del club activado.":"Monedero del club desactivado.");
  }catch{
   setError("No se ha confirmado el cambio. Consulta el estado antes de repetir.");
  }finally{setBusy(false);}
 }
 if(loading||!isAdmin)return null;
 const ready=state?.configured===true&&state?.operationsReady===true;
 const status=error?"Error de conexión":!state?"Comprobando…":
  !ready?"Pendiente de sincronización":
  state.clubEnabled?"Activado":"Desactivado";
 return <section id="monedero"
  aria-label="Monedero del club"
  className="group flex flex-col items-center justify-center text-center rounded-2xl border border-neon/25 bg-card/60 p-6 transition hover:border-neon/50 hover:bg-card/80">
   <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-neon/50">
    <Wallet className="h-6 w-6 text-neon"/>
   </div>
   <h2 className="font-display text-lg tracking-tight text-foreground">Monedero</h2>
   <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
    Saldo individual para los socios. Activación única para el club.
   </p>
   <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" role="status">
    <span className={`h-2 w-2 rounded-full ${ready&&state?.clubEnabled?"bg-neon":"bg-muted-foreground/50"}`}/>
    <span>{status}</span>
   </div>
   <button type="button" role="switch"
    aria-label="Activar o desactivar el Monedero de todo el club"
    aria-checked={ready&&state?.clubEnabled===true}
    disabled={busy||!ready}
    onClick={()=>void setEnabled(!state!.clubEnabled)}
    className="mt-4 flex w-full items-center justify-center gap-3 rounded-xl border border-neon/25 bg-background/30 px-4 py-3 text-sm text-foreground transition hover:border-neon/60 disabled:opacity-50">
    <span aria-hidden="true" className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${ready&&state?.clubEnabled?"bg-neon":"bg-muted"}`}>
     <span className={`absolute h-4 w-4 rounded-full bg-background transition-all ${ready&&state?.clubEnabled?"left-6":"left-1"}`}/>
    </span>
    {busy?"Guardando…":ready?(state!.clubEnabled?"Desactivar":"Activar"):"No disponible"}
   </button>
   {error&&<p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
   {state&&!ready&&<p className="mt-2 text-xs text-muted-foreground">
    Verifica la conexión del servidor antes de usar fondos reales.
   </p>}
  </section>;
}
