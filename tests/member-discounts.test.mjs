import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
import { parseDiscountPercentage, discountStatus } from "../src/lib/member-discounts.ts";
test("discount percentage exact decimals, bounds and Madrid validity", () => {
  for (const [text, expected] of [
    ["10", 1000],
    ["0,01", 1],
    ["12.50", 1250],
    ["100", 10000],
    ["100.01", null],
    ["0", null],
    ["-1", null],
    ["1e2", null],
    ["2.333", null],
  ])
    assert.equal(parseDiscountPercentage(text), expected);
  const d = { active: true, valid_from: "2026-11-10", valid_until: "2026-11-20" };
  assert.equal(discountStatus(d, "2026-11-09"), "Programado");
  assert.equal(discountStatus(d, "2026-11-10"), "Activo");
  assert.equal(discountStatus(d, "2026-11-20"), "Activo");
  assert.equal(discountStatus(d, "2026-11-21"), "Caducado");
  assert.equal(discountStatus({ ...d, active: false }, "2026-11-15"), "Inactivo");
});
test("proposed migration: real PostgreSQL RLS, two clubs, administration, immutable financial data", async () => {
  const db = await separationDatabase();
  try {
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261106150000_platform_club_separation.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (let n = 1; n <= 5; n++)
      await db.query("INSERT INTO auth.users(id,email)VALUES($1,$2)", [
        uid(n),
        `discount-${n}@example.test`,
      ]);
    await db.exec(`INSERT INTO clubs(id,name,slug)VALUES('${uid(101)}','Discount A','discount-a'),('${uid(102)}','Discount B','discount-b');
 INSERT INTO user_roles(user_id,role,club_id,permissions)VALUES('${uid(1)}','admin','${uid(101)}','{}'),('${uid(2)}','admin','${uid(102)}','{}'),('${uid(3)}','collaborator','${uid(101)}','{manage_members}'),('${uid(4)}','collaborator','${uid(101)}','{}'),('${uid(5)}','super_admin',NULL,'{}');
 INSERT INTO members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)VALUES('${uid(501)}','${uid(101)}','Synthetic','A','1990-01-01','DIS-A','2026-12-31'),('${uid(502)}','${uid(102)}','Synthetic','B','1990-01-01','DIS-B','2026-12-31');`);
    const before = (await db.query("SELECT * FROM membership_plans ORDER BY id")).rows;
    await db.exec(
      await readFile(
        new URL("../docs/sql/SNOOP_MEMBER_DISCOUNTS_PROPOSED.sql", import.meta.url),
        "utf8",
      ),
    );
    const actor = async (n, sql) =>
      db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
        return tx.query(sql);
      });
    const insert = (club, id = 601) =>
      `INSERT INTO member_discounts(id,club_id,name,percentage_basis_points)VALUES('${uid(id)}','${uid(club)}','Participación',1250)`;
    await actor(1, insert(101));
    await actor(1, insert(101) + " ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name RETURNING id");
    assert.equal((await actor(1, "SELECT * FROM member_discounts")).rows.length, 1);
    await actor(2, insert(102, 602));
    assert.equal((await actor(1, "SELECT * FROM member_discounts")).rows.length, 1);
    assert.equal((await actor(3, "SELECT * FROM member_discounts")).rows.length, 1);
    for (const n of [4, 5])
      assert.equal((await actor(n, "SELECT * FROM member_discounts")).rows.length, 0);
    await assert.rejects(actor(3, insert(101, 603)), /row-level security/);
    await assert.rejects(actor(1, insert(102, 603)), /row-level security/);
    await assert.rejects(actor(5, insert(101, 603)), /row-level security/);
    const assign = (member, discount = 601, club = 101) =>
      `INSERT INTO member_discount_assignments(member_id,club_id,discount_id)VALUES('${uid(member)}','${uid(club)}','${uid(discount)}')`;
    await actor(1, assign(501));
    assert.equal((await actor(2, "SELECT * FROM member_discount_assignments")).rows.length, 0);
    await assert.rejects(actor(1, assign(502)), /Member club mismatch/);
    assert.equal(
      (
        await actor(
          3,
          `UPDATE member_discount_assignments SET discount_id='${uid(602)}' RETURNING *`,
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      actor(1, `UPDATE member_discount_assignments SET discount_id='${uid(602)}'`),
      /foreign key/,
    );
    await assert.rejects(
      actor(1, `UPDATE member_discounts SET percentage_basis_points=10001`),
      /check constraint/,
    );
    await assert.rejects(
      actor(1, `UPDATE member_discounts SET valid_from='2026-12-31',valid_until='2026-01-01'`),
      /check constraint/,
    );
    await actor(
      1,
      "UPDATE member_discounts SET name='Editado',active=false,valid_from='2026-11-01',valid_until='2026-12-31'",
    );
    assert.equal((await actor(3, "SELECT * FROM member_discounts")).rows[0].active, false);
    await assert.rejects(actor(1, "DELETE FROM member_discounts"), /permission denied/);
    await actor(1, "DELETE FROM member_discount_assignments");
    assert.deepEqual((await db.query("SELECT * FROM membership_plans ORDER BY id")).rows, before);
    const policies = (
      await db.query(
        "SELECT tablename,policyname,qual,with_check FROM pg_policies WHERE tablename IN ('member_discounts','member_discount_assignments')",
      )
    ).rows;
    assert.equal(policies.length, 7);
    assert.ok(
      policies.every(
        (p) => !["true", "(true)"].includes(p.qual) && !["true", "(true)"].includes(p.with_check),
      ),
    );
  } finally {
    await db.close();
  }
});
