import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const order=readFileSync("src/routes/_authenticated/soci.$id.pedido.tsx","utf8");
const ledger=readFileSync("src/lib/cash-ledger.ts","utf8");
const cash=readFileSync("src/lib/cash-sessions.server.ts","utf8");
const dialog=readFileSync("src/components/FinancialRecordDialog.tsx","utf8");
const ddl=readFileSync("docs/sql/SNOOP_ORDER_PAYMENT_MERMA_PILOT_REVIEW.sql","utf8");
test("payment selection is explicit and supports cash, card, transfer without changing wallet checkout",()=>{
 for(const mark of [
  'useState<""|"cash"|"card"|"transfer"|"wallet">("")',
  'Selecciona la forma de pago',
  'create_order_with_items_and_payment',
  '_payment_method:paymentChoice',
  'name="order-payment-method" value="card"',
  'name="order-payment-method" value="transfer"',
  'name="order-payment-method" value="wallet"',
  'walletCheckout({data:',
  'disabled={!cart.length || !paymentChoice'
 ])assert.ok(order.includes(mark),mark);
 assert.ok(!order.includes('supabase.rpc as any)("create_order_with_items",'));
});
test("historical payment records stay unverified and wallet evidence takes precedence",()=>{
 assert.ok(ledger.includes('cash_session_id,status,payment_method'));
 assert.ok(cash.includes('walletEvidence.walletOrderIds.has(order.id)?"wallet":(order.payment_method??null)'));
 assert.ok(ddl.includes('ADD COLUMN IF NOT EXISTS payment_method text'));
 assert.ok(!ddl.includes('DEFAULT \'cash\''));
});
test("original authenticated checkout remains atomic and no POS or wallet processing is invented",()=>{
 assert.ok(ddl.includes('created := public.create_order_with_items(_member_id,_notes,_items);'));
 assert.ok(ddl.includes('UPDATE public.orders'));
 assert.ok(ddl.includes("NOT IN ('cash','card','transfer')"));
 assert.ok(ddl.includes('SECURITY DEFINER SET search_path TO \'\''));
 assert.ok(ddl.includes('REVOKE ALL ON FUNCTION'));
 assert.ok(ddl.includes('TO authenticated'));
});
test("cancellation restores exact original stock debit including merma, once, with audit trail",()=>{
 assert.ok(ddl.includes("m.sale_order_id=OLD.id"));
 assert.ok(ddl.includes("m.reason='sale' AND m.delta<0"));
 assert.ok(ddl.includes("IF movement_count=0 OR debit_total<line.qty"));
 assert.ok(ddl.includes("stock=stock+debit_total"));
 assert.ok(ddl.includes("line.product_id,debit_total,'sale_cancellation'"));
 assert.ok(dialog.includes("incluida la merma registrada"));
 assert.ok(ddl.includes("auth.uid() IS DISTINCT FROM NEW.cancelled_by"));
});
