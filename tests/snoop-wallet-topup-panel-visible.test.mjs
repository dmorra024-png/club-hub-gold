import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const panel=readFileSync("src/components/WalletTopupPanel.tsx","utf8");
const page=readFileSync("src/routes/_authenticated/soci.$id.tsx","utf8");
const server=readFileSync("src/lib/wallet-management.functions.ts","utf8");
test("member detail offers staff wallet topups regardless of absent frontend flag",()=>{
 assert.ok(page.includes('<WalletTopupPanel memberId={id} />'));
 assert.ok(!panel.includes("VITE_SNOOP_WALLET_OPERATIONS_ENABLED"));
 assert.ok(panel.includes("walletMemberStatus({data:{memberId}})"));
 assert.ok(panel.includes("status?.clubEnabled"));
});
test("existing security and topup flow unchanged",()=>{
 for(const item of ['can("use_cash")','can("manage_members")','walletTopup({data:{memberId','cashSessionId:status!.cashSessionId!','operationId:operation.current!','amountCents:cents,confirmed:true','Confirmar recarga','Confirmo haber recibido este efectivo'])assert.ok(panel.includes(item),item);
 assert.ok(server.includes('SNOOP_WALLET_OPERATIONS_ENABLED'));
 assert.ok(server.includes('requireClubCashAuth'));
 assert.ok(server.includes('requireOperationalClub(context,"manage_members")'));
});
test("show clear message for inactive member and failed server status",()=>{
 assert.ok(panel.includes('Monedero activado para el club, pero no disponible para este socio'));
 assert.ok(panel.includes('No se pudo consultar el monedero'));
});
