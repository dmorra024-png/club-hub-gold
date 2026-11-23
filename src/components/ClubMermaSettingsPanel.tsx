import {useEffect,useState} from "react";
import {Gauge,Save} from "lucide-react";
import {toast} from "sonner";
import {getClubMermaSettings,setClubMermaSettings} from "@/lib/club-merma.functions";
import {useAuth} from "@/hooks/useAuth";
export function ClubMermaSettingsPanel(){
 const {isAdmin,access}=useAuth();
 const [stored,setStored]=useState<number|null>(null);
 const [raw,setRaw]=useState("0,050");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!isAdmin||!access.clubId)return;
  let active=true;
  setStored(null);setError("");
  getClubMermaSettings().then(v=>{
   if(!active)return;
   setStored(v.maxMermaPerGram);
   setRaw(v.maxMermaPerGram.toLocaleString("es-ES",{minimumFractionDigits:3,maximumFractionDigits:3}));
  }).catch(()=>{if(active)setError("No se pudo cargar el límite de merma.");});
  return ()=>{active=false};
 },[isAdmin,access.clubId]);
 if(!isAdmin)return null;
 const num=Number(raw.replace(",","."));
 const valid=raw.trim()!==""&&Number.isFinite(num)&&num>=0&&num<=0.5&&
  Math.abs(num*1000-Math.round(num*1000))<1e-7;
 async function save(){
  if(!valid||busy)return;
  setBusy(true);setError("");
  try{
   const result=await setClubMermaSettings({data:{maxMermaPerGram:num}});
   setStored(result.maxMermaPerGram);
   setRaw(result.maxMermaPerGram.toLocaleString("es-ES",{minimumFractionDigits:3,maximumFractionDigits:3}));
   toast.success("Límite de merma actualizado para el club.");
  }catch{
   setError("No se pudo guardar. No se ha cambiado el límite.");
  }finally{setBusy(false);}
 }
 return <section className="snoop-settings-card rounded-2xl border border-neon/35 bg-card/60 p-5 sm:p-6 space-y-4" aria-label="Merma permitida para el club">
  <div className="flex gap-4 items-center">
   <span className="snoop-settings-icon flex h-12 w-12 items-center justify-center rounded-xl border border-neon/35">
    <Gauge className="h-6 w-6 text-neon" aria-hidden="true"/>
   </span>
   <div>
    <h2 className="snoop-settings-title text-base text-foreground">Merma permitida</h2>
    <p className="snoop-settings-desc text-xs text-muted-foreground">Límite máximo por cada gramo vendido, para todo el club.</p>
   </div>
  </div>
  <label className="block text-sm font-medium text-foreground" htmlFor="club-merma-limit">
   Gramos extra permitidos por cada 1 g vendido
  </label>
  <div className="flex flex-wrap items-center gap-3">
   <input id="club-merma-limit" aria-invalid={!valid} inputMode="decimal"
    className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-base"
    value={raw} disabled={busy||stored===null}
    onChange={e=>setRaw(e.target.value)}/>
   <span className="text-sm text-muted-foreground">g / 1 g · Máximo 0,500</span>
  </div>
  <p className="text-xs text-muted-foreground">Ejemplo: 0,050 permite descontar hasta 0,050 g extra de stock por cada 1 g vendido. Es un máximo, no una merma automática obligatoria.</p>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {!valid&&<p role="alert" className="text-xs text-destructive">Indica un valor entre 0 y 0,500, con un máximo de tres decimales.</p>}
  <button type="button" onClick={()=>void save()} disabled={busy||!valid||stored===null||Math.abs(num-stored)<1e-7}
   className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
   <Save className="h-4 w-4" aria-hidden="true"/>{busy?"Guardando…":"Guardar límite"}
  </button>
 </section>
}
