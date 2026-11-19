import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWalletCashTopup,validateWalletOrderEvent} from './wallet-cash-guards.mjs';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',other='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const memberId='c319b1ed-9389-4c81-9e7f-42f808d95c34',staffId='9d5d3ca0-de23-467b-8ad4-211fce9003b9';
const sessionId='f78e650f-66e1-40af-b1cd-4f8151cfda96',orderId='d628e96e-368a-4d9a-bef8-d470181d0d01';
const debitId='437f044d-9c4d-4b95-8672-d2b8c9af3851';
const staff={userId:staffId,clubId:club},member={id:memberId,clubId:club,active:true,revokedAt:null};
const session={id:sessionId,clubId:club,userId:staffId,status:'open',openedAt:'2026-11-18T21:15:00+01:00',closedAt:null};
const op={kind:'topup',clubId:club,memberId,cashSessionId:sessionId,amountCents:3000};
const order={id:orderId,clubId:club,memberId,totalCents:1000,status:'completed',cancelledAt:null};
const spend={kind:'spend',clubId:club,memberId,orderId,amountCents:1000};
const debit={kind:'spend',operationId:debitId,clubId:club,memberId,orderId,amountCents:1000};
const refund={kind:'refund',clubId:club,memberId,orderId,reversalOf:debitId,amountCents:1000};
const now=Date.parse('2026-11-19T02:15:00+01:00');
test('an active cash session is valid regardless of club opening hours or crossing midnight',()=>{
 assert.equal(validateWalletCashTopup({operation:op,staff,session,member,now}),true);
});
test('topup refuses a closed cash session even if it belongs to the correct worker',()=>{
 assert.throws(()=>validateWalletCashTopup({operation:op,staff,session:{...session,status:'closed',closedAt:'2026-11-19T00:30:00+01:00'},member,now}),{code:'WALLET_CASH_SESSION_CLOSED'});
});
test('topup refuses foreign club cash, shift ownership mismatch and revoked member',()=>{
 assert.throws(()=>validateWalletCashTopup({operation:op,staff,session:{...session,clubId:other},member,now}),{code:'WALLET_CASH_SCOPE_DENIED'});
 assert.throws(()=>validateWalletCashTopup({operation:op,staff,session:{...session,userId:memberId},member,now}),{code:'WALLET_SHIFT_NOT_OWNED'});
 assert.throws(()=>validateWalletCashTopup({operation:op,staff,session,member:{...member,active:false},now}),{code:'WALLET_MEMBER_INACTIVE'});
});
test('a spend requires the exact matching completed order and same-club member',()=>{
 assert.equal(validateWalletOrderEvent({operation:spend,order,member}),true);
 assert.throws(()=>validateWalletOrderEvent({operation:spend,order:{...order,clubId:other},member}),{code:'WALLET_ORDER_SCOPE_DENIED'});
 assert.throws(()=>validateWalletOrderEvent({operation:spend,order:{...order,status:'cancelled'},member}),{code:'WALLET_ORDER_NOT_COMPLETED'});
 assert.throws(()=>validateWalletOrderEvent({operation:{...spend,amountCents:999},order,member}),{code:'WALLET_ORDER_AMOUNT_MISMATCH'});
});
test('refund needs a cancelled order and exact original debit',()=>{
 const cancelled={...order,status:'cancelled',cancelledAt:'2026-11-19T02:00:00Z'};
 assert.equal(validateWalletOrderEvent({operation:refund,order:cancelled,member,previousDebit:debit}),true);
 assert.throws(()=>validateWalletOrderEvent({operation:refund,order,member,previousDebit:debit}),{code:'WALLET_ORDER_NOT_CANCELLED'});
 assert.throws(()=>validateWalletOrderEvent({operation:refund,order:cancelled,member,previousDebit:{...debit,orderId:sessionId}}),{code:'WALLET_REVERSAL_NOT_MATCHED'});
});
