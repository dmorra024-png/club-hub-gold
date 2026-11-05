import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { madridMidnight, receiptPeriod } from "../src/lib/membership-receipts.ts";
let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const club = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function actor(n: number, sql: string) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
    return tx.query(sql);
  });
}
const receipt = (c = 1, m = 1, req = 1, amount = 1250) =>
  `SELECT (public.record_membership_receipt('${club(c)}','${member(m)}',${amount},'cash','Quota Demo','${request(req)}')).*`;
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/account-schema.sql", import.meta.url), "utf8"));
  await db.exec(`
CREATE TABLE public.clubs(id uuid PRIMARY KEY); INSERT INTO public.clubs VALUES ('${club(1)}'),('${club(2)}');
CREATE TABLE public.members(id uuid PRIMARY KEY,club_id uuid,member_number text,first_name text,last_name text);
INSERT INTO public.members VALUES ('${member(1)}','${club(1)}','0000001','Persona','Demo A'),('${member(2)}','${club(2)}','0000002','Persona','Demo B');
UPDATE public.user_roles SET permissions='{use_cash}' WHERE user_id='${uid(2)}';
`);
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/20261105170000_membership_receipts.sql", import.meta.url),
      "utf8",
    ),
  );
});
after(async () => {
  await db?.close();
});
test("Madrid receipt periods include the whole final day across DST", () => {
  assert.equal(madridMidnight("2026-03-29"), "2026-03-28T23:00:00.000Z");
  assert.equal(madridMidnight("2026-03-30"), "2026-03-29T22:00:00.000Z");
  assert.equal(madridMidnight("2026-10-25"), "2026-10-24T22:00:00.000Z");
  assert.deepEqual(receiptPeriod("2026-11-01", "2026-11-30"), {
    from: "2026-11-01",
    to: "2026-12-01",
  });
  assert.throws(() => receiptPeriod("2026-02-30", "2026-03-01"));
});
test("authorized employee records immutable receipt with server attribution and idempotency", async () => {
  const first = await actor(2, receipt());
  const again = await actor(2, receipt());
  assert.equal(first.rows.length, 1);
  assert.equal((first.rows[0] as any).id, (again.rows[0] as any).id);
  assert.equal((first.rows[0] as any).recorded_by, uid(2));
  assert.equal((first.rows[0] as any).member_name, "Persona Demo A");
  await assert.rejects(actor(2, receipt(1, 1, 1, 2000)), /distintos/);
});
test("cross-club members and foreign clubs are rejected even with known UUIDs", async () => {
  await assert.rejects(actor(2, receipt(1, 2, 2)), /Socio no disponible/);
  await assert.rejects(actor(2, receipt(2, 2, 2)), /permiso/);
  assert.equal((await actor(3, "SELECT * FROM public.membership_receipts")).rows.length, 0);
  await assert.rejects(
    actor(
      3,
      `SELECT public.membership_receipt_report('${club(1)}','2026-01-01','2027-01-01','day')`,
    ),
    /permiso/,
  );
});
test("read-only and unauthenticated users cannot record or forge audit fields", async () => {
  await assert.rejects(actor(4, receipt(2, 2, 3)), /permiso/);
  await assert.rejects(actor(6, receipt()), /permiso/);
  await assert.rejects(
    actor(2, "UPDATE public.membership_receipts SET amount_cents=1"),
    /permission denied/,
  );
  await assert.rejects(actor(1, "DELETE FROM public.membership_receipts"), /permission denied/);
  await assert.rejects(actor(2, "TRUNCATE public.membership_receipts"), /permission denied/);
  await assert.rejects(
    actor(2, `INSERT INTO public.membership_receipts(club_id) VALUES ('${club(1)}')`),
    /permission denied/,
  );
});
test("invalid money, methods, descriptions and idempotency keys fail", async () => {
  for (const amount of [0, -1])
    await assert.rejects(actor(2, receipt(1, 1, 5, amount)), /no válidos/);
  await assert.rejects(
    actor(
      2,
      `SELECT public.record_membership_receipt('${club(1)}','${member(1)}',10,'crypto','Quota','${request(9)}')`,
    ),
    /no válidos/,
  );
  await assert.rejects(
    actor(
      2,
      `SELECT public.record_membership_receipt('${club(1)}','${member(1)}',10,'cash','',NULL)`,
    ),
    /no válidos/,
  );
});
test("daily/monthly totals use Madrid dates, exclusive upper bound and sum the entire ledger", async () => {
  await db.exec(`INSERT INTO public.membership_receipts(club_id,member_id,member_number,member_name,recorded_by,operator_name,recorded_at,amount_cents,payment_method,description,request_id) VALUES
('${club(1)}','${member(1)}','1','Synthetic','${uid(2)}','Operator','2026-10-31T23:30:00Z',100,'card','Test','${request(100)}'),
('${club(1)}','${member(1)}','1','Synthetic','${uid(2)}','Operator','2026-11-30T23:30:00Z',200,'card','Test','${request(101)}');`);
  const result = await actor(
    1,
    `SELECT public.membership_receipt_report('${club(1)}','2026-11-01','2026-12-01','month') AS report`,
  );
  const report = (result.rows[0] as any).report;
  assert.ok(
    report.some(
      (r: any) => r.period === "2026-11" && r.payment_method === "card" && r.total_cents === 100,
    ),
  );
  await assert.rejects(
    actor(
      1,
      `SELECT public.membership_receipt_report('${club(1)}','2026-12-01','2026-11-01','day')`,
    ),
    /Periodo/,
  );
  // JSON aggregate is one API result; it cannot be silently capped at 1000 groups by PostgREST.
  await db.exec(
    `INSERT INTO public.membership_receipts(club_id,member_id,member_number,member_name,recorded_by,operator_name,recorded_at,amount_cents,payment_method,description,request_id) SELECT '${club(1)}','${member(1)}','1','Synthetic','${uid(2)}','Operator', '2020-01-01'::timestamptz + n*interval '1 day',1,'cash','Synthetic',gen_random_uuid() FROM generate_series(0,1004) n`,
  );
  const all = (
    await actor(
      1,
      `SELECT public.membership_receipt_report('${club(1)}','2020-01-01','2023-01-01','day') AS report`,
    )
  ).rows[0] as any;
  assert.equal(all.report.length, 1005);
  assert.equal(
    all.report.reduce((s: number, r: any) => s + r.total_cents, 0),
    1005,
  );
});
