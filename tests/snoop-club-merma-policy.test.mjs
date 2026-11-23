import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=p=>readFileSync(p,"utf8");
const menu=file("src/routes/_authenticated/ajustes.personalizaciones.tsx");
const panel=file("src/components/ClubMermaSettingsPanel.tsx");
const functions=file("src/lib/club-merma.functions.ts");
const order=file("src/routes/_authenticated/soci.$id.pedido.tsx");
const sql=file("docs/sql/SNOOP_CLUB_MERMA_POLICY_REVIEW.sql");
test("merma field is under Generales in Personalizaciones club",()=>{
 assert.ok(menu.includes('to:"/ajustes/generales"'));
 assert.ok(file("src/routes/_authenticated/ajustes.generales.tsx").includes("<ClubMermaSettingsPanel/>"));
 for(const to of ["/ajustes/cuotas","/ajustes/monedero","/ajustes/socios","/ajustes/dispositivos","/ajustes/tema-visual"])assert.ok(menu.includes(to),to);
 assert.ok(!menu.includes('to:"/ajustes/merma"'));
 assert.ok(panel.includes("Merma permitida"));
 assert.ok(panel.includes("0,050"));
 assert.ok(panel.includes("Guardar límite"));
});
test("only club admin can change setting; staff can read for orders",()=>{
 assert.ok(functions.includes(".middleware([requireSupabaseClubAuth])"));
 assert.ok(functions.includes("snoop_get_club_merma"));
 assert.ok(functions.includes("snoop_set_club_merma"));
 assert.ok(sql.includes("is_current_user_club_admin(c)"));
 assert.ok(sql.includes("can_operate_club(c,NULL)"));
 assert.ok(sql.includes("REVOKE ALL ON FUNCTION"));
 assert.ok(sql.includes("FROM PUBLIC,anon"));
});
test("server enforces configured ratio on both cash and wallet orders",()=>{
 assert.ok(sql.includes("max_merma_per_gram numeric(6,3) NOT NULL DEFAULT 0.050"));
 assert.ok(sql.includes("MERMA_EXCEEDS_CLUB_LIMIT"));
 assert.ok(sql.includes("merma>qty*v_merma_limit+0.000001"));
 assert.ok(sql.includes("create_order_with_items("));
 assert.ok(order.includes("getClubMermaSettings()"));
 assert.ok(order.includes("q - b <= (mermaLimit??0) * b"));
 assert.ok(order.includes("cur.merma>cur.quantity*(mermaLimit??0)"));
 assert.ok(order.includes("cart.some(c=>"));
 assert.ok(!sql.includes("UPDATE public.socio_wallet_accounts"));
});
test("existing financial and stock business flows stay untouched",()=>{
 assert.ok(order.includes('walletCheckout({data:{'));
 assert.ok(order.includes('"create_order_with_items_and_payment"'));
 assert.ok(sql.includes("stock_delta := qty + merma"));
 assert.ok(sql.includes("UPDATE public.products SET stock = stock - stock_delta"));
});
