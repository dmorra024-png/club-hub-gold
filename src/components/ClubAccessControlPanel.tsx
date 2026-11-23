import {useEffect,useState} from "react";
import {DoorOpen} from "lucide-react";
import {toast} from "sonner";
import {getClubAccessControl,setClubAccessControl} from "@/lib/club-access-control.functions";
import {useAuth} from "@/hooks/useAuth";

export function ClubAccessControlPanel(){
 const {isAdmin,access}=useAuth();
 const [enabled,setEnabled]=useState<boolean|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!isAdmin||!access.clubId)return;
  let live=true;setEnabled(null);setError("");
  getClubAccessControl().then(r=>{if(live)setEnabled(r.enabled);})
   .catch(()=>{if(live)setError("No se pudo consultar la configuración de acceso.");});
  return()=>{live=false};
 },[isAdmin,access.clubId]);
 if(!isAdmin)return null;
 async function change(next:boolean){
  if(enabled===null||busy)return;
  setBusy(true);setError("");
  try{
   const result=await setClubAccessControl({data:{enabled:next}});
   setEnabled(result.enabled);
   window.dispatchEvent(new Event("snoop:club-access-changed"));
   toast.success(result.enabled?"Control de acceso activado.":"Control de acceso desactivado.");
  }catch{
   setError("No se ha guardado el cambio. Se conserva la configuración anterior.");
  }finally{setBusy(false);}
 }
 return <section className="snoop-settings-card rounded-2xl border border-neon/35 bg-card/60 p-5 sm:p-6 space-y-4" aria-label="Activación de control de acceso">
  <div className="flex items-center gap-4">
   <div className="snoop-settings-icon flex h-12 w-12 items-center justify-center rounded-xl border border-neon/30">
    <DoorOpen className="h-6 w-6 text-neon" aria-hidden="true"/>
   </div>
   <div className="min-w-0 flex-1">
    <h2 className="snoop-settings-title text-base">Control de acceso</h2>
    <p className="snoop-settings-desc text-xs text-muted-foreground">Registro de entradas y salidas con QR o lector.</p>
   </div>
   <label className="flex shrink-0 items-center gap-2 text-sm">
    <input type="checkbox" role="switch" aria-label="Activar control de acceso"
     disabled={enabled===null||busy} checked={enabled??false}
     onChange={e=>void change(e.target.checked)} className="h-5 w-5 accent-primary"/>
    {enabled===null?"Cargando":enabled?"Activo":"Inactivo"}
   </label>
  </div>
  <p className="text-xs text-muted-foreground">
   Si está desactivado, no se permiten nuevos registros de entrada o salida. El lector QR para dispensar productos y el historial anterior no cambian.
  </p>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 </section>;
}
