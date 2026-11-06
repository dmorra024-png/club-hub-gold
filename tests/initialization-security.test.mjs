import { PGlite } from "@electric-sql/pglite";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
const root = new URL("../", import.meta.url),
  uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  club = (n) => uid(100 + n),
  mid = (n) => uid(200 + n),
  cat = (n) => uid(300 + n),
  product = (n) => uid(400 + n),
  plan = (n) => uid(500 + n),
  session = (n) => uid(600 + n),
  order = (n) => uid(700 + n);
let db;
let sql;
const results = [];
const check = (name, fn) =>
  test(name, async () => {
    await fn();
    results.push({ test: name, result: "PASS" });
  });
async function actor(n, sql, role = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    await tx.query(
      "SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
      [n ? uid(n) : "", role],
    );
    return tx.query(sql);
  });
}
async function denied(n, sql, role) {
  await assert.rejects(actor(n, sql, role), (e) =>
    ["42501", "23503", "23514"].includes(e.code),
  );
}
before(async () => {
  db = new PGlite();
  // Supabase JWT functions/storage/auth are local fixtures; no API or network.
  // gen_random_bytes is a fixture only, never emitted into production SQL.
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth;CREATE SCHEMA storage;CREATE SCHEMA extensions;
 GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
 CREATE FUNCTION public.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$ SELECT substring(decode(repeat(md5(gen_random_uuid()::text),(n+15)/16),'hex') FROM 1 FOR n) $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
 CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean);
 CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT ALL ON storage.objects TO authenticated,service_role;`);
  sql = await readFile(
    new URL("docs/sql/SNOOP_PILOT_INITIALIZE.sql", root),
    "utf8",
  );
  // PGlite cannot load server-only Supabase extensions. Exclude only installers;
  // keep all application DDL, policies, functions, grants and final assertions.
  const adapted = sql
    .replace(
      /CREATE EXTENSION IF NOT EXISTS (?:pg_net SCHEMA extensions|supabase_vault|pgmq);/g,
      "",
    )
    .replace(
      /DO \$\$ BEGIN\s*IF NOT EXISTS \(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\) THEN[\s\S]*?END \$\$;/,
      "",
    );
  await db.exec(adapted);
  for (let n = 1; n <= 7; n++)
    await db.exec(
      `INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('${uid(n)}','synthetic-${n}@example.test','{"role":"super_admin","permissions":["manage_collaborators"]}')`,
    );
  assert.equal(
    (await db.query("SELECT * FROM public.user_roles")).rows.length,
    0,
    "signup metadata never grants a role",
  );
  for (let n = 1; n <= 2; n++)
    await db.exec(`INSERT INTO public.clubs(id,name,slug) VALUES('${club(n)}','Synthetic ${n}','synthetic-${n}');
 INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents) VALUES('${plan(n)}','${club(n)}','Synthetic',30,100);
 INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at,plan_id) VALUES('${mid(n)}','${club(n)}','Synthetic','Person ${n}','2000-01-01','FAKE-${n}',current_date+30,'${plan(n)}');
 INSERT INTO public.product_categories(id,club_id,name,unit_type,is_smokeable) VALUES('${cat(n)}','${club(n)}','Synthetic','unit',false);
 INSERT INTO public.products(id,club_id,category_id,name,stock,buy_price,sell_price) VALUES('${product(n)}','${club(n)}','${cat(n)}','Synthetic',10,0,0);
 INSERT INTO public.cash_sessions(id,club_id,user_id) VALUES('${session(n)}','${club(n)}','${uid(n === 1 ? 2 : 4)}');
 INSERT INTO public.stock_movements(club_id,product_id,delta,created_by) VALUES('${club(n)}','${product(n)}',1,'${uid(n === 1 ? 2 : 4)}');
 INSERT INTO public.club_member_field_config(club_id,field_key) VALUES('${club(n)}','phone');
 INSERT INTO public.check_ins(club_id,member_id,direction) VALUES('${club(n)}','${mid(n)}','in');
 INSERT INTO public.orders(id,club_id,member_id,created_by) VALUES('${order(n)}','${club(n)}','${mid(n)}','${uid(n === 1 ? 2 : 4)}');
 INSERT INTO public.order_items(order_id,club_id,product_id,product_name,unit_type,quantity,unit_price_cents,line_total_cents) VALUES('${order(n)}','${club(n)}','${product(n)}','Synthetic','unit',1,0,0);
 INSERT INTO public.membership_receipts(club_id,member_id,member_number,member_name,recorded_by,operator_name,amount_cents,payment_method,description,request_id) VALUES('${club(n)}','${mid(n)}','SYNTHETIC','Synthetic','${uid(n === 1 ? 2 : 4)}','Synthetic',100,'cash','Synthetic',gen_random_uuid());`);
  for (const [n, c, role] of [
    [1, 1, "admin"],
    [2, 1, "collaborator"],
    [3, 2, "admin"],
    [4, 2, "collaborator"],
    [7, 1, "admin"],
    [7, 2, "collaborator"],
  ])
    await db.exec(
      `INSERT INTO public.user_roles(user_id,club_id,role,permissions) VALUES('${uid(n)}','${club(c)}','${role}',ARRAY['manage_members','manage_products','use_cash','view_reports']::public.app_permission[])`,
    );
  await db.exec(
    `INSERT INTO public.user_roles(user_id,role) VALUES('${uid(5)}','super_admin');INSERT INTO storage.objects(bucket_id,name) VALUES('snoop-docs','clubs/${club(1)}/members/${mid(1)}/synthetic.txt'),('snoop-docs','clubs/${club(2)}/members/${mid(2)}/synthetic.txt');`,
  );
});
after(async () => {
  await writeFile(
    new URL("docs/sql/SECURITY_TEST_RESULTS.json", root),
    JSON.stringify(
      {
        engine: "PGlite PostgreSQL 17, local only",
        limitations: [
          "Supabase auth/storage are local SQL fixtures",
          "pg_net,pg_cron,supabase_vault,pgmq installers excluded: native Docker daemon unavailable",
          "No remote database tested",
        ],
        tests: results,
      },
      null,
      2,
    ) + "\n",
  );
  await db?.close();
});
check(
  "full bundle: exact final policy allowlist, RLS and no unconditional policies",
  async () => {
    const expected = JSON.parse(
      await readFile(
        new URL("tests/fixtures/initialization-policy-allowlist.json", root),
        "utf8",
      ),
    );
    const rows = (
      await db.query(
        "SELECT * FROM pg_policies WHERE schemaname IN ('public','storage')",
      )
    ).rows;
    const sorted = (a) => a.map((p) => JSON.stringify(p)).sort();
    assert.deepEqual(sorted(rows), sorted(expected));
    assert.ok(
      !rows.some(
        (p) => /^\(*true\)*$/.test(p.qual) || /^\(*true\)*$/.test(p.with_check),
      ),
    );
    assert.ok(!/CREATE POLICY "auth (?:read|insert|update) members"/.test(sql));
    assert.equal(
      (
        await db.query(
          "SELECT * FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity",
        )
      ).rows.length,
      0,
    );
    for (const p of rows.filter((p) => p.policyname === "snoop_tenant_fence"))
      assert.equal(p.permissive, "RESTRICTIVE");
    await writeFile(
      new URL("docs/sql/FINAL_RLS_POLICIES.json", root),
      JSON.stringify(rows, null, 2) + "\n",
    );
  },
);
const tenantTables = [
  "members",
  "membership_plans",
  "products",
  "product_categories",
  "orders",
  "order_items",
  "cash_sessions",
  "stock_movements",
  "club_member_field_config",
  "membership_receipts",
  "check_ins",
];
for (const table of tenantTables)
  check(
    `${table}: both clubs isolated, unassigned and anonymous accounts denied`,
    async () => {
      for (const [u, c] of [
        [2, 1],
        [4, 2],
      ]) {
        assert.equal(
          (
            await actor(
              u,
              `SELECT * FROM public.${table} WHERE club_id='${club(c)}'`,
            )
          ).rows.length,
          1,
        );
        assert.equal(
          (
            await actor(
              u,
              `SELECT * FROM public.${table} WHERE club_id<>'${club(c)}'`,
            )
          ).rows.length,
          0,
        );
      }
      assert.equal(
        (await actor(6, `SELECT * FROM public.${table}`)).rows.length,
        0,
      );
      const other = await actor(5, `SELECT * FROM public.${table}`);
      assert.equal(other.rows.length, 2);
      try {
        assert.equal(
          (await actor(null, `SELECT * FROM public.${table}`, "anon")).rows
            .length,
          0,
        );
      } catch (e) {
        assert.equal(e.code, "42501");
      }
      await denied(2, `TRUNCATE public.${table}`);
    },
  );
check(
  "members: authorized own-club insert/update; foreign read/update/delete/insert/move denied",
  async () => {
    const created = await actor(
      2,
      `INSERT INTO public.members(club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${club(1)}','Synthetic','Added','2000-01-01','FAKE-NEW',current_date+30) RETURNING id`,
    );
    const id = created.rows[0].id;
    assert.ok(id);
    assert.equal(
      (
        await actor(
          2,
          `UPDATE public.members SET last_name='Synthetic updated' WHERE id='${id}' RETURNING id`,
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await actor(
          2,
          `UPDATE public.members SET last_name='Forbidden' WHERE club_id='${club(2)}' RETURNING id`,
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await actor(
          2,
          `DELETE FROM public.members WHERE club_id='${club(2)}' RETURNING id`,
        )
      ).rows.length,
      0,
    );
    await denied(
      2,
      `INSERT INTO public.members(club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${club(2)}','Synthetic','Forbidden','2000-01-01','FAKE-X',current_date+30)`,
    );
    await denied(
      2,
      `UPDATE public.members SET club_id='${club(2)}' WHERE id='${id}'`,
    );
    await actor(2, `DELETE FROM public.members WHERE id='${id}'`);
  },
);
check(
  "all mutable tenant tables: employee cannot update/delete foreign rows",
  async () => {
    for (const t of tenantTables) {
      for (const op of [
        `UPDATE public.${t} SET club_id=club_id WHERE club_id='${club(2)}' RETURNING club_id`,
        `DELETE FROM public.${t} WHERE club_id='${club(2)}' RETURNING club_id`,
      ]) {
        try {
          assert.equal((await actor(2, op)).rows.length, 0, t);
        } catch (e) {
          assert.equal(e.code, "42501", t);
        }
      }
    }
  },
);
check(
  "profiles and roles: no foreign directory, no self-promotion or permissions changes",
  async () => {
    assert.deepEqual(
      (await actor(2, "SELECT id FROM public.profiles ORDER BY id")).rows.map(
        (r) => r.id,
      ),
      [uid(1), uid(2), uid(7)],
    );
    assert.deepEqual(
      (await actor(2, "SELECT user_id FROM public.user_roles")).rows.map(
        (r) => r.user_id,
      ),
      [uid(2)],
    );
    for (const u of [1, 2, 3, 4, 5, 6, 7])
      for (const stmt of [
        `UPDATE public.user_roles SET role='super_admin' WHERE user_id='${uid(u)}'`,
        `UPDATE public.user_roles SET permissions=ARRAY['manage_collaborators']::public.app_permission[] WHERE user_id='${uid(u)}'`,
        `INSERT INTO public.user_roles(user_id,role) VALUES('${uid(u)}','super_admin')`,
        `DELETE FROM public.user_roles WHERE user_id='${uid(u)}'`,
      ])
        await denied(u, stmt);
    assert.equal(
      (
        await actor(
          2,
          `UPDATE public.profiles SET full_name='Forbidden' WHERE id='${uid(4)}' RETURNING id`,
        )
      ).rows.length,
      0,
    );
  },
);
check(
  "signup never gains admin from metadata, including when no super admin exists",
  async () => {
    await db.exec(
      `DELETE FROM public.user_roles WHERE role='super_admin';INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('${uid(8)}','synthetic-8@example.test','{"role":"super_admin"}');`,
    );
    assert.equal(
      (
        await db.query(
          `SELECT * FROM public.user_roles WHERE user_id='${uid(8)}'`,
        )
      ).rows.length,
      0,
    );
    await db.exec(
      `INSERT INTO public.user_roles(user_id,role) VALUES('${uid(5)}','super_admin');`,
    );
  },
);
check(
  "admin in club A and employee in B cannot administer B field config or stock",
  async () => {
    for (const t of ["club_member_field_config", "stock_movements"])
      assert.equal(
        (
          await actor(
            7,
            `UPDATE public.${t} SET club_id=club_id WHERE club_id='${club(2)}' RETURNING id`,
          )
        ).rows.length,
        0,
      );
    assert.equal(
      (
        await actor(
          3,
          `UPDATE public.club_member_field_config SET visible=false WHERE club_id='${club(2)}' RETURNING id`,
        )
      ).rows.length,
      1,
    );
  },
);
check(
  "cross-club references rejected for plans, categories, check-ins and stock",
  async () => {
    await denied(
      2,
      `UPDATE public.members SET plan_id='${plan(2)}' WHERE id='${mid(1)}'`,
    );
    await denied(
      2,
      `UPDATE public.products SET category_id='${cat(2)}' WHERE id='${product(1)}'`,
    );
    await denied(
      2,
      `INSERT INTO public.check_ins(club_id,member_id,direction) VALUES('${club(1)}','${mid(2)}','in')`,
    );
    await denied(
      2,
      `INSERT INTO public.stock_movements(club_id,product_id,delta,created_by) VALUES('${club(1)}','${product(2)}',1,'${uid(2)}')`,
    );
  },
);
check(
  "SECURITY DEFINER RPCs reject foreign club operations and reports",
  async () => {
    for (const stmt of [
      `SELECT public.record_membership_receipt('${club(2)}','${mid(2)}',100,'cash','Synthetic','${uid(900)}')`,
      `SELECT public.membership_receipt_report('${club(2)}',current_date,current_date+1,'day')`,
      `SELECT public.adjust_administrative_stock('${product(2)}',1,10,'Synthetic')`,
      `SELECT public.save_administrative_product('${product(2)}','{}')`,
      `SELECT public.create_order_with_items('${mid(2)}',NULL,'[]')`,
    ])
      await denied(2, stmt);
    await denied(
      null,
      `SELECT public.create_order_with_items('${mid(2)}',NULL,'[]')`,
      "anon",
    );
    const items = JSON.stringify([
      {
        product_id: product(2),
        quantity: 1,
        merma: 0,
        line_total_cents: 0,
        unit_price_cents: 0,
        unit_type: "unit",
        product_name: "Synthetic",
      },
    ]);
    await assert.rejects(
      actor(
        2,
        `SELECT public.create_order_with_items('${mid(1)}',NULL,'${items}')`,
      ),
      /Producto no encontrado/,
    );
  },
);
check(
  "private documents: foreign read/update/delete/upload and rename denied",
  async () => {
    assert.equal(
      (await actor(2, "SELECT * FROM storage.objects")).rows.length,
      1,
    );
    assert.equal(
      (
        await actor(
          2,
          `UPDATE storage.objects SET name='forbidden' WHERE name LIKE 'clubs/${club(2)}/%' RETURNING name`,
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await actor(
          2,
          `DELETE FROM storage.objects WHERE name LIKE 'clubs/${club(2)}/%' RETURNING name`,
        )
      ).rows.length,
      0,
    );
    await denied(
      2,
      `INSERT INTO storage.objects(bucket_id,name) VALUES('snoop-docs','clubs/${club(2)}/members/${mid(2)}/forbidden.txt')`,
    );
    await denied(
      2,
      `UPDATE storage.objects SET name='clubs/${club(2)}/members/${mid(2)}/forbidden.txt'`,
    );
  },
);
check(
  "email infrastructure and queue RPCs unavailable to browser and anonymous users",
  async () => {
    for (const t of [
      "email_send_log",
      "email_send_state",
      "email_unsubscribe_tokens",
      "suppressed_emails",
    ])
      for (const role of ["authenticated", "anon"])
        await denied(2, `SELECT * FROM public.${t}`, role);
    for (const stmt of [
      "SELECT public.enqueue_email('auth_emails','{}')",
      "SELECT * FROM public.read_email_batch('auth_emails',1,1)",
      "SELECT public.delete_email('auth_emails',1)",
      "SELECT public.move_to_dlq('auth_emails','auth_emails_dlq',1,'{}')",
    ])
      await denied(2, stmt);
  },
);
check(
  "restrictive fence survives an accidentally added permissive true policy",
  async () => {
    await db.exec(
      "CREATE POLICY regression_attack ON public.members FOR ALL TO authenticated USING(true) WITH CHECK(true)",
    );
    assert.equal(
      (
        await actor(
          2,
          `SELECT * FROM public.members WHERE club_id='${club(2)}'`,
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await actor(
          2,
          `UPDATE public.members SET last_name='Forbidden' WHERE club_id='${club(2)}' RETURNING id`,
        )
      ).rows.length,
      0,
    );
    await db.exec("DROP POLICY regression_attack ON public.members");
  },
);
check(
  "every tenant table rejects foreign-club INSERTs, not just reads",
  async () => {
    for (const t of tenantTables) {
      const row = (
        await db.query(
          `SELECT * FROM public.${t} WHERE club_id='${club(2)}' LIMIT 1`,
        )
      ).rows[0];
      row.id = uid(950);
      if (row.request_id) row.request_id = uid(951);
      const serialized = JSON.stringify(row).replaceAll("'", "''");
      await denied(
        2,
        `INSERT INTO public.${t} SELECT (json_populate_record(NULL::public.${t},'${serialized}')).*`,
      );
    }
  },
);
check(
  "staff without permission cannot mutate own-club members or catalogs",
  async () => {
    await db.exec(
      `UPDATE public.user_roles SET permissions='{}' WHERE user_id='${uid(4)}'`,
    );
    try {
      assert.equal(
        (
          await actor(
            4,
            `UPDATE public.members SET last_name='Forbidden' WHERE club_id='${club(2)}' RETURNING id`,
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await actor(
            4,
            `UPDATE public.products SET name='Forbidden' WHERE club_id='${club(2)}' RETURNING id`,
          )
        ).rows.length,
        0,
      );
      await denied(
        4,
        `INSERT INTO public.members(club_id,first_name,last_name,birth_date,dni_number,expires_at) VALUES('${club(2)}','Synthetic','Forbidden','2000-01-01','FAKE-NOPERM',current_date+30)`,
      );
      await denied(
        4,
        `SELECT public.record_membership_receipt('${club(2)}','${mid(2)}',100,'cash','Synthetic','${uid(952)}')`,
      );
    } finally {
      await db.exec(
        `UPDATE public.user_roles SET permissions=ARRAY['manage_members','manage_products','use_cash','view_reports']::public.app_permission[] WHERE user_id='${uid(4)}'`,
      );
    }
  },
);
check(
  "club records scoped; ordinary users cannot create clubs or gain club admin",
  async () => {
    assert.equal((await actor(2, "SELECT * FROM public.clubs")).rows.length, 1);
    assert.equal((await actor(6, "SELECT * FROM public.clubs")).rows.length, 0);
    await denied(
      2,
      "INSERT INTO public.clubs(name,slug) VALUES('Synthetic forbidden','synthetic-forbidden')",
    );
    assert.equal(
      (
        await actor(
          2,
          `UPDATE public.clubs SET name='Forbidden' WHERE id='${club(2)}' RETURNING id`,
        )
      ).rows.length,
      0,
    );
  },
);
check(
  "anonymous branding exposes only login fields, no internal counters",
  async () => {
    assert.equal(
      (
        await actor(
          null,
          "SELECT id,name,slug,logo_url,city FROM public.clubs WHERE active=true",
          "anon",
        )
      ).rows.length,
      2,
    );
    await denied(null, "SELECT next_member_number FROM public.clubs", "anon");
    await denied(
      2,
      "CREATE TABLE public.forbidden_privilege_grant(id integer)",
    );
  },
);
check(
  "initialization refuses a second execution before touching existing synthetic records",
  async () => {
    const before = (await db.query("SELECT * FROM public.members ORDER BY id"))
      .rows;
    try {
      await assert.rejects(db.exec(sql), /STOP SNOOP/);
    } finally {
      await db.exec("ROLLBACK");
    }
    assert.deepEqual(
      (await db.query("SELECT * FROM public.members ORDER BY id")).rows,
      before,
    );
  },
);
