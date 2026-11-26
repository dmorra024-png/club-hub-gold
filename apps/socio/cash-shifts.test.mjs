import test from'node:test';
import assert from'node:assert/strict';
import{collaboratorCashShift,shiftsForClub}from'./cash-shifts.mjs';
const club='4b9f2ad0-8c1f-4e44-80c8-7b879ad7a0cc',other='63d9ce2d-6e6c-4d1f-8979-98f2c54d1cb4';
const staff='9d5d3ca0-de23-467b-8ad4-211fce9003b9',otherStaff='66dd818b-4a9d-4c45-965d-45d497873cad';
const base={id:'f78e650f-66e1-40af-b1cd-4f8151cfda96',clubId:club,userId:staff,
 openedAt:'2026-11-18T09:23:00+01:00',closedAt:null,closedBy:null,status:'open'};
test('shift begins when a collaborator actually opens cash; no predetermined end',()=>{
 const s=collaboratorCashShift(base);
 assert.equal(s.status,'open');assert.equal(s.endedAt,null);
 assert.equal(s.startedAt,'2026-11-18T08:23:00.000Z');
 assert.equal(s.collaboratorId,staff);
});
test('shift closes at recorded time even across midnight and by authorized handover',()=>{
 const s=collaboratorCashShift({...base,openedAt:'2026-11-18T22:42:00+01:00',
 closedAt:'2026-11-19T02:17:00+01:00',closedBy:otherStaff,status:'closed'});
 assert.equal(s.durationMs,215*60000);
 assert.equal(s.closedBy,otherStaff);
});
test('each club can open and close at distinct times; another club must not leak',()=>{
 const list=shiftsForClub([
 {...base,openedAt:'2026-11-18T18:13:00+01:00'},
 {...base,id:'d628e96e-368a-4d9a-bef8-d470181d0d01',openedAt:'2026-11-18T06:11:00+01:00',
 closedAt:'2026-11-18T08:33:00+01:00',closedBy:staff,status:'closed'}
 ],club);
 assert.equal(list.length,2);assert.equal(list[0].status,'closed');
 assert.throws(()=>shiftsForClub([{...base,clubId:other}],club),/CASH_TENANT_MISMATCH/);
});
test('missing close audit, reversed chronology and false statuses fail closed',()=>{
 assert.throws(()=>collaboratorCashShift({...base,closedAt:'2026-11-18T08:00:00+01:00',closedBy:staff,status:'closed'}),/CASH_SESSION_TIME_INVALID/);
 assert.throws(()=>collaboratorCashShift({...base,closedAt:'2026-11-18T10:00:00+01:00',status:'closed'}),/CASH_CLOSER_REQUIRED/);
 assert.throws(()=>collaboratorCashShift({...base,status:'closed'}),/CASH_SESSION_STATUS_INVALID/);
});
