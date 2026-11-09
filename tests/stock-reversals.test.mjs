import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";

const finance = await readFile("docs/sql/SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql","utf8");
const stock = await readFile("docs/sql/SNOOP_STOCK_REVERSALS_PROPOSED.sql","utf8");

async function setup({ waste = 0, linked = true } = {}) {
 const db = await separationDatabase();
 for (const m of ["20261106150000_platform_club_separation.sql","20261107120000_catalog_lifecycle.sql","20261107123000_membership_payment_flow.sql"])
  await db.exec(await readFile("supabase/migrations/"+m,"utf8"));
 await db.exec(`INSERT INTO auth.users(id,email) VALUES ('${uid(1)}','owner@test.invalid'),('${uid(2)}','staff@test.invalid'),('${uid(3)}','other@test.invalid');
 INSERT INTO clubs(id,name,slug) VALUES ('${uid(101)}','Alpha','alpha'),('${uid(102)}','Beta','beta');
 INSERT INTO user_roles(user_id,role,club_id,permissions) VALUES ('${uid(1)}','admin','${uid(101)}','{}'),('${uid(2)}','collaborator','${uid(101)}','{manage_members,use_cash}'),('${uid(3)}','admin','${uid(102)}','{}');
 INSERT INTO members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES ('${uid(501)}','${uid(101)}','Test','Member','1990-01-01','A-TEST','2027-01-01');
 INSERT INTO product_categories(id,club_id,name) VALUES ('${uid(201)}','${uid(101)}','Test category');
 INSERT INTO products(id,club_id,category_id,name,stock) VALUES ('${uid(301)}','${uid(101)}','${uid(201)}','Test product',7);
 INSERT INTO orders(id,club_id,member_id,created_by,total_cents,status) VALUES ('${uid(701)}','${uid(101)}','${uid(501)}','${uid(2)}',3000,'completed');
 INSERT INTO order_items(id,order_id,club_id,product_id,product_name,unit_type,quantity,unit_price_cents,line_total_cents) VALUES ('${uid(801)}','${uid(701)}','${uid(101)}','${uid(301)}','Test product','unit',3,1000,3000);`);
 await db.exec(finance);
 await db.exec(stock);
 if (linked) await db.query("INSERT INTO stock_movements(club_id,product_id,delta,reason,notes,created_by,sale_order_id) VALUES($1,$2,$3,'sale','Test debit',$4,$5)",
  [uid(101),uid(301),-(3+waste),uid(2),uid(701)]);
 const actor=(n,sql,params=[])=>db.transaction(async tx=>{
  await tx.exec("SET LOCAL ROLE authenticated");
  await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[uid(n)]);
  return tx.query(sql,params);
 });
 const annul=(n,reason="Correction tested")=>actor(n,"SELECT annul_financial_order($1,$2,$3)",[uid(501),uid(701),reason]);
 return {db,actor,annul};
}

test("restores delivered stock once, reverses accounting and retains audit",async()=>{
 const {db,annul}=await setup();
 try {
  await annul(2); await annul(2);
  assert.equal(Number((await db.query("SELECT stock FROM products WHERE id=$1",[uid(301)])).rows[0].stock),10);
  assert.equal(Number((await db.query("SELECT count(*) n FROM stock_movements WHERE reversal_order_id=$1",[uid(701)])).rows[0].n),1);
  assert.equal(Number((await db.query("SELECT count(*) n FROM financial_order_reversals WHERE order_id=$1",[uid(701)])).rows[0].n),1);
 } finally {await db.close();}
});
test("waste is never returned as sellable stock",async()=>{
 const {db,annul}=await setup({waste:1});
 try {await annul(1);assert.equal(Number((await db.query("SELECT stock FROM products WHERE id=$1",[uid(301)])).rows[0].stock),10);}
 finally {await db.close();}
});
test("missing legacy evidence rolls back accounting and stock",async()=>{
 const {db,annul}=await setup({linked:false});
 try {
  await assert.rejects(annul(1),/Missing or inconsistent sale debit/);
  assert.equal((await db.query("SELECT status FROM orders WHERE id=$1",[uid(701)])).rows[0].status,"completed");
  assert.equal(Number((await db.query("SELECT stock FROM products WHERE id=$1",[uid(301)])).rows[0].stock),7);
  assert.equal(Number((await db.query("SELECT count(*) n FROM financial_order_reversals")).rows[0].n),0);
 } finally {await db.close();}
});
test("other-club actor cannot reverse another club's sale",async()=>{
 const {db,annul}=await setup();
 try {await assert.rejects(annul(3),/Forbidden|Registro no disponible/);assert.equal(Number((await db.query("SELECT stock FROM products WHERE id=$1",[uid(301)])).rows[0].stock),7);}
 finally {await db.close();}
});
