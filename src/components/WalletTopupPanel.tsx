import {useEffect,useRef,useState} from "react";
import {useAuth} from "@/hooks/useAuth";
import {walletMemberStatus,walletTopup} from "@/lib/wallet-management.functions";
import {parseCashCents} from "@/lib/member-administration";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {toast} from "sonner";
import {RECORDS_CHANGED} from "./FinancialRecordDialog";

type Status={enabled:boolean;clubEnabled:boolean;balanceCents:number|null;cashSessionId:string|null};
const money=(c:number)=>(c/100).toLocaleString("es-ES",{style:"currency",currency:"EUR"});
const credits=(c:number)=>`${(c/100).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} créditos`;
type ReceiptMethod="cash"|"card"|"transfer";
/** Staff wallet panel. Nothing is shown when a club has not explicitly enabled Monedero. */
export function WalletTopupPanel({memberId}:{memberId:string}){
 const {user,access,can,accessError}=useAuth();
 const [status,setStatus]=useState<Status|null>(null);
 const [amount,setAmount]=useState("");
 const [receiptMethod,setReceiptMethod]=useState<ReceiptMethod>("cash");
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [problem,setProblem]=useState("");
 const operation=useRef<string|null>(null);
 const inFlight=useRef(false);
 const scope=JSON.stringify([user?.id,access.clubId,access.status,memberId]);
 useEffect(()=>{
  // Server authorization and club configuration are authoritative.
  // Do not silently hide the panel when a build-time flag is absent.
  if(accessError||!can("use_cash")||!can("manage_members"))return;
  let active=true;
  setStatus(null);setProblem("");setConfirmed(false);setAmount("");setReceiptMethod("cash");
  // Never guess enabled state when server cannot verify it.
  walletMemberStatus({data:{memberId}})
   .then(result=>{if(active)setStatus(result);})
   .catch(()=>{if(active)setProblem("No se pudo consultar el monedero.");});
  return()=>{active=false;};
 },[scope,accessError]);
 if(!can("use_cash")||!can("manage_members")||accessError)return null;
 if(problem&&!status)return <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-2" aria-label="Monedero del socio">
  <h2 className="font-display text-lg">Monedero</h2><p role="alert" className="text-sm text-muted-foreground">{problem}</p>
 </section>;
 if(!status?.clubEnabled)return null;
 if(!status.enabled)return <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-2" aria-label="Monedero del socio">
  <h2 className="font-display text-lg">Monedero</h2>
  <p role="status" className="text-sm text-muted-foreground">Monedero activado para el club, pero no disponible para este socio. Comprueba que su membresía y tarjeta estén activas.</p>
 </section>;
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
    amountCents:cents,paymentMethod:receiptMethod,confirmed:true}});
   operation.current=null;
   setAmount("");setConfirmed(false);
   setStatus({...status!,balanceCents:result.balanceCents});
   window.dispatchEvent(new Event(RECORDS_CHANGED));
   toast.success("Recarga registrada · créditos añadidos al Monedero.");
  }catch{
   setProblem("No se pudo confirmar la recarga. Comprueba el historial antes de reintentar; no se ha generado otra operación.");
  }finally{inFlight.current=false;setBusy(false);}
 }
 return <section className="rounded-2xl border border-border bg-card/60 p-4 space-y-3" aria-label="Monedero del socio">
  <h2 className="font-display text-lg">Monedero</h2>
  <p>Saldo disponible: <strong>{credits(status.balanceCents??0)}</strong></p>
  <p className="text-xs text-muted-foreground">Equivalencia de recarga: 1 € recibido = 1 crédito. Los pedidos se descuentan exclusivamente en créditos.</p>
  {!status.cashSessionId?
   <p role="status">Abre tu caja antes de registrar una recarga.</p>:
   <>
    <label className="block text-sm">Importe recibido para recarga (€)
     <Input inputMode="decimal" value={amount} disabled={busy}
      onChange={e=>{setAmount(e.target.value);setConfirmed(false);operation.current=null;}}
      placeholder="0,00"/>
    </label>
    <fieldset className="space-y-2">
     <legend className="text-sm font-semibold">Método de cobro de la recarga</legend>
     <div className="flex flex-wrap gap-3">
      {(["cash","card","transfer"] as const).map(method=><label className="flex gap-2 items-center text-sm" key={method}>
        <input type="radio" name="wallet-topup-method" value={method} checked={receiptMethod===method}
          disabled={busy} onChange={()=>{setReceiptMethod(method);setConfirmed(false);operation.current=null;}}/>
        {method==="cash"?"Efectivo":method==="card"?"Tarjeta / POS":"Transferencia"}
      </label>)}
     </div>
    </fieldset>
    <p className="text-sm">Créditos a añadir: <strong>{cents!==null&&cents>0?credits(cents):"—"}</strong></p>
    <label className="flex items-start gap-2 text-sm">
     <input type="checkbox" checked={confirmed} disabled={busy}
      onChange={e=>setConfirmed(e.target.checked)}/>
     Confirmo que ya recibí {cents!==null&&cents>0?money(cents):"el importe"} por {receiptMethod==="cash"?"efectivo":receiptMethod==="card"?"tarjeta / POS":"transferencia"}
     y autorizo la recarga de créditos. Esta acción no cobra automáticamente al cliente.
    </label>
    <Button disabled={busy||!confirmed||cents===null||cents<=0||cents>10000000}
     onClick={()=>void topup()}>Confirmar recarga</Button>
   </>}
  {problem&&<p role="alert" className="text-red-400">{problem}</p>}
 </section>;
}
