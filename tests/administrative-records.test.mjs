import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { paymentReview } from "../src/lib/administrative-payment.ts";
import {
  memberOrderHistory,
  annulFinancialRecord,
} from "../src/lib/member-order-history.server.ts";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
let db, original;
const club = uid(101),
  other = uid(102),
  plan = uid(401),
  member = uid(511),
  order = uid(701);
async function actor(n, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
    return tx.query(sql, params);
  });
}
before(async () => {
  db = await separationDatabase();
  for (const f of [
    "20261106150000_platform_club_separation.sql",
    "20261107120000_catalog_lifecycle.sql",
    "20261107123000_membership_payment_flow.sql",
  ])
    await db.exec(await readFile(new URL("../supabase/migrations/" + f, import.meta.url), "utf8"));
  for (let n = 1; n <= 5; n++)
    await db.query("INSERT INTO auth.users(id,email)VALUES($1,$2)", [
      uid(n),
      `record-${n}@example.test`,
    ]);
  await db.exec(`INSERT INTO public.clubs(id,name,slug)VALUES('${club}','Records A','records-a'),('${other}','Records B','records-b');
 INSERT INTO public.user_roles(user_id,role,club_id,permissions)VALUES('${uid(1)}','admin','${club}','{}'),('${uid(2)}','admin','${other}','{}'),('${uid(3)}','collaborator','${club}','{manage_members,use_cash}'),('${uid(4)}','collaborator','${club}','{manage_members}'),('${uid(5)}','super_admin',NULL,'{}');
 INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents)VALUES('${plan}','${club}','Test fee',30,1000);
 INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)VALUES('${member}','${club}','A','Synthetic','1990-01-01','TEST-A','2026-12-31'),('${uid(512)}','${other}','B','Synthetic','1990-01-01','TEST-B','2026-12-31');
 INSERT INTO public.product_categories(id,club_id,name)VALUES('${uid(201)}','${club}','Office');
 INSERT INTO public.products(id,club_id,category_id,name,stock)VALUES('${uid(301)}','${club}','${uid(201)}','Notebook',10);
 INSERT INTO public.orders(id,club_id,member_id,created_by,total_cents,status,notes)VALUES('${order}','${club}','${member}','${uid(1)}',1000,'completed','Original record'),('${uid(702)}','${other}','${uid(512)}','${uid(2)}',2000,'completed','Other club'),('${uid(703)}','${club}','${member}','${uid(3)}',500,'completed','Own staff record'),('${uid(704)}','${club}','${member}','${uid(1)}',300,'cancelled','Legacy cancelled');
 INSERT INTO public.order_items(order_id,club_id,product_id,product_name,unit_type,quantity,unit_price_cents,line_total_cents)VALUES('${order}','${club}','${uid(301)}','Notebook','unit',1,1000,1000);`);
  original = (
    await db.query("SELECT id,total_cents,status,notes,created_at FROM public.orders ORDER BY id")
  ).rows;
  const sql = await readFile(
    new URL("../docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql", import.meta.url),
    "utf8",
  );
  await db.exec(
    `CREATE FUNCTION public.test_order_side_effect() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER unexpected_update BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.test_order_side_effect();`,
  );
  await assert.rejects(db.exec(sql), /Unexpected order UPDATE trigger/);
  await db.exec(
    "ROLLBACK;DROP TRIGGER unexpected_update ON public.orders;DROP FUNCTION public.test_order_side_effect();",
  );
  await db.exec(sql);
});
after(async () => await db?.close());
test("administrative confirmation parses euro decimals exactly; insufficient/invalid cash cannot confirm", () => {
  assert.deepEqual(paymentReview(7500, "cash", "100"), {
    totalCents: 7500,
    receivedCents: 10000,
    changeCents: 2500,
  });
  assert.equal(paymentReview(7500, "cash", "74,99"), null);
  assert.equal(paymentReview(7500, "cash", ""), null);
  assert.equal(paymentReview(7500, "cash", "1e3"), null);
  assert.deepEqual(paymentReview(7500, "card", ""), {
    totalCents: 7500,
    receivedCents: null,
    changeCents: null,
  });
  assert.equal(paymentReview(7500, "unknown", "100"), null);
});
test("proposal preserves existing original records and leaves legacy cancellation identity unknown", async () => {
  assert.deepEqual(
    (await db.query("SELECT id,total_cents,status,notes,created_at FROM public.orders ORDER BY id"))
      .rows,
    original,
  );
  const legacy = (
    await db.query(
      "SELECT cancelled_at,cancelled_by,cancellation_reason FROM public.orders WHERE id=$1",
      [uid(704)],
    )
  ).rows[0];
  assert.deepEqual(legacy, { cancelled_at: null, cancelled_by: null, cancellation_reason: null });
});
test("fee confirmation stores only authoritative fee, is idempotent and rejects changed prices or unauthorized staff", async () => {
  const data = {
    id: uid(501),
    first_name: "Persona",
    last_name: "Sintética",
    birth_date: "1990-01-01",
    dni_number: "FEE-TEST",
  };
  const args = [JSON.stringify(data), plan, "cash", uid(601), false, null, 1000];
  const sql = "SELECT public.confirm_membership_with_receipt($1,$2,$3,$4,$5,$6,$7)";
  await actor(3, sql, args);
  await actor(3, sql, args);
  assert.deepEqual(
    (
      await db.query("SELECT amount_cents FROM public.membership_receipts WHERE request_id=$1", [
        uid(601),
      ])
    ).rows,
    [{ amount_cents: 1000 }],
  );
  await db.exec(`UPDATE public.membership_plans SET price_cents=2000 WHERE id='${plan}'`);
  await actor(3, sql, args); // A confirmed replay keeps its original amount even if today's fee changed.
  await assert.rejects(
    actor(3, sql, [
      JSON.stringify({ ...data, id: uid(502) }),
      plan,
      "cash",
      uid(602),
      false,
      null,
      1000,
    ]),
    /cuota ha cambiado/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.members WHERE id=$1", [uid(502)])).rows[0]
      .n,
    0,
  );
  await assert.rejects(
    actor(4, sql, [
      JSON.stringify({ ...data, id: uid(503) }),
      plan,
      "cash",
      uid(603),
      false,
      null,
      2000,
    ]),
    /permiso de caja/,
  );
  await assert.rejects(actor(2, sql, args), /Cuota no disponible/);
  await db.exec(`UPDATE public.membership_plans SET price_cents=1000 WHERE id='${plan}'`);
});
test("annulment requires admin, reason and same club; direct status patches cannot bypass audit", async () => {
  const sql = "SELECT public.annul_financial_order($1,$2,$3)";
  for (const n of [2, 3, 4, 5])
    await assert.rejects(
      actor(n, sql, [member, order, "Synthetic correction"]),
      /Forbidden|no disponible/,
    );
  await assert.rejects(actor(1, sql, [member, order, "no"]), /motivo/);
  await assert.rejects(
    actor(
      3,
      "UPDATE public.orders SET status='cancelled',cancellation_reason='Direct forged change' WHERE id=$1",
      [uid(703)],
    ),
    /administrador/,
  );
  const before = (await db.query("SELECT stock FROM public.products WHERE id=$1", [uid(301)])).rows;
  await actor(1, sql, [member, order, "Duplicate administrative record"]);
  const first = (await db.query("SELECT * FROM public.orders WHERE id=$1", [order])).rows[0];
  assert.equal(first.status, "cancelled");
  assert.equal(first.cancelled_by, uid(1));
  assert.ok(first.cancelled_at);
  assert.equal(first.total_cents, 1000);
  assert.equal(first.notes, "Original record");
  await actor(1, sql, [member, order, "Duplicate administrative record"]);
  const second = (await db.query("SELECT * FROM public.orders WHERE id=$1", [order])).rows[0];
  assert.deepEqual(second, first);
  assert.deepEqual(
    (await db.query("SELECT stock FROM public.products WHERE id=$1", [uid(301)])).rows,
    before,
  );
  assert.equal((await db.query("SELECT count(*)::int n FROM public.stock_movements")).rows[0].n, 0);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.order_items WHERE order_id=$1", [order]))
      .rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT sum(total_cents)::int n FROM public.orders WHERE club_id=$1 AND status='completed'",
        [club],
      )
    ).rows[0].n,
    500,
  );
  await assert.rejects(
    actor(1, "UPDATE public.order_items SET line_total_cents=1 WHERE order_id=$1", [order]),
    /inmutable/,
  );
  await assert.rejects(
    actor(1, "DELETE FROM public.order_items WHERE order_id=$1", [order]),
    /inmutable/,
  );
  await assert.rejects(
    actor(
      1,
      "INSERT INTO public.order_items(order_id,club_id,product_name,unit_type,quantity,unit_price_cents,line_total_cents) VALUES($1,$2,'Forged line','unit',1,1,1)",
      [order, club],
    ),
    /inmutable/,
  );
  await assert.rejects(
    actor(1, "UPDATE public.orders SET status='completed' WHERE id=$1", [order]),
    /inmutable/,
  );
  await assert.rejects(
    actor(1, "DELETE FROM public.orders WHERE id=$1", [order]),
    /historial contable/,
  );
});
test("proposal rejects a repeated installation before changing data", async () => {
  const sql = await readFile(
    new URL("../docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql", import.meta.url),
    "utf8",
  );
  await assert.rejects(db.exec(sql), /already installed/);
  await db.exec("ROLLBACK");
});
test("member history obeys actual PostgreSQL RLS and keeps cancelled entries readable", async () => {
  const own = (
    await actor(1, "SELECT id,status FROM public.orders WHERE member_id=$1 ORDER BY id", [member])
  ).rows;
  assert.equal(own.length, 3);
  assert.ok(own.some((r) => r.status === "cancelled"));
  assert.equal(
    (await actor(2, "SELECT id FROM public.orders WHERE member_id=$1", [member])).rows.length,
    0,
  );
  assert.equal(
    (await actor(4, "SELECT id FROM public.orders WHERE member_id=$1", [member])).rows.length,
    0,
  );
});

test("direct authorized annulment stamps the actual actor/time, preserving the original employee", async () => {
  await actor(
    1,
    "UPDATE public.orders SET status='cancelled',cancellation_reason='Direct administrative correction',cancelled_by=$1,cancelled_at='2000-01-01' WHERE id=$2",
    [uid(2), uid(703)],
  );
  const row = (
    await db.query(
      "SELECT created_by,cancelled_by,cancelled_at,total_cents FROM public.orders WHERE id=$1",
      [uid(703)],
    )
  ).rows[0];
  assert.equal(row.created_by, uid(3));
  assert.equal(row.cancelled_by, uid(1));
  assert.notEqual(row.cancelled_at.toISOString().slice(0, 10), "2000-01-01");
  assert.equal(row.total_cents, 500);
});

test("a fee shown as free cannot silently become a paid registration", async () => {
  const free = uid(402),
    data = {
      id: uid(505),
      first_name: "Free",
      last_name: "Synthetic",
      birth_date: "1990-01-01",
      dni_number: "FREE-TEST",
    };
  await db.query(
    "INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents)VALUES($1,$2,'Free test',30,0)",
    [free, club],
  );
  await actor(4, "SELECT public.confirm_membership_with_receipt($1,$2,'cash',$3,false,NULL,0)", [
    JSON.stringify(data),
    free,
    uid(605),
  ]);
  assert.equal(
    (
      await db.query("SELECT count(*)::int n FROM public.membership_receipts WHERE member_id=$1", [
        data.id,
      ])
    ).rows[0].n,
    0,
  );
  await db.query("UPDATE public.membership_plans SET price_cents=1000 WHERE id=$1", [free]);
  await assert.rejects(
    actor(1, "SELECT public.confirm_membership_with_receipt($1,$2,'cash',$3,false,NULL,0)", [
      JSON.stringify({ ...data, id: uid(506) }),
      free,
      uid(606),
    ]),
    /cuota ha cambiado/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.members WHERE id=$1", [uid(506)])).rows[0]
      .n,
    0,
  );
});
