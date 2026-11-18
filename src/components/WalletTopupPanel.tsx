import {useEffect,useRef,useState} from "react";
import {useAuth} from "@/hooks/useAuth";
import {walletMemberStatus,walletTopup} from "@/lib/wallet-management.functions";
import {parseCashCents} from "@/lib/member-administration";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {toast} from "sonner";

type Status={enabled:boolean;clubEnabled:boolean;balanceCents:number|null;cashSessionId:string|null};
const money=(c:number)=>(c/100).toLocaleString("es-ES",{style:"currency",currency:"EUR"});
/** Staff wallet panel. Nothing is shown when a club has not explicitly enabled Monedero. */
export function WalletTopupPanel({memberId}:{memberId:string}){
 const {user,access,can,accessError}=useAuth();
 const [status,setStatus]=useState<Status|null>(null);
 const [amount,setAmount]=useState("");
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [problem,setProblem]=useState("");
 const operation=useRef<string|null>(null);
 const inFlight=useRef(false);
 const scope=JSON.stringify([user?.id,access.clubId,access.status,memberId]);
 useEffect(()=>{
  if(import.meta.env.VITE_SNOOP_WALLET_OPERATIONS_ENABLED!=="true")return;
  if(accessError||!can("use_cash")||!can("manage_members"))return;
  let active=true;
  setStatus(null);setProblem("");setConfirmed(false);setAmount("");
  // Never guess enabled state when server cannot verify it.
  walletMemberStatus({data:{memberId}})
   .then(result=>{if(active)setStatus(result);})
   .catch(()=>{if(active)setProblem("No se pudo consultar el monedero.");});
  return()=>{active=false;};
 },[scope,accessError]);
 if(!can("use_cash")||!can("manage_members")||accessError||!status?.enabled)return null;
 const cents=parseCashCents(amount);
 async function topup(){
  if(inFlight.current||!confirmed||cents===null||cents<=0||cents>10000000||
     !status?.cashSessionId)return;
  inFlight.current=true;setBusy(true);setProblem("");
  // Keep the same idempotency key across network uncertainty, never generate
  // a new transaction by retrying a failed acknowledgement.
  operation.current??=crypto.randomUUID();
  try{
   const result=await walletTopup({data:{memberId,
    cashSessionId:status!.cashSessionId!,operationId:operation.current!,
    amountCents:cents,confirmed:true}});
   operation.current=null;
   setAmount("");setConfirmed(false);
   setStatus({...status!,balanceCents:result.balanceCents});
   toast.success("Recarga registrada en caja y monedero.");
  }catch{
   setProblem("No se pudo confirmar la recarga. Comprueba el historial antes de reintentar; no se ha generado otra operación.");
  }finally{inFlight.current=false;setBusy(false);}
 }
 return <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3" aria-label="Monedero del socio">
  <h2 className="font-display text-lg">Monedero</h2>
  <p>Saldo disponible: <strong>{money(status.balanceCents??0)}</strong></p>
  {!status.cashSessionId?
   <p role="status">Abre tu caja antes de registrar una recarga.</p>:
   <>
    <label className="block text-sm">Recarga en efectivo (€)
     <Input inputMode="decimal" value={amount} disabled={busy}
      onChange={e=>{setAmount(e.target.value);setConfirmed(false);operation.current=null;}}
      placeholder="0,00"/>
    </label>
    <label className="flex items-start gap-2 text-sm">
     <input type="checkbox" checked={confirmed} disabled={busy}
      onChange={e=>setConfirmed(e.target.checked)}/>
     Confirmo haber recibido este efectivo en mi caja y autorizo la recarga
     de {cents!==null&&cents>0?money(cents):"—"}.
    </label>
    <Button disabled={busy||!confirmed||cents===null||cents<=0||cents>10000000}
     onClick={()=>void topup()}>Confirmar recarga</Button>
   </>}
  {problem&&<p role="alert" className="text-red-400">{problem}</p>}
 </section>;
}
