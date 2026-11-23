import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=p=>readFileSync(p,"utf8");
const menu=file("src/routes/_authenticated/ajustes.personalizaciones.tsx");
const generales=file("src/routes/_authenticated/ajustes.generales.tsx");
const socios=file("src/routes/_authenticated/ajustes.socios.tsx");
const nav=file("src/components/SnoopLayout.tsx");
const reader=file("src/routes/_authenticated/control-acceso.tsx");
const sql=file("docs/sql/SNOOP_CLUB_MERMA_POLICY_REVIEW.sql");
test("Generales groups three existing/new admin settings and remains one section",()=>{
 assert.ok(menu.includes('to:"/ajustes/generales"'));
 for(const label of ["Control de acceso","merma","descuentos"]){
  assert.ok(menu.includes(label),label);
 }
 for(const panel of ["<ClubAccessControlPanel/>","<ClubMermaSettingsPanel/>","<MemberDiscounts/>"])
  assert.ok(generales.includes(panel),panel);
 assert.ok(generales.includes("if(!isAdmin)"));
 assert.ok(!socios.includes("<MemberDiscounts"));
 assert.ok(socios.includes("MEMBER_FIELDS.map"));
 assert.ok(file("src/components/MemberDiscounts.tsx").includes("Nuevo descuento"));
});
test("club access toggle is secure and entry-scanner-only",()=>{
 const service=file("src/lib/club-access-control.functions.ts");
 const panel=file("src/components/ClubAccessControlPanel.tsx");
 assert.ok(service.includes('snoop_get_club_access_control'));
 assert.ok(service.includes('snoop_set_club_access_control'));
 assert.ok(panel.includes("Control de acceso"));
 assert.ok(panel.includes("snoop:club-access-changed"));
 assert.ok(nav.includes('item.to!=="/control-acceso" || clubAccessEnabled===true'));
 assert.ok(nav.includes('to="/soci/gestisci"'));
 assert.ok(reader.includes("scanPermission.current = canScan && accessControlEnabled===true"));
 assert.ok(reader.includes("accessControlEnabled===false"));
 assert.ok(sql.includes("AS RESTRICTIVE FOR INSERT TO authenticated"));
 assert.ok(sql.includes("c.access_control_enabled=true"));
 assert.ok(sql.includes("is_current_user_club_admin(c)"));
 assert.ok(sql.includes("REVOKE ALL ON FUNCTION public.snoop_set_club_access_control"));
 assert.ok(sql.includes("DEFAULT true"));
});
test("club merma limit still server-enforced on all order payment methods",()=>{
 assert.ok(sql.includes("DEFAULT 0.050"));
 assert.ok(sql.includes("MERMA_EXCEEDS_CLUB_LIMIT"));
 assert.ok(sql.includes("merma>qty*v_merma_limit"));
 assert.ok(sql.includes("CREATE OR REPLACE FUNCTION public.create_order_with_items"));
 assert.ok(file("src/routes/_authenticated/soci.$id.pedido.tsx").includes("getClubMermaSettings()"));
});
