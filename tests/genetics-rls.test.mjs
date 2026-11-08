import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("isolated informational ledger: club isolation, reviewer identity, staff read-only, suspended/platform blocked", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE public.clubs(id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true);
 CREATE TABLE public.test_roles(user_id uuid,club_id uuid,admin boolean);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION public.can_operate_club(target uuid,permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.test_roles r JOIN public.clubs c ON c.id=r.club_id WHERE r.user_id=auth.uid() AND c.active AND c.id=target) $$;
 CREATE FUNCTION public.is_current_user_club_admin(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.test_roles WHERE user_id=auth.uid() AND club_id=target AND admin) $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated;
 INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003'),('00000000-0000-4000-8000-000000000004');
 INSERT INTO public.clubs(id) VALUES ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
 INSERT INTO public.test_roles VALUES ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true),('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true),('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',false);`);
    await db.exec(await readFile("docs/sql/SNOOP_INFORMATION_ARCHIVE_PROPOSED.sql", "utf8"));
    const set = async (n) => {
      await db.exec(
        `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000000${n}',false);`,
      );
    };
    const insert = (club, user) =>
      db.query(
        `INSERT INTO public.genetics_information(club_id,name,description,reviewed_by) VALUES ($1,'Synthetic botanical record','Only synthetic botanical information for isolated testing',$2)`,
        [club, user],
      );
    const a = "10000000-0000-4000-8000-000000000001",
      b = "10000000-0000-4000-8000-000000000002",
      user = "00000000-0000-4000-8000-000000000001";
    await set(1);
    await insert(a, user);
    assert.equal((await db.query("SELECT * FROM public.genetics_information")).rows.length, 1);
    await assert.rejects(insert(b, user), /row-level security/);
    await assert.rejects(insert(a, "00000000-0000-4000-8000-000000000002"), /row-level security/);
    await set(2);
    assert.equal((await db.query("SELECT * FROM public.genetics_information")).rows.length, 0);
    await set(3);
    assert.equal((await db.query("SELECT * FROM public.genetics_information")).rows.length, 1);
    await assert.rejects(insert(a, "00000000-0000-4000-8000-000000000003"), /row-level security/);
    await assert.rejects(
      db.query("UPDATE public.genetics_information SET description='changed'"),
      /permission denied/,
    );
    await set(4);
    assert.equal((await db.query("SELECT * FROM public.genetics_information")).rows.length, 0);
    await db.exec(`RESET ROLE; UPDATE public.clubs SET active=false WHERE id='${a}';`);
    await set(1);
    assert.equal((await db.query("SELECT * FROM public.genetics_information")).rows.length, 0);
  } finally {
    await db.close();
  }
});
