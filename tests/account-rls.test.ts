import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

let db: PGlite;
const originalRecords = new Map<string, unknown[]>();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clubA = "10000000-0000-4000-8000-000000000001";
const migration = new URL(
  "../supabase/migrations/20261105103000_secure_account_access.sql",
  import.meta.url,
);

async function asUser(userId: number | null, sql: string, role = "authenticated") {
  assert.ok(["authenticated", "anon", "service_role"].includes(role));
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      userId ? uid(userId) : "",
    ]);
    return tx.query(sql);
  });
}

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/account-schema.sql", import.meta.url), "utf8"));
  // Demonstrate the legacy attack before applying the exact migration under test.
  const oldDirectory = await asUser(2, "SELECT id FROM public.profiles");
  assert.equal(oldDirectory.rows.length, 6, "fixture reproduces the global profile leak");
  const escalation = await asUser(
    1,
    `UPDATE public.user_roles SET role = 'admin'
    WHERE user_id = '${uid(2)}' RETURNING id`,
  );
  assert.equal(
    escalation.rows.length,
    1,
    "legacy policy lets a club admin promote collaborators directly",
  );
  await db.exec(`UPDATE public.user_roles SET role = 'collaborator' WHERE user_id = '${uid(2)}'`);
  for (const table of ["auth.users", "public.profiles", "public.user_roles"]) {
    originalRecords.set(table, (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows);
  }
  await db.exec(await readFile(migration, "utf8"));
  await db.exec(`CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`);
});
after(async () => {
  await db?.close();
});

test("migration preserves every existing account, profile and membership", async () => {
  for (const [table, count] of [
    ["auth.users", 6],
    ["public.profiles", 6],
    ["public.user_roles", 5],
  ] as const) {
    assert.equal(
      (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
      count,
    );
    assert.deepEqual(
      (await db.query(`SELECT * FROM ${table} ORDER BY id`)).rows,
      originalRecords.get(table),
    );
  }
});

test("club members can read shared profiles but cannot enumerate another club", async () => {
  const result = await asUser(2, "SELECT id FROM public.profiles ORDER BY id");
  assert.deepEqual(result.rows, [{ id: uid(1) }, { id: uid(2) }]);
  const other = await asUser(4, "SELECT id FROM public.profiles ORDER BY id");
  assert.deepEqual(other.rows, [{ id: uid(3) }, { id: uid(4) }]);
  assert.deepEqual((await asUser(6, "SELECT id FROM public.profiles")).rows, [{ id: uid(6) }]);
});

test("admin reads only own club roles; collaborator only own role", async () => {
  assert.deepEqual(
    (await asUser(1, "SELECT user_id FROM public.user_roles ORDER BY user_id")).rows,
    [{ user_id: uid(1) }, { user_id: uid(2) }],
  );
  assert.deepEqual((await asUser(2, "SELECT user_id FROM public.user_roles")).rows, [
    { user_id: uid(2) },
  ]);
  assert.deepEqual((await asUser(6, "SELECT user_id FROM public.user_roles")).rows, []);
  assert.equal((await asUser(5, "SELECT id FROM public.user_roles")).rows.length, 5);
});

test("direct role insert/update/delete is denied even to authenticated admins and super admins", async () => {
  for (const user of [1, 2, 5, 6]) {
    for (const sql of [
      `INSERT INTO public.user_roles(user_id, role, club_id) VALUES ('${uid(6)}', 'admin', '${clubA}')`,
      `UPDATE public.user_roles SET role = 'admin' WHERE user_id = '${uid(2)}'`,
      `DELETE FROM public.user_roles WHERE user_id = '${uid(2)}'`,
    ])
      await assert.rejects(asUser(user, sql), /permission denied for table user_roles/);
  }
});

test("anonymous requests cannot read profiles or roles or invoke private helpers", async () => {
  for (const sql of [
    "SELECT * FROM public.profiles",
    "SELECT * FROM public.user_roles",
    `SELECT public.can_read_profile('${uid(1)}')`,
    `SELECT public.is_current_user_club_admin('${clubA}')`,
  ]) {
    await assert.rejects(asUser(null, sql, "anon"), /permission denied/);
  }
});

test("authenticated accounts cannot bypass RLS using TRUNCATE", async () => {
  for (const table of ["public.user_roles", "public.profiles"]) {
    await assert.rejects(asUser(1, `TRUNCATE ${table}`), /permission denied/);
  }
});

test("trusted server role can revoke only a selected membership without deleting identity or profile", async () => {
  await db
    .transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE service_role");
      const removed = await tx.query(`DELETE FROM public.user_roles WHERE user_id = '${uid(2)}'
      AND club_id = '${clubA}' AND role = 'collaborator' RETURNING id`);
      assert.equal(removed.rows.length, 1);
      assert.equal(
        (await tx.query(`SELECT id FROM public.profiles WHERE id = '${uid(2)}'`)).rows.length,
        1,
      );
      // Roll back this synthetic deletion so later tests exercise the same fixture.
      throw new Error("fixture rollback");
    })
    .catch((error) => {
      assert.equal(error.message, "fixture rollback");
    });
  assert.equal((await db.query(`SELECT id FROM auth.users WHERE id = '${uid(2)}'`)).rows.length, 1);
});

test("signup creates only a profile, never an automatic super admin", async () => {
  await db.exec(`INSERT INTO auth.users(id, email) VALUES ('${uid(7)}', 'signup@example.test')`);
  assert.equal(
    (await db.query(`SELECT id FROM public.profiles WHERE id = '${uid(7)}'`)).rows.length,
    1,
  );
  assert.equal(
    (await db.query(`SELECT id FROM public.user_roles WHERE user_id = '${uid(7)}'`)).rows.length,
    0,
  );
});

test("signup still cannot seize super-admin privileges when no super-admin exists", async () => {
  await db
    .transaction(async (tx) => {
      await tx.exec("DELETE FROM public.user_roles WHERE role = 'super_admin'");
      await tx.exec(
        `INSERT INTO auth.users(id, email) VALUES ('${uid(8)}', 'empty-platform@example.test')`,
      );
      assert.equal(
        (await tx.query("SELECT id FROM public.user_roles WHERE role = 'super_admin'")).rows.length,
        0,
      );
      throw new Error("fixture rollback");
    })
    .catch((error) => {
      assert.equal(error.message, "fixture rollback");
    });
});

test("security migration is repeatable without changing existing records", async () => {
  const before = await db.query("SELECT * FROM public.user_roles ORDER BY id");
  await db.exec(await readFile(migration, "utf8"));
  assert.deepEqual(
    (await db.query("SELECT * FROM public.user_roles ORDER BY id")).rows,
    before.rows,
  );
});
