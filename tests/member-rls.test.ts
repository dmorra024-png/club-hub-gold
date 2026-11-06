import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const club = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const plan = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function actor(n: number, sql: string) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [uid(n)]);
    return tx.query(sql);
  });
}
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/account-schema.sql", import.meta.url), "utf8"));
  await db.exec(`
    CREATE TABLE public.membership_plans (id uuid PRIMARY KEY, club_id uuid, name text);
    CREATE TABLE public.members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL, first_name text NOT NULL, last_name text NOT NULL, plan_id uuid REFERENCES public.membership_plans(id), expires_at date);
    GRANT ALL ON public.members TO authenticated, anon, service_role;
    ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
    CREATE POLICY members_all ON public.members FOR ALL TO authenticated USING (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id()) WITH CHECK (public.is_super_admin(auth.uid()) OR club_id = public.current_club_id());
    INSERT INTO public.membership_plans VALUES ('${plan(1)}', '${club(1)}', 'Quota Demo A'), ('${plan(2)}', '${club(2)}', 'Quota Demo B');
    UPDATE public.user_roles SET permissions = '{manage_members}' WHERE user_id = '${uid(2)}';
    INSERT INTO public.members(club_id, first_name, last_name, plan_id, expires_at) VALUES ('${club(1)}', 'Persona', 'Demo A', '${plan(1)}', '2026-11-05'), ('${club(2)}', 'Persona', 'Demo B', '${plan(2)}', '2026-11-05');
  `);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261105113000_member_administration_scope.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => {
  await db?.close();
});
test("administrative SQL migration preserves existing members and plans", async () => {
  assert.equal((await db.query("SELECT * FROM public.members")).rows.length, 2);
  assert.equal((await db.query("SELECT * FROM public.membership_plans")).rows.length, 2);
});
test("authorized staff can register and renew a synthetic member in their own club", async () => {
  const result = await actor(
    2,
    `INSERT INTO public.members(club_id,first_name,last_name,plan_id,expires_at) VALUES ('${club(1)}','Synthetic','Registration','${plan(1)}','2026-11-05') RETURNING id`,
  );
  const id = (result.rows[0] as { id: string }).id;
  const updated = await actor(
    2,
    `UPDATE public.members SET expires_at = '2026-12-05' WHERE id = '${id}' RETURNING expires_at`,
  );
  assert.equal(updated.rows.length, 1);
  assert.equal(
    (await actor(2, `DELETE FROM public.members WHERE id = '${id}' RETURNING id`)).rows.length,
    1,
  );
});
test("cross-club reading and mutation cannot expose or modify another club's member", async () => {
  assert.equal(
    (await actor(2, `SELECT id FROM public.members WHERE club_id = '${club(2)}'`)).rows.length,
    0,
  );
  assert.equal(
    (
      await actor(
        2,
        `UPDATE public.members SET last_name = 'Forbidden' WHERE club_id = '${club(2)}' RETURNING id`,
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    actor(
      2,
      `INSERT INTO public.members(club_id,first_name,last_name) VALUES ('${club(2)}','Forbidden','Insert')`,
    ),
    /row-level security/,
  );
});
test("staff without manage_members cannot create, renew or delete even in their own club", async () => {
  await assert.rejects(
    actor(
      4,
      `INSERT INTO public.members(club_id,first_name,last_name) VALUES ('${club(2)}','Forbidden','Insert')`,
    ),
    /row-level security/,
  );
  assert.equal(
    (await actor(4, "UPDATE public.members SET expires_at = '2027-01-01' RETURNING id")).rows
      .length,
    0,
  );
  assert.equal((await actor(4, "DELETE FROM public.members RETURNING id")).rows.length, 0);
  await assert.rejects(actor(1, "TRUNCATE public.members"), /permission denied/);
});
test("registration and renewal reject a valid plan ID from another club", async () => {
  await assert.rejects(
    actor(
      2,
      `INSERT INTO public.members(club_id,first_name,last_name,plan_id) VALUES ('${club(1)}','Foreign','Plan','${plan(2)}')`,
    ),
    /members_plan_same_club/,
  );
  await assert.rejects(
    actor(2, `UPDATE public.members SET plan_id = '${plan(2)}' WHERE club_id = '${club(1)}'`),
    /members_plan_same_club/,
  );
  // A missing optional plan remains valid; no fake UUID is inserted.
  assert.equal(
    (
      await actor(
        2,
        `INSERT INTO public.members(club_id,first_name,last_name,plan_id) VALUES ('${club(1)}','Optional','Plan',NULL) RETURNING id`,
      )
    ).rows.length,
    1,
  );
});
