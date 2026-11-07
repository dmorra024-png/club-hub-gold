import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
let db;
const club = uid(101),
  other = uid(102),
  cat = uid(201),
  otherCat = uid(202),
  prod = uid(301),
  plan = uid(401),
  member = uid(501);
async function actor(n, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
    return tx.query(sql, params);
  });
}
before(async () => {
  db = await separationDatabase();
  for (const name of [
    "20261106150000_platform_club_separation.sql",
    "20261107120000_catalog_lifecycle.sql",
    "20261107123000_membership_payment_flow.sql",
  ])
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"),
    );
  for (let n = 1; n <= 4; n++)
    await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [
      uid(n),
      `synthetic-${n}@example.test`,
    ]);
  await db.exec(`INSERT INTO public.clubs(id,name,slug)VALUES('${club}','Synthetic A','synthetic-a'),('${other}','Synthetic B','synthetic-b');
 INSERT INTO public.user_roles(user_id,role,club_id,permissions)VALUES('${uid(1)}','admin','${club}','{}'),('${uid(2)}','admin','${other}','{}'),('${uid(3)}','collaborator','${club}','{manage_members}'),('${uid(4)}','super_admin',NULL,'{}');
 INSERT INTO public.product_categories(id,club_id,name,unit_type)VALUES('${cat}','${club}','Synthetic resources','unit'),('${otherCat}','${other}','Other resources','unit');
 INSERT INTO public.products(id,club_id,category_id,name,stock,buy_price,sell_price)VALUES('${prod}','${club}','${cat}','Synthetic Cup',10,0,0);
 INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents)VALUES('${plan}','${club}','Synthetic fee',30,1000);`);
});
after(async () => await db?.close());
test("categories can be renamed/archived/reactivated without losing linked products", async () => {
  await actor(1, "SELECT public.manage_administrative_category($1,$2,true)", [
    cat,
    "Renamed synthetic",
  ]);
  const row = (await db.query("SELECT * FROM public.product_categories WHERE id=$1", [cat]))
    .rows[0];
  assert.equal(row.archived, true);
  assert.equal(row.name, "Renamed synthetic");
  await assert.rejects(
    actor(1, "DELETE FROM public.product_categories WHERE id=$1", [cat]),
    /archívala/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM public.products WHERE id=$1", [prod])).rows[0]
      .n,
    1,
  );
  await actor(1, "SELECT public.manage_administrative_category($1,$2,false)", [
    cat,
    "Renamed synthetic",
  ]);
  const empty = uid(203);
  await db.query(
    "INSERT INTO public.product_categories(id,club_id,name,unit_type) VALUES($1,$2,$3,$4)",
    [empty, club, "Empty synthetic", "unit"],
  );
  assert.equal(
    (await actor(1, "DELETE FROM public.product_categories WHERE id=$1 RETURNING id", [empty])).rows
      .length,
    1,
  );
});
test("stock correction is atomic, detects conflicts and keeps immutable actor history", async () => {
  await actor(1, "SELECT public.adjust_administrative_stock($1,-2,10,$2)", [
    prod,
    "Synthetic count correction",
  ]);
  await assert.rejects(
    actor(1, "SELECT public.adjust_administrative_stock($1,1,10,$2)", [prod, "Stale"]),
    /otro operador/,
  );
  const history = (
    await db.query("SELECT * FROM public.stock_movements WHERE product_id=$1", [prod])
  ).rows;
  assert.equal(history.length, 1);
  assert.equal(Number(history[0].delta), -2);
  assert.equal(history[0].created_by, uid(1));
  await assert.rejects(
    actor(1, "UPDATE public.stock_movements SET delta=100"),
    /permission denied|inmutable/i,
  );
  await assert.rejects(
    actor(1, "UPDATE public.products SET stock=100 WHERE id=$1", [prod]),
    /rectificación/,
  );
  await assert.rejects(actor(1, "DELETE FROM public.products WHERE id=$1", [prod]), /archívalo/);
  await actor(1, "UPDATE public.products SET active=false WHERE id=$1", [prod]);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.stock_movements")).rows[0].n, 1);
});
test("catalog write isolation rejects other-club admins, unpermitted staff and platform owner", async () => {
  for (const n of [2, 3, 4]) {
    await assert.rejects(
      actor(n, "SELECT public.manage_administrative_category($1,$2,true)", [cat, "Attack"]),
      /no autorizado/,
    );
    await assert.rejects(
      actor(n, "SELECT public.adjust_administrative_stock($1,1,8,$2)", [prod, "Attack"]),
      /no autorizado/,
    );
    assert.equal(
      (await actor(n, "SELECT * FROM public.stock_movements WHERE product_id=$1", [prod])).rows
        .length,
      0,
    );
  }
});
const registration = {
  id: member,
  first_name: "Persona",
  last_name: "Sintetica",
  birth_date: "2000-01-01",
  dni_number: "FAKE-0001",
  city: "Synthetic",
  phone: "000000000",
  dni_photo_path: "",
  signature_path: "",
  contract_version: "",
};
const call = "SELECT public.save_membership_with_receipt($1::jsonb,$2,$3,$4,$5,$6)";
test("registration writes member + fee once and rejects changed replay", async () => {
  const args = [JSON.stringify(registration), plan, "cash", uid(601), false, null];
  await actor(1, call, args);
  await actor(1, call, args);
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.members WHERE id=$1", [member])).rows[0].n,
    1,
  );
  const rows = (
    await db.query("SELECT * FROM public.membership_receipts WHERE member_id=$1", [member])
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_cents, 1000);
  assert.equal(rows[0].recorded_by, uid(1));
  await assert.rejects(
    actor(1, call, [...args.slice(0, 2), "card", ...args.slice(3)]),
    /otros datos/,
  );
});
test("renewal records one fee, extends expiry once and cash report includes both receipts", async () => {
  const expiry = (
    await db.query("SELECT expires_at::text AS d FROM public.members WHERE id=$1", [member])
  ).rows[0].d;
  const args = [JSON.stringify({ id: member }), plan, "card", uid(602), true, expiry];
  await actor(1, call, args);
  await actor(1, call, args);
  const result = (
    await db.query("SELECT (expires_at-$2::date)::int AS days FROM public.members WHERE id=$1", [
      member,
      expiry,
    ])
  ).rows[0];
  assert.equal(result.days, 30);
  const report = (
    await actor(
      1,
      "SELECT public.membership_receipt_report($1,current_date-1,current_date+2,'day') AS r",
      [club],
    )
  ).rows[0].r;
  assert.equal(
    report.reduce((s, r) => s + r.total_cents, 0),
    2000,
  );
  assert.equal(report.length, 2);
  assert.equal((await db.query("SELECT count(*)::int n FROM public.orders")).rows[0].n, 0);
});
test("registration payment permissions, rollback and club isolation are enforced by database", async () => {
  for (const n of [2, 3, 4])
    await assert.rejects(
      actor(n, call, [
        JSON.stringify({
          ...registration,
          id: uid(510 + n),
          dni_number: "FAKE-" + n,
        }),
        plan,
        "cash",
        uid(610 + n),
        false,
        null,
      ]),
      /permiso|disponible/,
    );
  const before = (await db.query("SELECT count(*)::int n FROM public.members")).rows[0].n;
  await assert.rejects(
    actor(1, call, [
      JSON.stringify({ ...registration, id: uid(520) }),
      uid(999),
      "cash",
      uid(620),
      false,
      null,
    ]),
    /no disponible/,
  );
  assert.equal((await db.query("SELECT count(*)::int n FROM public.members")).rows[0].n, before);
  assert.equal((await actor(2, "SELECT * FROM public.membership_receipts")).rows.length, 0);
  await assert.rejects(
    actor(1, "SELECT * FROM public.membership_operations"),
    /permission denied/i,
  );
});
