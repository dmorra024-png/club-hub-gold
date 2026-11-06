import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, before, after } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  preparePilotOwnerBootstrap,
  PILOT_PROJECT_REF,
} from "../scripts/lib/pilot-owner-bootstrap.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const options = {
  projectRef: PILOT_PROJECT_REF,
  ownerId: id(1),
  ownerEmail: "owner@example.test",
  clubId: id(100),
};
let db;
async function actor(n, query) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id(n)]);
    return tx.query(query);
  });
}
before(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA extensions;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
 CREATE FUNCTION public.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$SELECT substring(decode(repeat(md5(gen_random_uuid()::text),(n+15)/16),'hex') FROM 1 FOR n)$$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',email_confirmed_at timestamptz,banned_until timestamptz,is_anonymous boolean DEFAULT false);
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT ALL ON storage.objects TO authenticated,service_role;`);
  // Same full application bundle as production; only native extension installers
  // are excluded in PGlite. Auth/storage are synthetic local SQL fixtures.
  let sql = await readFile(
    new URL("../docs/sql/SNOOP_PILOT_INITIALIZE.sql", import.meta.url),
    "utf8",
  );
  sql = sql
    .replace(
      /CREATE EXTENSION IF NOT EXISTS (?:pg_net SCHEMA extensions|supabase_vault|pgmq);/g,
      "",
    )
    .replace(
      /DO \$\$ BEGIN\s*IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\) THEN[\s\S]*?END \$\$;/,
      "",
    );
  await db.exec(sql);
  await db.exec(
    `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${id(1)}','owner@example.test',now()),('${id(2)}','staff@example.test',now()),('${id(3)}','unconfirmed@example.test',NULL);`,
  );
});
after(async () => await db?.close());
test("bootstrap refuses any other project and invalid explicit identity", () => {
  assert.throws(
    () => preparePilotOwnerBootstrap({ ...options, projectRef: "other-project" }),
    /dedicated/,
  );
  assert.throws(() => preparePilotOwnerBootstrap({ ...options, ownerId: "" }), /UUID/);
});
test("ordinary signup has no role; unconfirmed identity cannot bootstrap", async () => {
  assert.equal((await actor(1, "SELECT * FROM public.user_roles")).rows.length, 0);
  await assert.rejects(
    db.exec(
      preparePilotOwnerBootstrap({
        ...options,
        ownerId: id(3),
        ownerEmail: "unconfirmed@example.test",
      }),
    ),
    /IDENTITY_NOT_CONFIRMED/,
  );
  await db.exec("ROLLBACK");
  assert.equal((await db.query("SELECT * FROM public.clubs")).rows.length, 0);
});
test("an authenticated browser cannot run the owner bootstrap", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.exec(preparePilotOwnerBootstrap(options));
    }),
    /permission denied/,
  );
  await db.exec("ROLLBACK");
  assert.equal((await db.query("SELECT * FROM public.user_roles")).rows.length, 0);
});
test("trusted bootstrap adds only two selected roles and one club, preserving accounts", async () => {
  const before = (await db.query("SELECT * FROM auth.users ORDER BY id")).rows;
  const profiles = (await db.query("SELECT * FROM public.profiles ORDER BY id")).rows;
  await db.exec(preparePilotOwnerBootstrap(options));
  assert.deepEqual((await db.query("SELECT * FROM auth.users ORDER BY id")).rows, before);
  assert.deepEqual((await db.query("SELECT * FROM public.profiles ORDER BY id")).rows, profiles);
  assert.equal((await db.query("SELECT * FROM public.clubs")).rows.length, 1);
  assert.deepEqual(
    (await actor(1, "SELECT role FROM public.user_roles ORDER BY role")).rows
      .map((x) => x.role)
      .sort(),
    ["admin", "super_admin"],
  );
  assert.equal((await actor(1, "SELECT public.current_club_id() AS id")).rows[0].id, id(100));
  assert.equal(
    (await actor(1, `SELECT public.is_super_admin('${id(1)}') AS allowed`)).rows[0].allowed,
    true,
  );
  assert.equal((await actor(2, "SELECT * FROM public.user_roles")).rows.length, 0);
});
test("a second bootstrap refuses and leaves all privileges unchanged", async () => {
  const before = (await db.query("SELECT * FROM public.user_roles ORDER BY id")).rows;
  await assert.rejects(
    db.exec(
      preparePilotOwnerBootstrap({
        ...options,
        ownerId: id(2),
        ownerEmail: "staff@example.test",
        clubId: id(101),
      }),
    ),
    /STATE_CHANGED/,
  );
  await db.exec("ROLLBACK");
  assert.deepEqual((await db.query("SELECT * FROM public.user_roles ORDER BY id")).rows, before);
});
test("bootstrapped owner registers, searches and updates a synthetic member", async () => {
  await actor(
    1,
    `INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents) VALUES('${id(200)}','${id(100)}','Synthetic membership',30,100)`,
  );
  const created = await actor(
    1,
    `INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at,plan_id) VALUES('${id(300)}','${id(100)}','Synthetic','Pilot Member','2000-01-01','SYNTHETIC-ONLY',current_date+30,'${id(200)}') RETURNING member_number`,
  );
  assert.ok(created.rows[0].member_number);
  assert.equal(
    (await actor(1, "SELECT id FROM public.members WHERE last_name ILIKE '%pilot%'")).rows.length,
    1,
  );
  assert.equal(
    (
      await actor(
        1,
        `UPDATE public.members SET city='Synthetic city' WHERE id='${id(300)}' RETURNING id`,
      )
    ).rows.length,
    1,
  );
});
test("bootstrapped owner records membership receipt and obtains administrative report", async () => {
  const r = await actor(
    1,
    `SELECT (public.record_membership_receipt('${id(100)}','${id(300)}',100,'cash','Synthetic membership','${id(400)}')).amount_cents AS amount`,
  );
  assert.equal(r.rows[0].amount, 100);
  const report = await actor(
    1,
    `SELECT public.membership_receipt_report('${id(100)}',current_date,current_date+1,'day') AS report`,
  );
  assert.equal(report.rows[0].report[0].total_cents, 100);
});
test("staff permissions remain enforced after bootstrap; staff cannot self-promote", async () => {
  // Synthetic fixture setup by trusted test connection, not an application grant.
  await db.exec(
    `INSERT INTO public.user_roles(user_id,role,club_id,permissions) VALUES('${id(2)}','collaborator','${id(100)}','{}')`,
  );
  assert.equal(
    (
      await actor(
        2,
        `UPDATE public.members SET city='Forbidden' WHERE id='${id(300)}' RETURNING id`,
      )
    ).rows.length,
    0,
  );
  await assert.rejects(actor(2, "UPDATE public.user_roles SET role='admin'"), /permission denied/);
  await db.exec(
    `UPDATE public.user_roles SET permissions=ARRAY['manage_members']::public.app_permission[] WHERE user_id='${id(2)}'`,
  );
  assert.equal(
    (
      await actor(
        2,
        `UPDATE public.members SET city='Synthetic authorized' WHERE id='${id(300)}' RETURNING id`,
      )
    ).rows.length,
    1,
  );
  await assert.rejects(
    actor(
      2,
      `SELECT public.record_membership_receipt('${id(100)}','${id(300)}',100,'cash','Forbidden','${id(401)}')`,
    ),
    /permiso/,
  );
});
