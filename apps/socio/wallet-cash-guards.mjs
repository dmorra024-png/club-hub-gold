/**
 * Server-side guards for authoritative ROWS read and locked inside an atomic
 * wallet transaction. Never trust client-supplied cash, order or member records.
 * This pure module does not make database changes.
 */
const id=x=>typeof x==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
const fail=(code,status=409)=>{const e=Error(code);e.code=code;e.status=status;throw e;};
const same=(a,b)=>id(a)&&a===b;
export function validateWalletCashTopup({operation,staff,session,member,now=Date.now()}){
 if(!operation||operation.kind!=='topup'||!same(operation.clubId,staff?.clubId)||
   !same(operation.clubId,session?.clubId)||!same(operation.clubId,member?.clubId)||
   !same(operation.memberId,member?.id)||!same(operation.cashSessionId,session?.id))
  fail('WALLET_CASH_SCOPE_DENIED',403);
 if(!same(session.userId,staff.userId))fail('WALLET_SHIFT_NOT_OWNED',403);
 if(session.status!=='open'||session.closedAt!==null)fail('WALLET_CASH_SESSION_CLOSED');
 const started=Date.parse(session.openedAt);
 if(!Number.isFinite(started)||started>now)fail('WALLET_CASH_TIME_INVALID');
 if(member.active!==true||member.revokedAt)fail('WALLET_MEMBER_INACTIVE');
 if(!Number.isSafeInteger(operation.amountCents)||operation.amountCents<=0)
  fail('WALLET_AMOUNT_INVALID',400);
 return true;
}
export function validateWalletOrderEvent({operation,order,member,previousDebit}){
 if(!operation||!['spend','refund'].includes(operation.kind)||
    !same(operation.clubId,order?.clubId)||
    !same(operation.clubId,member?.clubId)||
    !same(operation.memberId,member?.id)||
    !same(operation.memberId,order?.memberId)||
    !same(operation.orderId,order?.id))
  fail('WALLET_ORDER_SCOPE_DENIED',403);
 if(member.active!==true||member.revokedAt)fail('WALLET_MEMBER_INACTIVE');
 if(!Number.isSafeInteger(order.totalCents)||order.totalCents<=0||
    !Number.isSafeInteger(operation.amountCents)||operation.amountCents!==order.totalCents)
  fail('WALLET_ORDER_AMOUNT_MISMATCH');
 if(operation.kind==='spend'){
  // Order completion and wallet debit MUST be committed together or verified
  // under a locked order state. Completed orders without matching debit are
  // NOT safe to charge retroactively without checking existing cash receipts.
  if(order.status!=='completed'||order.cancelledAt)fail('WALLET_ORDER_NOT_COMPLETED');
 }else{
  if(order.status!=='cancelled'||!order.cancelledAt)fail('WALLET_ORDER_NOT_CANCELLED');
  if(!previousDebit||previousDebit.kind!=='spend'||
     !same(previousDebit.operationId,operation.reversalOf)||
     !same(previousDebit.clubId,operation.clubId)||
     !same(previousDebit.memberId,operation.memberId)||
     !same(previousDebit.orderId,operation.orderId)||
     previousDebit.amountCents!==operation.amountCents)
   fail('WALLET_REVERSAL_NOT_MATCHED');
 }
 return true;
}
