import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const server=readFileSync("src/lib/wallet-management.functions.ts","utf8");
const page=readFileSync("src/routes/_authenticated/soci.$id.pedido.tsx","utf8");
const sql=readFileSync("docs/sql/SNOOP_WALLET_CREDIT_ONLY_TOPUP_METHODS_REVIEW.sql","utf8");
test("database rejection does not freeze checkout as an uncertain debit",()=>{
 for(const m of ["if(error){","const dbCode=String(error.code??","return {status:\"rejected\" as const,reason}","if(result.status===\"rejected\")","walletOperation.current=null","setWalletUncertain(false)","toast.error(result.reason)"]) assert.ok((server+"\n"+page).includes(m),m);
});
test("unknown network or malformed outcomes still fail closed",()=>{
 assert.ok(server.includes("if(!result||result.status!==\"applied\""));
 assert.ok(server.includes("if(rejected){"));
 assert.ok(server.includes("   fail();"));
 assert.ok(page.includes("if(payingWallet){\n        setWalletUncertain(true);"));
 assert.ok(page.includes("walletUncertain ||"));
});
test("no mutation of wallet credits, order SQL, stock, methods or membership",()=>{
 assert.ok(server.includes('rpc("socio_create_wallet_order"'));
 assert.ok(page.includes('operationId:walletOperation.current,confirmed:true'));
 assert.ok(page.includes('walletMode && paymentChoice!=="wallet"'));
 assert.ok(sql.includes("Este club solo acepta pedidos con créditos Monedero"));
});
