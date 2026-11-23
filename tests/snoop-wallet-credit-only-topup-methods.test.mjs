import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const pedido=readFileSync("src/routes/_authenticated/soci.$id.pedido.tsx","utf8");
const wallet=readFileSync("src/components/WalletTopupPanel.tsx","utf8");
const server=readFileSync("src/lib/wallet-management.functions.ts","utf8");
const evidence=readFileSync("src/lib/cash-wallet-evidence.server.ts","utf8");
const cash=readFileSync("src/lib/cash-sessions.ts","utf8");
const migration=readFileSync("docs/sql/SNOOP_WALLET_CREDIT_ONLY_TOPUP_METHODS_REVIEW.sql","utf8");
test("enabled club orders show only wallet credits, not cash/POS/transfer",()=>{
 assert.ok(pedido.includes("walletMode ? ("));
 assert.ok(pedido.includes('aria-label="Pago con créditos"'));
 assert.ok(pedido.includes('créditos del Monedero') || pedido.includes('créditos"'));
 assert.ok(pedido.includes('walletMode && paymentChoice!=="wallet"'));
 assert.ok(pedido.includes('!walletState || walletStatusError'));
 assert.ok(!pedido.includes('VITE_SNOOP_WALLET_OPERATIONS_ENABLED'));
 assert.ok(pedido.includes('walletCheckout({data:'));
 assert.ok(pedido.includes('formatCheckoutAmount(total)'));
});
test("payment methods now belong to wallet recharges with 1-to-1 credit display",()=>{
 for(const label of ["Método de cobro de la recarga","Efectivo","Tarjeta / POS","Transferencia","1 € recibido = 1 crédito","wallet-topup-method","paymentMethod:receiptMethod","Créditos a añadir"])assert.ok(wallet.includes(label),label);
 assert.ok(server.includes('paymentMethod:z.enum(["cash","card","transfer"])'));
 assert.ok(server.includes('socio_wallet_topup_with_method'));
 assert.ok(server.includes('SNOOP_WALLET_OPERATIONS_ENABLED'));
 assert.ok(server.includes('requireClubCashAuth'));
 assert.ok(server.includes('requireOperationalClub(context,"manage_members")'));
});
test("cash sessions classify topups based on authenticated receipt method",()=>{
 assert.ok(evidence.includes('row.paymentMethod'));
 assert.ok(cash.includes('t.paymentMethod ?? "cash"'));
 assert.ok(migration.includes("'paymentMethod',coalesce(l.payment_method,'cash')"));
 assert.ok(migration.includes("p_payment_method NOT IN ('cash','card','transfer')"));
 assert.ok(migration.includes("coalesce(v_stored,'cash') <> p_payment_method"));
});
test("database rejects a direct money order for a wallet-enabled club without altering legacy orders",()=>{
 assert.ok(migration.includes("IF v_wallet_enabled IS TRUE THEN"));
 assert.ok(migration.includes("Este club solo acepta pedidos con créditos Monedero"));
 assert.ok(migration.includes("public.socio_wallet_topup("));
 assert.ok(migration.includes("REVOKE ALL ON FUNCTION"));
 assert.ok(!migration.includes("UPDATE public.socio_wallet_accounts"));
});
