/**
 * SNOOP Monedero business command boundary, isolated from live payments/cash/orders.
 *
 * The caller MUST construct staff from a verified server-managed auth/role lookup.
 * Wallet commands REQUIRE a repository with a single atomic PostgreSQL transaction:
 * locking (club_id, member_id), checking operationId uniqueness, applying exactly
 * one ledger delta and returning the committed resulting balance.
 *
 * All amounts are integer cents; this module does NOT change balances by itself.
 */
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const validId=x=>typeof x==='string'&&UUID.test(x);
const error=(code,status=403)=>Object.assign(new Error(code),{code,status});
const KINDS=new Set(['topup','spend','refund']);
function validatedStaff(staff,clubId,kind){
 if(!staff||staff.accountType!=='staff'||staff.verified!==true||!validId(staff.userId)||!validId(staff.clubId)||staff.clubId!==clubId)
  throw error('WALLET_STAFF_FORBIDDEN');
 const permission=kind==='topup'?'wallet_topup':kind==='spend'?'wallet_spend':'wallet_refund';
 if(!Array.isArray(staff.permissions)||!staff.permissions.includes(permission))
  throw error('WALLET_PERMISSION_DENIED');
}
function validatedOperation(op){
 if(!op||!validId(op.clubId)||!validId(op.memberId)||!validId(op.operationId)||!KINDS.has(op.kind))
  throw error('WALLET_OPERATION_INVALID',400);
 if(!Number.isSafeInteger(op.amountCents)||op.amountCents<=0||op.amountCents>10_000_000)
  throw error('WALLET_AMOUNT_INVALID',400);
 if(op.confirmed!==true)throw error('WALLET_CONFIRMATION_REQUIRED',409);
 if(op.kind==='spend'&&(!validId(op.orderId)||op.reversalOf!==undefined))
  throw error('WALLET_ORDER_REQUIRED',400);
 if(op.kind==='refund'&&(!validId(op.orderId)||!validId(op.reversalOf)))
  throw error('WALLET_REFUND_REFERENCE_REQUIRED',400);
 if(op.kind==='topup'&&(!validId(op.cashSessionId)||op.orderId!==undefined||op.reversalOf!==undefined))
  throw error('WALLET_TOPUP_CASH_SESSION_REQUIRED',400);
}
export function createWalletCommands({repository}){
 if(!repository||typeof repository.commitWalletOperation!=='function'||
    typeof repository.memberWalletEnabled!=='function')throw Error('WALLET_REPOSITORY_NOT_CONFIGURED');
 return{
  async commit(staff,operation){
   validatedOperation(operation);
   validatedStaff(staff,operation.clubId,operation.kind);
   const enabled=await repository.memberWalletEnabled(operation.clubId,operation.memberId);
   if(enabled!==true)throw error('WALLET_DISABLED');
   // Must validate cash session/paid order/cancelled order and amounts within
   // the *same* trusted DB transaction to prevent TOCTOU, fraud and double-count.
   const result=await repository.commitWalletOperation({
    clubId:operation.clubId,
    memberId:operation.memberId,
    operationId:operation.operationId,
    kind:operation.kind,
    amountCents:operation.amountCents,
    orderId:operation.orderId??null,
    reversalOf:operation.reversalOf??null,
    cashSessionId:operation.cashSessionId??null,
    actorId:staff.userId,
   });
   if(!result||!Number.isSafeInteger(result.balanceCents)||result.balanceCents<0||
      !validId(result.operationId)||!['applied','duplicate'].includes(result.status))
    throw error('WALLET_COMMIT_UNVERIFIED',503);
   if(result.operationId!==operation.operationId)throw error('WALLET_OPERATION_MISMATCH',503);
   return{balanceCents:result.balanceCents,status:result.status,operationId:result.operationId};
  },
 };
}
