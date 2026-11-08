import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
import { cashShiftBreakdown } from "../src/lib/administrative-shifts.ts";
const migration = await readFile("docs/sql/SNOOP_CASH_SHIFTS_PROPOSED.sql", "utf8");
test("unified cash report preserves ledgers and policies, excludes cancellations and opening balances, isolates staff and clubs", async () => {
  const db = await separationDatabase();
  const club = uid(101),
    member = uid(201);
  try {
    await db.exec(
      await readFile("supabase/migrations/20261106150000_platform_club_separation.sql", "utf8"),
    );
    for (let n = 1; n <= 4; n++)
      await db.exec(
        `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${uid(n)}','synthetic-${n}@example.test',now());`,
      );
    await db.exec(`INSERT INTO public.clubs(id,name,slug) VALUES('${club}','Synthetic','synthetic'),('${uid(102)}','Other','other');
 INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${member}','${club}','Synthetic','Member','2000-01-01','FAKE-ONLY',current_date+30);
 INSERT INTO public.user_roles(user_id,role,club_id,permissions) VALUES('${uid(1)}','admin','${club}','{}'),('${uid(2)}','collaborator','${club}','{use_cash}'),('${uid(3)}','admin','${uid(102)}','{}'),('${uid(4)}','super_admin',NULL,'{}');
 INSERT INTO public.cash_sessions(club_id,user_id,opening_cash_cents) VALUES('${club}','${uid(2)}',999999);
 INSERT INTO public.orders(id,club_id,member_id,created_by,created_at,total_cents,status) VALUES
 ('${uid(301)}','${club}','${member}','${uid(2)}','2026-01-10T10:00:00Z',1000,'completed'),
 ('${uid(302)}','${club}','${member}','${uid(1)}','2026-01-10T16:00:00Z',2000,'completed'),
 ('${uid(303)}','${club}','${member}',NULL,'2026-01-10T22:00:00Z',300,'completed'),
 ('${uid(304)}','${club}','${member}','${uid(2)}','2026-01-10T11:00:00Z',99999,'cancelled');
 INSERT INTO public.membership_receipts(id,club_id,member_id,member_number,member_name,recorded_by,operator_name,recorded_at,amount_cents,payment_method,description,request_id) VALUES
 ('${uid(301)}','${club}','${member}','SYNTHETIC','Private name','${uid(2)}','Verified staff','2026-01-10T10:30:00Z',500,'cash','Synthetic',gen_random_uuid());`);
    // It is safe even when the earlier dues-only proposal is already present.
    await db.exec(await readFile("docs/sql/SNOOP_MEMBERSHIP_SHIFTS_PROPOSED.sql", "utf8"));
    await db.exec(
      `UPDATE public.profiles SET full_name=CASE WHEN id='${uid(1)}' THEN 'Admin sintético' ELSE 'Colaborador sintético' END`,
    );
    const tables = ["orders", "membership_receipts", "cash_sessions", "user_roles", "members"];
    const before = await Promise.all(
      tables.map(async (t) => (await db.query(`SELECT * FROM public.${t} ORDER BY id`)).rows),
    );
    const policies = (await db.query("SELECT * FROM pg_policies ORDER BY tablename,policyname"))
      .rows;
    await db.exec(migration);
    assert.deepEqual(
      await Promise.all(
        tables.map(async (t) => (await db.query(`SELECT * FROM public.${t} ORDER BY id`)).rows),
      ),
      before,
    );
    assert.deepEqual(
      (await db.query("SELECT * FROM pg_policies ORDER BY tablename,policyname")).rows,
      policies,
    );
    async function report(n, operator = null, day = "2026-01-10") {
      return db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
        return (
          await tx.query("SELECT public.snoop_cash_shift_report($2,$1) AS r", [operator, day])
        ).rows[0].r;
      });
    }
    const admin = await report(1);
    assert.equal(admin.rows.length, 4);
    const sums = cashShiftBreakdown(admin.rows, "2026-01-10");
    assert.deepEqual(sums.totals, { morning: 1500, afternoon: 2000, outside: 300, day: 3800 });
    assert.deepEqual(sums.sources, { orders: 3300, fees: 500 });
    assert.equal(sums.operators[uid(2)], 1500);
    assert.equal(sums.operators.unassigned, 300);
    assert.equal(
      new Set(admin.rows.map((r) => r.id)).size,
      4,
      "same UUID in two tables must remain distinct",
    );
    assert.equal(admin.rows.find((r) => r.source === "order").payment_method, null);
    assert.ok(admin.rows.every((r) => !("member_name" in r) && !("member_id" in r)));
    assert.equal(cashShiftBreakdown([...admin.rows, ...admin.rows], "2026-01-10").totals.day, 3800);
    for (const [index, time] of [
      "08:59:59",
      "09:00:00",
      "15:00:00",
      "21:00:00",
      "22:30:00",
    ].entries()) {
      await db.query(
        "INSERT INTO public.orders(id,club_id,member_id,created_by,created_at,total_cents,status) VALUES($1,$2,$3,$4,$5,100,'completed')",
        [uid(400 + index), club, member, uid(2), `2026-07-10T${time}Z`],
      );
    }
    assert.deepEqual(
      cashShiftBreakdown((await report(1, null, "2026-07-10")).rows, "2026-07-10").totals,
      { morning: 100, afternoon: 100, outside: 200, day: 400 },
    );
    assert.equal(
      cashShiftBreakdown((await report(1, null, "2026-07-11")).rows, "2026-07-11").totals.day,
      100,
    );
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE anon");
        await tx.query("SELECT public.snoop_cash_shift_report()");
      }),
      /permission denied/,
    );
    const own = await report(2);
    await mkdir(".sandbox/cash", { recursive: true });
    await db.exec(
      `UPDATE public.user_roles SET role='collaborator',permissions='{use_cash}' WHERE user_id='${uid(1)}'`,
    );
    const downgraded = await report(1);
    assert.equal(cashShiftBreakdown(downgraded.rows, "2026-01-10").totals.day, 2000);
    await db.exec(
      `UPDATE public.user_roles SET role='admin',permissions='{}' WHERE user_id='${uid(1)}'`,
    );
    await writeFile(
      ".sandbox/cash/reports.json",
      JSON.stringify({ admin, staff: own, downgraded }),
    );
    assert.equal(own.rows.length, 2);
    assert.ok(own.rows.every((r) => r.recorded_by === uid(2)));
    await assert.rejects(report(2, uid(1)), /Forbidden operator/);
    assert.equal((await report(3)).rows.length, 0);
    await assert.rejects(report(4), /Forbidden/);
    await db.exec(`UPDATE public.clubs SET active=false WHERE id='${club}'`);
    await assert.rejects(report(2), /Forbidden/);
    await assert.rejects(db.exec(migration), /already exists/);
    await db.exec("ROLLBACK");
  } finally {
    await db.close();
  }
});
test("dependency preflight rejects incompatible database atomically", async () => {
  const db = await separationDatabase();
  try {
    await db.exec("ALTER TABLE public.orders DROP COLUMN status");
    await assert.rejects(db.exec(migration), /Incompatible dependency/);
    await db.exec("ROLLBACK");
    assert.equal(
      (await db.query("SELECT to_regprocedure('public.snoop_cash_shift_report(date,uuid)') AS r"))
        .rows[0].r,
      null,
    );
  } finally {
    await db.close();
  }
});

test("source namespaces preserve equal IDs; duplicate conflicts fail; opening money cannot enter the movement calculator", async () => {
  const { uniqueLedgerRows } = await import("../src/lib/cash-summary.ts");
  const base = {
    id: "same-id",
    recorded_at: "2026-07-10T09:00:00Z",
    recorded_by: "employee",
    amount_cents: 100,
  };
  const order = { ...base, source: "order" },
    fee = { ...base, source: "fee", amount_cents: 200 };
  assert.deepEqual(cashShiftBreakdown([order, fee, order], "2026-07-10").totals, {
    morning: 300,
    afternoon: 0,
    outside: 0,
    day: 300,
  });
  assert.throws(
    () => cashShiftBreakdown([order, { ...order, amount_cents: 999 }], "2026-07-10"),
    /distintos/,
  );
  assert.deepEqual(uniqueLedgerRows([order, order]), [order]);
  assert.throws(
    () => uniqueLedgerRows([order, { ...order, recorded_by: "forged" }]),
    /incoherente/,
  );
});
