/**
 * Reconcile the two independent cash domains: physical cash collected by
 * club staff and internal wallet credits debited against those collections.
 * No inferred payment method. Returns an error when legacy orders lack
 * confirmed settlement evidence. This is an integration contract, not live
 * business accounting or a replacement for SNOOP's existing cash reports.
 */
const bad=code=>Object.assign(Error(code),{code});
const amount=n=>Number.isSafeInteger(n)&&n>=0;
const addition=(sum,v)=>{const n=sum+v;if(!Number.isSafeInteger(n))throw bad('CASH_TOTAL_OVERFLOW');return n;};
function rowsUnique(rows,type) {
 if(!Array.isArray(rows))throw bad('CASH_ROWS_REQUIRED');
 const ids=new Set();
 return rows.map(row=>{
  if(!row||typeof row.id!=='string'||!row.id)throw bad('CASH_ID_REQUIRED');
  if(ids.has(row.id))throw bad('CASH_DUPLICATE_'+type);
  ids.add(row.id);
  return row;
 });
}
export function reconcileCashWithWallet({
 orders=[],membershipFees=[],walletTopups=[],cashRefunds=[]
}={}){
 let cashOrders=0,walletOrders=0,cashFees=0,cashTopups=0,refundedCash=0;
 for(const row of rowsUnique(orders,'ORDER')){
  if(!amount(row.totalCents))throw bad('CASH_INVALID_ORDER_AMOUNT');
  if(row.status==='cancelled')continue;
  if(row.status!=='completed')throw bad('CASH_ORDER_STATUS_UNKNOWN');
  if(row.paymentMethod==='cash')cashOrders=addition(cashOrders,row.totalCents);
  else if(row.paymentMethod==='wallet')walletOrders=addition(walletOrders,row.totalCents);
  else throw bad('CASH_PAYMENT_METHOD_UNVERIFIED');
 }
 for(const row of rowsUnique(membershipFees,'FEE')){
  if(!amount(row.amountCents)||row.paymentMethod!=='cash')throw bad('CASH_FEE_METHOD_UNVERIFIED');
  cashFees=addition(cashFees,row.amountCents);
 }
 for(const row of rowsUnique(walletTopups,'TOPUP')){
  if(!amount(row.amountCents)||row.amountCents===0||
   row.kind!=='topup'||row.paymentMethod!=='cash'||
   typeof row.cashSessionId!=='string'||!row.cashSessionId)
   throw bad('CASH_WALLET_TOPUP_UNVERIFIED');
  cashTopups=addition(cashTopups,row.amountCents);
 }
 for(const row of rowsUnique(cashRefunds,'REFUND')){
  if(!amount(row.amountCents)||row.paymentMethod!=='cash'||
   typeof row.originalOperationId!=='string'||!row.originalOperationId)
   throw bad('CASH_REFUND_METHOD_UNVERIFIED');
  refundedCash=addition(refundedCash,row.amountCents);
 }
 const collectedCash=addition(addition(cashOrders,cashFees),cashTopups);
 // A valid period may have more cash refunded than collected (e.g. a
 // previous-day order refunded during a new shift). Net flow may be negative.
 const netCash=collectedCash-refundedCash;
 if(!Number.isSafeInteger(netCash))throw bad('CASH_TOTAL_OVERFLOW');
 return {
  cashOrdersCents:cashOrders,
  walletOrderTransfersCents:walletOrders,
  cashMembershipFeesCents:cashFees,
  cashWalletTopupsCents:cashTopups,
  cashRefundsCents:refundedCash,
  netCashCents:netCash
 };
}
