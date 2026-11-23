import {useRef,useState} from "react";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {walletVoidTopup} from "@/lib/wallet-management.functions";
import {RECORDS_CHANGED} from "@/components/FinancialRecordDialog";

type Method="cash"|"card"|"transfer";
export function WalletTopupVoidDialog({topupId,amountCents,onClose}:{
 topupId:string;amountCents:number;onClose:()=>void
}){
 const [reason,setReason]=useState("");
 const [method,setMethod]=useState<Method>("cash");
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [uncertain,setUncertain]=useState(false);
 const operation=useRef<string|null>(null);
 const inflight=useRef(false);
 const money=new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(amountCents/100);
 async function submit(){
  if(inflight.current||uncertain||reason.trim().length<5||!confirmed)return;
  inflight.current=true;setBusy(true);setError("");
  operation.current??=crypto.randomUUID();
  try{
   const r=await walletVoidTopup({data:{topupId,operationId:operation.current,
    reason:reason.trim(),refundMethod:method,confirmed:true}});
   if(r.status==="rejected"){
    operation.current=null;setError(r.reason);return;
   }
   operation.current=null;
   window.dispatchEvent(new Event(RECORDS_CHANGED));
   onClose();
  }catch{
   setUncertain(true);
   setError("Operación sin confirmar. Consulta el historial antes de reintentar: podría haberse registrado.");
  }finally{inflight.current=false;setBusy(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}>
  <DialogContent className="max-w-lg">
   <DialogHeader>
    <DialogTitle>Anular recarga Monedero</DialogTitle>
    <DialogDescription>Se conservará la recarga original y se registrará una rectificación auditada.</DialogDescription>
   </DialogHeader>
   <div className="space-y-4">
    <p>Recarga original: <strong>{money}</strong> ({(amountCents/100).toLocaleString("es-ES")} créditos).</p>
    <p className="text-sm text-muted-foreground">
     Solo se puede anular si el socio conserva los créditos suficientes.
     Esta operación descuenta los créditos y registra el dinero ya devuelto; no envía una transferencia ni realiza un reembolso POS.
    </p>
    <label className="block text-sm">Motivo de anulación
     <textarea className="mt-1 w-full rounded-lg border border-border bg-background p-3"
      rows={3} maxLength={2000} value={reason} disabled={busy||uncertain}
      onChange={e=>{setReason(e.target.value);setConfirmed(false);operation.current=null;}}/>
    </label>
    <fieldset className="space-y-2">
     <legend className="text-sm font-semibold">Método de la devolución ya realizada</legend>
     {(["cash","card","transfer"] as const).map(m=><label key={m} className="flex items-center gap-2">
       <input type="radio" name="topup-refund-method" value={m} checked={method===m} disabled={busy||uncertain}
        onChange={()=>{setMethod(m);setConfirmed(false);operation.current=null;}}/>
       {m==="cash"?"Efectivo":m==="card"?"Tarjeta / POS":"Transferencia"}
     </label>)}
    </fieldset>
    <label className="flex items-start gap-2 text-sm">
     <input type="checkbox" checked={confirmed} disabled={busy||uncertain}
      onChange={e=>setConfirmed(e.target.checked)}/>
     Confirmo que ya he devuelto {money} por el método indicado y que no he registrado antes esta devolución.
    </label>
    {error&&<p className="text-sm text-red-400" role="alert">{error}</p>}
    <Button className="w-full" disabled={busy||uncertain||!confirmed||reason.trim().length<5} onClick={()=>void submit()}>
     {busy?"Registrando anulación…":"Confirmar anulación de recarga"}
    </Button>
   </div>
  </DialogContent>
 </Dialog>;
}
