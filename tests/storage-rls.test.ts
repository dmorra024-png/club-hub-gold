import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const club = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const m = "20000000-0000-4000-8000-000000000001";
async function actor(n: number, sql: string) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
    return tx.query(sql);
  });
}
before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/account-schema.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE public.members(id uuid,club_id uuid,dni_photo_path text,signature_path text);INSERT INTO public.members VALUES('${m}','${club(1)}','historical.jpg',NULL);
CREATE FUNCTION public.can_manage_club_members(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT public.is_super_admin(auth.uid()) OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND club_id=c AND (role='admin' OR 'manage_members'=ANY(permissions)))$$;
UPDATE public.user_roles SET permissions='{manage_members}' WHERE user_id IN('${uid(2)}','${uid(4)}');
CREATE SCHEMA storage;GRANT USAGE ON SCHEMA storage TO authenticated;CREATE TABLE storage.objects(name text,bucket_id text);GRANT ALL ON storage.objects TO authenticated;ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read snoop-docs" ON storage.objects FOR SELECT TO authenticated USING(true);CREATE POLICY "auth insert snoop-docs" ON storage.objects FOR INSERT TO authenticated WITH CHECK(true);CREATE POLICY "auth update snoop-docs" ON storage.objects FOR UPDATE TO authenticated USING(true);CREATE POLICY "auth delete snoop-docs" ON storage.objects FOR DELETE TO authenticated USING(true);
INSERT INTO storage.objects VALUES('members/${m}/dni.jpg','snoop-docs'),('clubs/${club(2)}/members/new/dni.jpg','snoop-docs'),('historical.jpg','snoop-docs');
`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261105210000_private_member_documents.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => {
  await db?.close();
});
test("document migration preserves old objects and isolates both legacy and scoped paths", async () => {
  assert.equal((await db.query("SELECT * FROM storage.objects")).rows.length, 3);
  assert.equal((await actor(2, "SELECT * FROM storage.objects")).rows.length, 2);
  assert.equal((await actor(4, "SELECT * FROM storage.objects")).rows.length, 1);
  assert.equal((await actor(6, "SELECT * FROM storage.objects")).rows.length, 0);
});
test("pre-registration upload works only under authorized club prefix", async () => {
  await actor(
    2,
    `INSERT INTO storage.objects VALUES('clubs/${club(1)}/members/new/signature.png','snoop-docs')`,
  );
  await assert.rejects(
    actor(
      2,
      `INSERT INTO storage.objects VALUES('clubs/${club(2)}/members/new/forbidden.png','snoop-docs')`,
    ),
    /row-level security/,
  );
  await assert.rejects(
    actor(
      2,
      "INSERT INTO storage.objects VALUES('clubs/invalid/members/new/dni.jpg','snoop-docs')",
    ),
    /row-level security/,
  );
});
test("foreign staff cannot overwrite or remove another club document", async () => {
  assert.equal(
    (
      await actor(
        4,
        `UPDATE storage.objects SET name='stolen' WHERE name='members/${m}/dni.jpg' RETURNING name`,
      )
    ).rows.length,
    0,
  );
  assert.equal(
    (await actor(4, "DELETE FROM storage.objects WHERE name='historical.jpg' RETURNING name")).rows
      .length,
    0,
  );
});

test("inventing a cross-club reference cannot claim an ambiguous legacy filename", async () => {
  await db.exec(
    `INSERT INTO public.members VALUES(gen_random_uuid(),'${club(2)}','historical.jpg',NULL)`,
  );
  assert.equal(
    (await actor(4, "SELECT * FROM storage.objects WHERE name='historical.jpg'")).rows.length,
    0,
  );
  assert.equal(
    (await actor(5, "SELECT * FROM storage.objects WHERE name='historical.jpg'")).rows.length,
    1,
  );
});
