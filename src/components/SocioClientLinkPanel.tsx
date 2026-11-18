import {useEffect,useState} from "react";
import {issueSocioMembershipCode} from "@/lib/socio-claim-issuance.functions";
import {useAuth} from "@/hooks/useAuth";
import {toast} from "sonner";
import {Copy,Link2} from "lucide-react";

/** Codes are returned once and intentionally never persisted by this component. */
export function SocioClientLinkPanel({memberId}:{memberId:string}){
 const {can}=useAuth();
 const [code,setCode]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [createdAt,setCreatedAt]=useState<number|null>(null);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{
  if(!code)return;
  const interval=setInterval(()=>setNow(Date.now()),1000);
  return()=>clearInterval(interval);
 },[code]);
 useEffect(()=>{setCode(null);setCreatedAt(null);},[memberId]);
 if(!can("manage_members"))return null;
 const seconds=createdAt?Math.max(0,600-Math.ceil((now-createdAt)/1000)):0;
 async function issue(){
  if(busy)return;
  setCode(null);setCreatedAt(null);setBusy(true);
  try{
   const data=await issueSocioMembershipCode({data:{memberId}});
   setCode(data.code);setCreatedAt(Date.now());setNow(Date.now());
   toast.success("Código privado generado. Válido 10 minutos.");
  }catch(e){
   toast.error(e instanceof Error?e.message:"No se pudo generar el acceso del socio.");
  }finally{setBusy(false);}
 }
 return <section className="rounded-2xl border border-neon/25 bg-card/60 p-5 space-y-3">
  <div className="flex items-center gap-2"><Link2 size={18} className="text-neon"/><h3 className="font-display text-lg">SNOOP Socio · App cliente</h3></div>
  <p className="text-sm text-muted-foreground">
   Vincula la cuenta personal del socio con su carnet. El código es único y caduca en 10 minutos.
  </p>
  {code&&seconds>0&&<div className="space-y-2">
   <div className="break-all rounded-lg border border-neon/25 bg-input p-3 font-mono text-xs select-all" aria-label="Código privado de vinculación">{code}</div>
   <div className="flex items-center gap-3">
    <button type="button" className="flex items-center gap-2 rounded-lg border border-neon/35 px-3 py-2 text-sm"
     onClick={()=>navigator.clipboard.writeText(code).then(()=>toast.success("Código copiado.")).catch(()=>toast.error("Copia el código manualmente."))}>
     <Copy size={16}/> Copiar código
    </button>
    <span className="text-xs text-muted-foreground">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,"0")}</span>
   </div>
  </div>}
  {code&&seconds===0&&<p role="status" className="text-sm text-muted-foreground">El código ha caducado. Genera uno nuevo.</p>}
  <button type="button" disabled={busy} onClick={()=>void issue()}
   className="w-full rounded-lg bg-gradient-neon px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
   {busy?"Generando…":"Generar código de acceso SNOOP Socio"}
  </button>
 </section>;
}
