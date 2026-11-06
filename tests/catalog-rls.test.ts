import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const club = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cat = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
  await db.exec(`
CREATE TYPE public.strain_type AS ENUM ('indica','sativa','hibrida');
CREATE TABLE public.products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),club_id uuid,category_id uuid,name text,stock numeric(10,2),buy_price integer,sell_price integer,strain public.strain_type,notes text);
CREATE TABLE public.product_categories(id uuid PRIMARY KEY,club_id uuid,name text);
CREATE TABLE public.membership_plans(id uuid PRIMARY KEY,club_id uuid,name text);
CREATE TABLE public.stock_movements(id uuid DEFAULT gen_random_uuid(),club_id uuid,product_id uuid,delta numeric,reason text,notes text,created_by uuid);
GRANT ALL ON public.products,public.product_categories,public.membership_plans,public.stock_movements TO authenticated;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_all ON public.products FOR ALL TO authenticated USING(true);
CREATE POLICY categories_all ON public.product_categories FOR ALL TO authenticated USING(true);
CREATE POLICY plans_all ON public.membership_plans FOR ALL TO authenticated USING(true);
CREATE POLICY "Club members can insert stock movements" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK(true);
INSERT INTO public.product_categories VALUES('${cat(1)}','${club(1)}','Materiale Demo'),('${cat(2)}','${club(2)}','Other Demo');
UPDATE public.user_roles SET permissions='{manage_products}' WHERE user_id='${uid(2)}';
`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261105200000_administrative_catalog_scope.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});
after(async () => {
  await db?.close();
});
const payload = (category = cat(1), stock = 10) =>
  JSON.stringify({
    name: "Risorsa amministrativa sintetica",
    category_id: category,
    stock,
    buy_price: 0,
    sell_price: 0,
    strain: null,
  });
let product: string;
test("catalog manager creates resource and its administrative movement atomically", async () => {
  const out = await actor(
    2,
    `SELECT public.save_administrative_product(NULL,'${payload()}'::jsonb) AS id`,
  );
  product = (out.rows[0] as any).id;
  const row = (await db.query(`SELECT * FROM public.stock_movements WHERE product_id='${product}'`))
    .rows[0] as any;
  assert.equal(Number(row.delta), 10);
  assert.equal(row.created_by, uid(2));
});
test("stock adjustment rejects stale values and preserves actor/history", async () => {
  await actor(
    2,
    `SELECT public.adjust_administrative_stock('${product}',2,10,'Synthetic adjustment')`,
  );
  await assert.rejects(
    actor(2, `SELECT public.adjust_administrative_stock('${product}',2,10,'Stale')`),
    /otro operador/,
  );
  assert.equal(
    Number(
      ((await db.query(`SELECT stock FROM public.products WHERE id='${product}'`)).rows[0] as any)
        .stock,
    ),
    12,
  );
  await assert.rejects(
    actor(2, `SELECT public.adjust_administrative_stock('${product}',-13,12,'Negative')`),
    /no válido/,
  );
});
test("failed movement insert rolls back the resource change", async () => {
  await db.exec(
    "CREATE FUNCTION public.synthetic_movement_error() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END$$; CREATE TRIGGER synthetic_audit BEFORE INSERT ON public.stock_movements FOR EACH ROW EXECUTE FUNCTION public.synthetic_movement_error();",
  );
  try {
    await assert.rejects(
      actor(2, `SELECT public.adjust_administrative_stock('${product}',1,12,'Rollback')`),
      /Synthetic audit failure/,
    );
    assert.equal(
      Number(
        ((await db.query(`SELECT stock FROM public.products WHERE id='${product}'`)).rows[0] as any)
          .stock,
      ),
      12,
    );
  } finally {
    await db.exec("DROP TRIGGER synthetic_audit ON public.stock_movements");
  }
});
test("readonly staff cannot change catalogs, fees, or inventory; foreign category is rejected", async () => {
  await assert.rejects(
    actor(4, `SELECT public.save_administrative_product(NULL,'${payload(cat(2))}'::jsonb)`),
    /autorizado/,
  );
  await assert.rejects(
    actor(2, `SELECT public.save_administrative_product(NULL,'${payload(cat(2))}'::jsonb)`),
    /otro club/,
  );
  await assert.rejects(
    actor(
      4,
      `INSERT INTO public.membership_plans VALUES(gen_random_uuid(),'${club(2)}','Forbidden')`,
    ),
    /row-level security/,
  );
  await assert.rejects(actor(2, "TRUNCATE public.products"), /permission denied/);
  assert.equal((await actor(4, "SELECT * FROM public.products")).rows.length, 0);
});
