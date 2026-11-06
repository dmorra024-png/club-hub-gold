import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid as id } from "./helpers/separation-db.mjs";
let db;
const club = (n) => id(100 + n),
  member = (n) => id(200 + n),
  product = (n) => id(300 + n);
let preserved;
async function actor(n, sql, role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE " + role);
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [n ? id(n) : ""]);
    return tx.query(sql);
  });
}
before(async () => {
  db = await separationDatabase();
  for (let n = 1; n <= 7; n++)
    await db.exec(
      `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${id(n)}','synthetic-${n}@example.test',now())`,
    );
  for (let n = 1; n <= 2; n++)
    await db.exec(`INSERT INTO public.clubs(id,name,slug) VALUES('${club(n)}','Synthetic Club ${n}','synthetic-${n}');
 INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents) VALUES('${id(400 + n)}','${club(n)}','Synthetic',30,100);
 INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${member(n)}','${club(n)}','Synthetic','Member','2000-01-01','FAKE-${n}',current_date+30);
 INSERT INTO public.product_categories(id,club_id,name,unit_type,is_smokeable) VALUES('${id(500 + n)}','${club(n)}','Synthetic','unit',false);
 INSERT INTO public.products(id,club_id,category_id,name,stock,buy_price,sell_price) VALUES('${product(n)}','${club(n)}','${id(500 + n)}','Synthetic',10,0,0);
 INSERT INTO public.stock_movements(club_id,product_id,delta) VALUES('${club(n)}','${product(n)}',1);
 INSERT INTO public.cash_sessions(club_id,user_id) VALUES('${club(n)}','${id(n === 1 ? 2 : 4)}');
 INSERT INTO public.check_ins(club_id,member_id,direction) VALUES('${club(n)}','${member(n)}','in');
 INSERT INTO public.club_member_field_config(club_id,field_key) VALUES('${club(n)}','phone');
 INSERT INTO public.orders(club_id,member_id) VALUES('${club(n)}','${member(n)}');
 INSERT INTO public.membership_receipts(club_id,member_id,member_number,member_name,recorded_by,operator_name,amount_cents,payment_method,description,request_id) VALUES('${club(n)}','${member(n)}','SYNTHETIC','Synthetic','${id(n === 1 ? 2 : 4)}','Synthetic',100,'cash','Synthetic',gen_random_uuid());
 INSERT INTO storage.objects(bucket_id,name) VALUES('snoop-docs','clubs/${club(n)}/members/${member(n)}/synthetic.txt');`);
  await db.exec(`INSERT INTO public.user_roles(user_id,role,club_id,permissions) VALUES
 ('${id(1)}','super_admin',NULL,'{}'),('${id(1)}','admin','${club(1)}','{}'),
 ('${id(2)}','admin','${club(1)}','{}'),('${id(4)}','admin','${club(2)}','{}'),
 ('${id(3)}','collaborator','${club(1)}',ARRAY['manage_members']::public.app_permission[]),
 ('${id(5)}','collaborator','${club(1)}','{}'),
 ('${id(6)}','collaborator','${club(1)}',ARRAY['use_cash']::public.app_permission[]),
 ('${id(7)}','collaborator','${club(1)}',ARRAY['view_reports']::public.app_permission[]);`);
  preserved = (await db.query("SELECT * FROM public.members ORDER BY id")).rows;
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261106150000_platform_club_separation.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => await db?.close());
test("upgrade preserves accounts, both historical platform/club roles and private records", async () => {
  assert.deepEqual((await db.query("SELECT * FROM public.members ORDER BY id")).rows, preserved);
  assert.equal((await db.query("SELECT * FROM auth.users")).rows.length, 7);
  assert.equal(
    (await db.query(`SELECT * FROM public.user_roles WHERE user_id='${id(1)}'`)).rows.length,
    2,
  );
});
test("platform identity has zero operational access even with a historical admin membership", async () => {
  const access = (await actor(1, "SELECT public.snoop_access_context() AS a")).rows[0].a;
  assert.equal(access.role, "super_admin");
  assert.equal(access.clubId, null);
  assert.deepEqual(access.permissions, []);
  assert.equal((await actor(1, "SELECT public.current_club_id() AS c")).rows[0].c, null);
  for (const t of [
    "members",
    "membership_plans",
    "products",
    "product_categories",
    "stock_movements",
    "cash_sessions",
    "check_ins",
    "club_member_field_config",
    "orders",
    "order_items",
    "membership_receipts",
  ])
    assert.equal((await actor(1, `SELECT * FROM public.${t}`)).rows.length, 0, t);
  assert.equal((await actor(1, "SELECT * FROM storage.objects")).rows.length, 0);
  assert.deepEqual(
    (await actor(1, "SELECT id FROM public.profiles")).rows.map((x) => x.id),
    [id(1)],
  );
});
test("even platform identities cannot directly manage clubs or assign roles from browser", async () => {
  for (const n of [1, 2, 3])
    for (const sql of [
      "INSERT INTO public.clubs(name,slug) VALUES('Forbidden','forbidden')",
      "UPDATE public.clubs SET active=false",
      `INSERT INTO public.user_roles(user_id,role) VALUES('${id(5)}','super_admin')`,
    ])
      await assert.rejects(actor(n, sql), /permission denied/);
  assert.equal((await actor(1, "SELECT * FROM public.clubs")).rows.length, 0);
});
test("admin A cannot read, insert or update admin B private records", async () => {
  assert.equal(
    (await actor(2, `SELECT * FROM public.members WHERE club_id='${club(2)}'`)).rows.length,
    0,
  );
  assert.equal(
    (
      await actor(
        2,
        `UPDATE public.members SET city='Forbidden' WHERE club_id='${club(2)}' RETURNING id`,
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    actor(
      2,
      `INSERT INTO public.members(club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${club(2)}','Synthetic','Forbidden','2000-01-01','FAKE-X',current_date+30)`,
    ),
    /row-level security/,
  );
});
test("privileged RPCs deny the platform user and another club admin", async () => {
  for (const n of [1, 4])
    for (const sql of [
      `SELECT public.record_membership_receipt('${club(1)}','${member(1)}',100,'cash','Synthetic','${id(900)}')`,
      `SELECT public.membership_receipt_report('${club(1)}',current_date,current_date+1,'day')`,
      `SELECT public.save_administrative_product('${product(1)}','{}')`,
      `SELECT public.adjust_administrative_stock('${product(1)}',1,10,'Synthetic')`,
      `SELECT public.create_order_with_items('${member(1)}',NULL,'[]')`,
    ])
      await assert.rejects(actor(n, sql));
});
test("staff reads only authorized domains and cannot self-escalate", async () => {
  assert.equal((await actor(3, "SELECT * FROM public.members")).rows.length, 1);
  assert.equal((await actor(3, "SELECT * FROM public.products")).rows.length, 0);
  assert.equal((await actor(5, "SELECT * FROM public.members")).rows.length, 0);
  assert.equal((await actor(5, "SELECT * FROM public.membership_receipts")).rows.length, 0);
  assert.equal((await actor(7, "SELECT * FROM public.membership_receipts")).rows.length, 1);
  assert.equal((await actor(7, "SELECT * FROM public.check_ins")).rows.length, 1);
  await assert.rejects(actor(3, "UPDATE public.user_roles SET role='admin'"), /permission denied/);
});
test("suspension immediately blocks existing sessions, RPCs and documents; B is unaffected", async () => {
  await db.exec(`UPDATE public.clubs SET active=false WHERE id='${club(1)}'`);
  for (const n of [2, 3, 5, 6, 7]) {
    const access = (await actor(n, "SELECT public.snoop_access_context() AS a")).rows[0].a;
    assert.equal(access.status, "suspended");
    assert.deepEqual(access.permissions, []);
    for (const t of ["members", "products", "membership_receipts", "check_ins", "cash_sessions"])
      assert.equal((await actor(n, `SELECT * FROM public.${t}`)).rows.length, 0);
    assert.equal((await actor(n, "SELECT * FROM storage.objects")).rows.length, 0);
    await assert.rejects(
      actor(
        n,
        `SELECT public.record_membership_receipt('${club(1)}','${member(1)}',100,'cash','Synthetic','${id(901)}')`,
      ),
    );
  }
  assert.equal((await actor(4, "SELECT * FROM public.members")).rows.length, 1);
  assert.equal(
    (await actor(2, `SELECT * FROM public.profiles WHERE id='${id(2)}'`)).rows.length,
    1,
    "own identity remains available for recovery",
  );
  assert.deepEqual((await db.query("SELECT * FROM public.members ORDER BY id")).rows, preserved);
});
test("reactivation restores the same sessions and records without recreating accounts", async () => {
  await db.exec(`UPDATE public.clubs SET active=true WHERE id='${club(1)}'`);
  assert.equal(
    (await actor(2, "SELECT public.snoop_access_context() AS a")).rows[0].a.status,
    "active",
  );
  assert.equal((await actor(2, "SELECT * FROM public.members")).rows.length, 1);
  assert.equal((await actor(2, "SELECT * FROM storage.objects")).rows.length, 1);
});
test("subscription expiry is enforced in DB; extension restores access", async () => {
  await db.exec(
    `UPDATE public.clubs SET subscription_expires_at=now()-interval '1 second' WHERE id='${club(1)}'`,
  );
  assert.equal(
    (await actor(2, "SELECT public.snoop_access_context() AS a")).rows[0].a.status,
    "expired",
  );
  assert.equal((await actor(2, "SELECT * FROM public.members")).rows.length, 0);
  await assert.rejects(
    actor(2, `SELECT public.adjust_administrative_stock('${product(1)}',1,10,'Synthetic')`),
  );
  await db.exec(
    `UPDATE public.clubs SET subscription_expires_at=now()+interval '1 day' WHERE id='${club(1)}'`,
  );
  assert.equal((await actor(2, "SELECT * FROM public.members")).rows.length, 1);
});
test("authorized admin registers a member and receipt after reactivation; staff restrictions remain", async () => {
  await actor(
    2,
    `INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${id(902)}','${club(1)}','Synthetic','New Member','2000-01-01','FAKE-NEW',current_date+30)`,
  );
  assert.equal(
    (
      await actor(
        2,
        `SELECT (public.record_membership_receipt('${club(1)}','${id(902)}',100,'cash','Synthetic','${id(903)}')).amount_cents AS amount`,
      )
    ).rows[0].amount,
    100,
  );
  await assert.rejects(
    actor(
      3,
      `SELECT public.record_membership_receipt('${club(1)}','${id(902)}',100,'cash','Forbidden','${id(904)}')`,
    ),
  );
});

test("cash staff lookup returns minimal receipt identity without access to member documents or full rows", async () => {
  assert.equal((await actor(6, "SELECT * FROM public.members")).rows.length, 0);
  const rows = (
    await actor(6, `SELECT * FROM public.lookup_receipt_members('${club(1)}','Synthetic')`)
  ).rows;
  assert.ok(rows.length >= 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["first_name", "id", "last_name", "member_number"]);
  for (const n of [1, 4, 5, 7])
    await assert.rejects(
      actor(n, `SELECT * FROM public.lookup_receipt_members('${club(1)}','Synthetic')`),
    );
  await db.exec(`UPDATE public.clubs SET active=false WHERE id='${club(1)}'`);
  await assert.rejects(
    actor(6, `SELECT * FROM public.lookup_receipt_members('${club(1)}','Synthetic')`),
  );
  await db.exec(`UPDATE public.clubs SET active=true WHERE id='${club(1)}'`);
});

test("all public tables retain RLS and operational tenant fences remain restrictive", async () => {
  const tables = (
    await db.query("SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='public'")
  ).rows;
  assert.equal(tables.length, 18);
  assert.ok(tables.every((t) => t.rowsecurity));
  const policies = (
    await db.query(
      "SELECT tablename,policyname,permissive,qual,with_check FROM pg_policies WHERE schemaname='public' OR schemaname='storage'",
    )
  ).rows;
  assert.equal(
    policies.filter((p) => p.policyname === "snoop_tenant_fence" && p.permissive === "RESTRICTIVE")
      .length,
    11,
  );
  assert.ok(
    !policies.some((p) => /^\(*true\)*$/.test(p.qual) || /^\(*true\)*$/.test(p.with_check)),
  );
  for (const sql of [
    "SELECT public.snoop_access_context()",
    `SELECT * FROM public.lookup_receipt_members('${club(1)}','Synthetic')`,
  ])
    await assert.rejects(actor(null, sql, "anon"), /permission denied/);
});
