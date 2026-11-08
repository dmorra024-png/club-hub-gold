import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
async function database() {
  const d = new PGlite();
  await d.exec(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE service_role;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE TABLE public.clubs(id uuid PRIMARY KEY,name text,active boolean DEFAULT true);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,full_name text);
 CREATE TABLE public.user_roles(user_id uuid,club_id uuid,role text,permissions text[]);
 CREATE TABLE public.members(id uuid PRIMARY KEY,club_id uuid,email text,member_number text,created_at timestamptz DEFAULT now());
 CREATE TABLE public.membership_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,member_id uuid,member_number text,member_name text,recorded_by uuid,operator_name text,recorded_at timestamptz DEFAULT now(),amount_cents integer,payment_method text);
 CREATE FUNCTION public.current_club_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT club_id FROM public.user_roles WHERE user_id=auth.uid() LIMIT 1$$;
 CREATE FUNCTION public.can_operate_club(c uuid,p text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles r JOIN public.clubs cl ON cl.id=r.club_id WHERE r.user_id=auth.uid() AND r.club_id=c AND cl.active AND (r.role='admin' OR p=ANY(r.permissions))) AND NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='super_admin')$$;
 CREATE FUNCTION public.is_current_user_club_admin(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND club_id=c AND role='admin')$$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
 INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
 INSERT INTO public.clubs VALUES('10000000-0000-4000-8000-000000000001','Synthetic A',true),('10000000-0000-4000-8000-000000000002','Synthetic B',true);
 INSERT INTO public.profiles SELECT id,'Verified synthetic employee' FROM auth.users;
 INSERT INTO public.user_roles VALUES('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin','{}'),('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','admin','{}'),('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','collaborator','{use_cash,manage_members}');
 INSERT INTO public.members VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','synthetic@example.test','0001001',now());`);
  return d;
}
const uid = (n) => `00000000-0000-4000-8000-00000000000${n}`,
  club = "10000000-0000-4000-8000-000000000001",
  member = "20000000-0000-4000-8000-000000000001";
async function actor(db, n, role = "authenticated") {
  await db.exec(
    `RESET ROLE;SET ROLE ${role};SELECT set_config('request.jwt.claim.sub','${uid(n)}',false);`,
  );
}
test("proposed shift SQL snapshots server attribution, isolates staff/club, rejects forged filters and retroactive writes", async () => {
  const db = await database();
  try {
    await db.exec(await readFile("docs/sql/SNOOP_MEMBERSHIP_SHIFTS_PROPOSED.sql", "utf8"));
    for (const [employee, time, amount] of [
      [1, "10:00", 1000],
      [3, "11:00", 2500],
      [3, "16:00", 500],
      [3, "22:00", 250],
    ])
      await db.query(
        `INSERT INTO public.membership_receipts(club_id,recorded_by,operator_name,recorded_at,amount_cents,member_name) VALUES($1,$2,'Employee',$3,$4,'Synthetic member')`,
        [club, uid(employee), `2026-01-10T${time}:00Z`, amount],
      );
    await actor(db, 1);
    let r = (await db.query("SELECT public.snoop_membership_shift_report('2026-01-10',NULL) AS r"))
      .rows[0].r;
    assert.equal(r.rows.length, 4);
    assert.equal(
      r.rows.reduce((s, v) => s + v.amount_cents, 0),
      4250,
    );
    assert.equal(r.rows.filter((v) => v.shift === 1).length, 2);
    assert.equal(r.rows.filter((v) => v.shift === null).length, 1);
    await assert.rejects(
      db.exec("UPDATE public.snoop_membership_shifts SET shift=1"),
      /permission denied/,
    );
    await actor(db, 3);
    r = (await db.query("SELECT public.snoop_membership_shift_report('2026-01-10',NULL) AS r"))
      .rows[0].r;
    assert.equal(r.rows.length, 3);
    assert.ok(r.rows.every((v) => v.recorded_by === uid(3)));
    await assert.rejects(
      db.query("SELECT public.snoop_membership_shift_report('2026-01-10',$1)", [uid(1)]),
      /Forbidden/,
    );
    await actor(db, 2);
    r = (await db.query("SELECT public.snoop_membership_shift_report('2026-01-10',NULL) AS r"))
      .rows[0].r;
    assert.equal(r.rows.length, 0);
  } finally {
    await db.close();
  }
});
test("proposed outbox SQL deduplicates requests, leases jobs, safely retries and accepts delivery only on service-confirmed events", async () => {
  const db = await database();
  try {
    await db.exec(await readFile("docs/sql/SNOOP_MEMBER_MAIL_PROPOSED.sql", "utf8"));
    await db.exec(
      "INSERT INTO public.snoop_member_mail_legacy_review(member_id,club_id) VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001')",
    );
    await actor(db, 1);
    const request = async (retry) =>
      (await db.query("SELECT public.snoop_member_mail_request($1,$2) AS r", [member, retry]))
        .rows[0].r;
    const first = await request(false),
      again = await request(false);
    assert.equal(first.id, again.id);
    assert.equal(first.status, "pending");
    await actor(db, 2);
    await assert.rejects(request(false), /Socio/);
    await actor(db, 1);
    await assert.rejects(db.exec("SELECT * FROM public.snoop_member_mail"), /permission denied/);
    await actor(db, 1, "service_role");
    const job = (await db.query("SELECT * FROM public.snoop_claim_member_mail()")).rows[0];
    assert.equal(job.attempts, 1);
    assert.equal((await db.query("SELECT * FROM public.snoop_claim_member_mail()")).rows.length, 0);
    await db.query(
      "SELECT public.snoop_finish_member_mail($1,$2,'error',NULL,'provider_http_429')",
      [job.id, job.lease],
    );
    await actor(db, 1);
    const retry = await request(true);
    assert.equal(retry.id, first.id);
    assert.equal(retry.status, "pending");
    await actor(db, 1, "service_role");
    const job2 = (await db.query("SELECT * FROM public.snoop_claim_member_mail()")).rows[0];
    assert.equal(job2.idempotency_key, job.idempotency_key);
    assert.equal(job2.attempts, 2);
    await db.query("SELECT public.snoop_finish_member_mail($1,$2,'accepted','provider-1',NULL)", [
      job2.id,
      job2.lease,
    ]);
    await actor(db, 1);
    assert.equal((await request(true)).status, "accepted");
    await assert.rejects(
      db.query("SELECT public.snoop_confirm_member_mail('e','provider-1','email.delivered')"),
      /permission denied/,
    );
    await actor(db, 1, "service_role");
    await db.query("SELECT public.snoop_confirm_member_mail('e','provider-1','email.delivered')");
    assert.equal(
      (
        await db.query(
          "SELECT public.snoop_confirm_member_mail('e','provider-1','email.delivered') AS r",
        )
      ).rows[0].r,
      false,
    );
    await actor(db, 1);
    assert.equal((await request(true)).status, "delivered");
  } finally {
    await db.close();
  }
});

test("both proposals apply to the full existing schema, preserve records/policies, and keep platform and suspended users blocked", async () => {
  const { separationDatabase, uid: id } = await import("./helpers/separation-db.mjs");
  const db = await separationDatabase();
  try {
    for (const migration of [
      "20261106150000_platform_club_separation.sql",
      "20261107120000_catalog_lifecycle.sql",
      "20261107123000_membership_payment_flow.sql",
    ])
      await db.exec(await readFile("supabase/migrations/" + migration, "utf8"));
    await db.exec(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${id(1)}','synthetic@example.test',now()),('${id(2)}','platform@example.test',now());
  INSERT INTO public.clubs(id,name,slug) VALUES('${id(101)}','Synthetic','synthetic');
  INSERT INTO public.user_roles(user_id,role,club_id) VALUES('${id(1)}','admin','${id(101)}'),('${id(2)}','super_admin',NULL);
  INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at,email,member_number) VALUES('${id(201)}','${id(101)}','Synthetic','Person','2000-01-01','TEST-ONLY',current_date+30,'synthetic@example.test','0001001');`);
    const before = (await db.query("SELECT * FROM public.members")).rows;
    const policies = (
      await db.query(
        "SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
      )
    ).rows;
    for (const proposal of [
      "SNOOP_MEMBERSHIP_SHIFTS_PROPOSED.sql",
      "SNOOP_MEMBER_MAIL_PROPOSED.sql",
    ])
      await db.exec(await readFile("docs/sql/" + proposal, "utf8"));
    assert.deepEqual((await db.query("SELECT * FROM public.members")).rows, before);
    assert.deepEqual(
      (
        await db.query(
          "SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname",
        )
      ).rows,
      policies,
    );
    await actor(db, 1);
    await assert.rejects(
      db.query("SELECT public.snoop_member_mail_request($1,false)", [id(201)]),
      /Reconciliar/,
    );
    const r = (await db.query("SELECT public.snoop_membership_shift_report() AS r")).rows[0].r;
    assert.deepEqual(r.rows, []);
    await actor(db, 2);
    await assert.rejects(db.query("SELECT public.snoop_membership_shift_report()"), /Forbidden/);
    await assert.rejects(
      db.query("SELECT public.snoop_member_mail_request($1,false)", [id(201)]),
      /Forbidden/,
    );
    await db.exec(`RESET ROLE;UPDATE public.clubs SET active=false WHERE id='${id(101)}';`);
    await actor(db, 1);
    await assert.rejects(db.query("SELECT public.snoop_membership_shift_report()"), /Forbidden/);
  } finally {
    await db.close();
  }
});

test("cash-only staff cannot retrieve member identity; rejected mail retries expire and early delivery/bounce events are reconciled", async () => {
  const db = await database();
  try {
    for (const proposal of [
      "SNOOP_MEMBERSHIP_SHIFTS_PROPOSED.sql",
      "SNOOP_MEMBER_MAIL_PROPOSED.sql",
    ])
      await db.exec(await readFile("docs/sql/" + proposal, "utf8"));
    await db.exec(
      `UPDATE public.user_roles SET permissions='{use_cash}' WHERE user_id='${uid(3)}';INSERT INTO public.membership_receipts(club_id,recorded_by,operator_name,recorded_at,amount_cents,member_name,member_number) VALUES('${club}','${uid(3)}','Employee','2026-01-10T11:00:00Z',100,'PRIVATE SYNTHETIC NAME','PRIVATE-ID');`,
    );
    await actor(db, 3);
    const report = (
      await db.query("SELECT public.snoop_membership_shift_report('2026-01-10',NULL) AS r")
    ).rows[0].r;
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].member_name, null);
    assert.equal(report.rows[0].member_number, null);
    await assert.rejects(
      db.query("SELECT public.snoop_member_mail_request($1,false)", [member]),
      /Forbidden/,
    );
    await db.exec(
      `RESET ROLE;INSERT INTO public.snoop_member_mail_legacy_review(member_id,club_id) VALUES('${member}','${club}');`,
    );
    for (const [n, event, expected] of [
      [1, "email.delivered", "delivered"],
      [2, "email.bounced", "error"],
    ]) {
      await actor(db, 1);
      if (n === 2)
        await db.exec(
          `RESET ROLE;UPDATE public.members SET email='changed@example.test' WHERE id='${member}';`,
        );
      await actor(db, 1);
      await db.query("SELECT public.snoop_member_mail_request($1,false)", [member]);
      await actor(db, 1, "service_role");
      const job = (await db.query("SELECT * FROM public.snoop_claim_member_mail()")).rows[0];
      await db.query("SELECT public.snoop_confirm_member_mail($1,$2,$3)", [
        "event-" + n,
        "provider-" + n,
        event,
      ]);
      await db.query("SELECT public.snoop_finish_member_mail($1,$2,'accepted',$3,NULL)", [
        job.id,
        job.lease,
        "provider-" + n,
      ]);
      await actor(db, 1);
      assert.equal(
        (await db.query("SELECT public.snoop_member_mail_status($1) AS r", [member])).rows[0].r
          .status,
        expected,
      );
    }
    await db.exec(
      `RESET ROLE;UPDATE public.snoop_member_mail SET status='pending',provider_id=NULL,created_at=now()-interval '24 hours';`,
    );
    await actor(db, 1, "service_role");
    assert.equal((await db.query("SELECT * FROM public.snoop_claim_member_mail()")).rows.length, 0);
    await actor(db, 1);
    const expired = (
      await db.query("SELECT public.snoop_member_mail_request($1,true) AS r", [member])
    ).rows[0].r;
    assert.notEqual(expired.status, "pending");
  } finally {
    await db.close();
  }
});
