import test from "node:test";
import assert from "node:assert/strict";
import {
  readOnlyCatalog,
  filterReadOnlyCatalog,
  catalogReadMessage,
  CatalogReadError,
} from "../src/lib/read-only-catalog.ts";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
import { readFile } from "node:fs/promises";
const categories = [
  { id: "c", club_id: "a", name: "Material de oficina", unit_type: "unit", archived: false },
  { id: "empty", club_id: "a", name: "Sin artículos", unit_type: "unit", archived: false },
  { id: "archived", club_id: "a", name: "Archivo", unit_type: "unit", archived: true },
];
const product = {
  id: "p",
  club_id: "a",
  category_id: "c",
  name: "Cuaderno sintético",
  stock: 0,
  sell_price: 0,
  active: true,
};
function clientFor({
  products = [product],
  cats = categories,
  errorTable = null,
  errorCode = "PGRST201",
  foreign = false,
} = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        const call = { table, columns: null, club: null, offset: 0, end: 999, order: [] };
        calls.push(call);
        const q = {
          select: (cols) => {
            call.columns = cols;
            assert.doesNotMatch(cols, /product_categories\(/);
            return q;
          },
          eq: (field, value) => {
            assert.equal(field, "club_id");
            call.club = value;
            return q;
          },
          order: (field) => {
            call.order.push(field);
            return q;
          },
          range: (a, b) => {
            call.offset = a;
            call.end = b;
            return q;
          },
          then(resolve) {
            if (table === errorTable)
              return Promise.resolve(
                resolve({
                  data: null,
                  error: { code: errorCode, message: "synthetic private SQL detail" },
                }),
              );
            const rows = table === "products" ? products : cats;
            return Promise.resolve(
              resolve({
                data: rows
                  .filter((r) => foreign || r.club_id === call.club)
                  .slice(call.offset, call.end + 1),
                error: null,
              }),
            );
          },
        };
        return q;
      },
    },
  };
}
test("separate scoped reads avoid ambiguous embedding and keep zero stock and empty categories visible", async () => {
  const { client, calls } = clientFor({
    products: [
      product,
      { ...product, id: "inactive", active: false },
      { ...product, id: "archived-product", category_id: "archived" },
      { ...product, id: "foreign", club_id: "b" },
    ],
  });
  const data = await readOnlyCatalog(client, "a");
  assert.equal(data.products.length, 1);
  assert.equal(data.products[0].stock, 0);
  assert.equal(data.products[0].unit_type, "unit");
  assert.deepEqual(
    data.categories.map((c) => c.id),
    ["c", "empty"],
  );
  assert.equal(data.hiddenRowCount, 2);
  assert.equal(data.visibleRowCount, 3);
  assert.ok(calls.every((c) => c.club === "a"));
  assert.ok(calls.every((c) => c.order.join(",") === "name,id"));
  assert.ok(calls.every((c) => !c.columns.includes("buy_price")));
});
test("read errors, forbidden access, empty visibility and filtered results stay distinct", async () => {
  for (const errorTable of ["products", "product_categories"]) {
    const { client } = clientFor({ errorTable });
    await assert.rejects(readOnlyCatalog(client, "a"), (e) => e.code === "PGRST201");
  }
  assert.match(catalogReadMessage(new CatalogReadError("42501")), /permiso/);
  assert.doesNotMatch(catalogReadMessage(new CatalogReadError("bad private detail")), /private/);
  const empty = await readOnlyCatalog(clientFor({ products: [] }).client, "a");
  assert.equal(empty.visibleRowCount, 0);
  assert.equal(empty.hiddenRowCount, 0);
  const inactive = await readOnlyCatalog(
    clientFor({ products: [{ ...product, active: false }] }).client,
    "a",
  );
  assert.equal(inactive.products.length, 0);
  assert.equal(inactive.hiddenRowCount, 1);
  const data = await readOnlyCatalog(clientFor().client, "a");
  assert.equal(filterReadOnlyCatalog(data.products, "empty", "").length, 0);
  assert.equal(filterReadOnlyCatalog(data.products, "all", "sintetico").length, 1);
  assert.equal(filterReadOnlyCatalog(data.products, "all", "oficina").length, 1);
});
test("every page remains club scoped; missing/foreign category or response fails closed", async () => {
  const products = Array.from({ length: 1001 }, (_, n) => ({ ...product, id: "p" + n }));
  const { client, calls } = clientFor({ products });
  assert.equal((await readOnlyCatalog(client, "a")).products.length, 1001);
  assert.ok(calls.some((c) => c.offset === 1000 && c.club === "a"));
  await assert.rejects(
    readOnlyCatalog(clientFor({ cats: [] }).client, "a"),
    (e) => e.code === "CATALOG_CATEGORY",
  );
  await assert.rejects(
    readOnlyCatalog(
      clientFor({ products: [{ ...product, club_id: "b" }], foreign: true }).client,
      "a",
    ),
    (e) => e.code === "CATALOG_SCOPE",
  );
  await assert.rejects(readOnlyCatalog(clientFor().client, ""), (e) => e.code === "CATALOG_SCOPE");
});
test("actual PostgreSQL schema has both relationships; unchanged RLS isolates catalog reads by club/permissions", async () => {
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
    const fks = (
      await db.query(
        "SELECT conname FROM pg_constraint WHERE conrelid='public.products'::regclass AND confrelid='public.product_categories'::regclass",
      )
    ).rows.map((r) => r.conname);
    assert.ok(fks.includes("products_category_id_fkey"));
    assert.ok(fks.includes("products_category_same_club"));
    for (let n = 1; n <= 3; n++)
      await db.exec(
        `INSERT INTO auth.users(id,email) VALUES('${uid(n)}','catalog-${n}@example.test')`,
      );
    await db.exec(`INSERT INTO public.clubs(id,name,slug) VALUES('${uid(101)}','Catalog A','catalog-a'),('${uid(102)}','Catalog B','catalog-b');
   INSERT INTO public.user_roles(user_id,club_id,role,permissions) VALUES('${uid(1)}','${uid(101)}','collaborator','{use_cash}'),('${uid(2)}','${uid(102)}','collaborator','{use_cash}'),('${uid(3)}','${uid(101)}','collaborator','{manage_members}');
   INSERT INTO public.product_categories(id,club_id,name) VALUES('${uid(201)}','${uid(101)}','Office A'),('${uid(202)}','${uid(102)}','Office B');
   INSERT INTO public.products(id,club_id,category_id,name) VALUES('${uid(301)}','${uid(101)}','${uid(201)}','Notebook A'),('${uid(302)}','${uid(102)}','${uid(202)}','Notebook B');
   SET ROLE authenticated;`);
    for (const [actor, expected] of [
      [1, uid(301)],
      [2, uid(302)],
      [3, null],
    ]) {
      await db.exec(`SELECT set_config('request.jwt.claim.sub','${uid(actor)}',false)`);
      const rows = (await db.query("SELECT id FROM public.products ORDER BY id")).rows;
      assert.deepEqual(
        rows.map((r) => r.id),
        expected ? [expected] : [],
      );
      const cats = (await db.query("SELECT id FROM public.product_categories ORDER BY id")).rows;
      assert.equal(cats.length, expected ? 1 : 0);
    }
  } finally {
    await db.close();
  }
});
