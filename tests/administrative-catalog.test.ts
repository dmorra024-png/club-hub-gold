import test from "node:test";
import assert from "node:assert/strict";
import { loadAdministrativeCatalog } from "../src/lib/administrative-catalog.ts";
function fixture(records: Record<string, any[]>, failure = "") {
  const reads: any[] = [];
  const client = {
    from(table: string) {
      let club = "",
        begin = 0,
        end = 0;
      const q = {
        select(value: string) {
          assert.equal(value, "*");
          return q;
        },
        eq(key: string, value: string) {
          assert.equal(key, "club_id");
          club = value;
          return q;
        },
        order: () => q,
        range(a: number, b: number) {
          begin = a;
          end = b;
          return q;
        },
        then(resolve: (v: any) => any) {
          reads.push({ table, club, begin, end });
          return Promise.resolve(
            resolve(
              table === failure
                ? { data: null, error: { message: "synthetic private error" } }
                : {
                    data: records[table].filter((r) => r.club_id === club).slice(begin, end + 1),
                    error: null,
                  },
            ),
          );
        },
      };
      return q;
    },
  };
  return { client, reads };
}
test("administrative catalog reads all pages, stays in club and preserves zero-stock and archived records", async () => {
  const products = Array.from({ length: 1001 }, (_, n) => ({
    id: String(n),
    club_id: "a",
    stock: 0,
    active: n !== 0,
  }));
  const { client, reads } = fixture({
    products: [...products, { id: "foreign", club_id: "b" }],
    product_categories: [{ id: "cat", club_id: "a", archived: true }],
  });
  const data = await loadAdministrativeCatalog(client, "a");
  assert.equal(data.products.length, 1001);
  assert.equal(data.products[0].stock, 0);
  assert.equal(data.products[0].active, false);
  assert.equal(data.categories[0].archived, true);
  assert.ok(reads.every((r) => r.club === "a"));
  assert.ok(reads.some((r) => r.table === "products" && r.begin === 1000));
});
test("query failure cannot masquerade as empty catalog or expose provider messages", async () => {
  for (const failed of ["products", "product_categories"]) {
    const { client } = fixture({ products: [], product_categories: [] }, failed);
    await assert.rejects(
      loadAdministrativeCatalog(client, "a"),
      /^Error: No se pudo cargar el catálogo\. Vuelve a intentarlo\.$/,
    );
  }
  const { client } = fixture({ products: [], product_categories: [] });
  assert.deepEqual(await loadAdministrativeCatalog(client, "a"), { categories: [], products: [] });
  await assert.rejects(loadAdministrativeCatalog(client, ""), /verificar el club/);
});
test("unexpected foreign-club response fails closed", async () => {
  const q: any = {
    select: () => q,
    eq: () => q,
    order: () => q,
    range: () => q,
    then: (resolve: any) => Promise.resolve(resolve({ data: [{ id: "x", club_id: "b" }] })),
  };
  await assert.rejects(
    loadAdministrativeCatalog({ from: () => q }, "a"),
    /verificar el catálogo del club/,
  );
});
