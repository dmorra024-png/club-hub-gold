import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileCashWithWallet} from './wallet-cash-reconciliation.mjs';
const fixed={
 orders:[
  {id:'order1',status:'completed',totalCents:1200,paymentMethod:'cash'},
  {id:'order2',status:'completed',totalCents:900,paymentMethod:'wallet'},
  {id:'order3',status:'cancelled',totalCents:500,paymentMethod:'cash'}
 ],
 membershipFees:[{id:'fee1',amountCents:2000,paymentMethod:'cash'}],
 walletTopups:[{id:'topup1',kind:'topup',amountCents:3500,paymentMethod:'cash',cashSessionId:'cash1'}],
 cashRefunds:[{id:'refund1',amountCents:200,paymentMethod:'cash',originalOperationId:'order1'}]
};
test('cash topups count as physical cash once; wallet spending is not second cash revenue',()=>{
 assert.deepEqual(reconcileCashWithWallet(fixed),{
  cashOrdersCents:1200,walletOrderTransfersCents:900,
  cashMembershipFeesCents:2000,cashWalletTopupsCents:3500,
  cashRefundsCents:200,netCashCents:6500
 });
});
test('legacy orders with unknown payment method fail closed instead of treating wallet payments as cash',()=>{
 assert.throws(()=>reconcileCashWithWallet({
  ...fixed,orders:[{id:'order1',status:'completed',totalCents:1000}]
 }),{code:'CASH_PAYMENT_METHOD_UNVERIFIED'});
});
test('duplicate cash wallet entries cannot inflate the real receipts',()=>{
 assert.throws(()=>reconcileCashWithWallet({
  ...fixed,walletTopups:[fixed.walletTopups[0],fixed.walletTopups[0]]
 }),{code:'CASH_DUPLICATE_TOPUP'});
});
test('invalid, unbound or non-cash wallet topups cannot enter physical cash reconciliation',()=>{
 assert.throws(()=>reconcileCashWithWallet({...fixed,walletTopups:[
  {...fixed.walletTopups[0],cashSessionId:null}
 ]}),{code:'CASH_WALLET_TOPUP_UNVERIFIED'});
 assert.throws(()=>reconcileCashWithWallet({...fixed,walletTopups:[
  {...fixed.walletTopups[0],paymentMethod:'wallet'}
 ]}),{code:'CASH_WALLET_TOPUP_UNVERIFIED'});
});
test('cash refund must be linked to a known original event',()=>{
 assert.throws(()=>reconcileCashWithWallet({...fixed,cashRefunds:[
  {...fixed.cashRefunds[0],originalOperationId:null}
 ]}),{code:'CASH_REFUND_METHOD_UNVERIFIED'});
});

test('cash refunds from earlier shifts may make this period net negative without inventing revenue',()=>{
 const result=reconcileCashWithWallet({
  orders:[],membershipFees:[],walletTopups:[],
  cashRefunds:[{id:'ref-from-yesterday',amountCents:2500,
    paymentMethod:'cash',originalOperationId:'yesterday-order'}]
 });
 assert.equal(result.cashRefundsCents,2500);
 assert.equal(result.netCashCents,-2500);
 assert.equal(result.walletOrderTransfersCents,0);
});
