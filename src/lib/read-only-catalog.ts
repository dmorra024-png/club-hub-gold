/** Catalog reads only. Uses the existing authenticated client and its unchanged RLS. */
export type ReadOnlyCatalogProduct = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  stock: number;
  sell_price_eur: number;
  unit_type: "gr" | "unit";
};
export type ReadOnlyCatalog = {
  products: ReadOnlyCatalogProduct[];
  categories: { id: string; name: string }[];
  visibleRowCount: number;
  hiddenRowCount: number;
};
export class CatalogReadError extends Error {
  readonly code: string;
  constructor(code = "CATALOG_READ") {
    super("No se pudo cargar el catálogo");
    this.code = /^[A-Z0-9_]{1,30}$/.test(code) ? code : "CATALOG_READ";
  }
}
export async function readOnlyCatalog(client: any, clubId: string): Promise<ReadOnlyCatalog> {
  if (!clubId) throw new CatalogReadError("CATALOG_SCOPE");
  async function all(table: string, columns: string) {
    const result: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client
        .from(table)
        .select(columns)
        .eq("club_id", clubId)
        .order("name")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new CatalogReadError(error.code);
      if (!Array.isArray(data)) throw new CatalogReadError();
      if (data.some((row: any) => row.club_id !== clubId))
        throw new CatalogReadError("CATALOG_SCOPE");
      result.push(...data);
      if (data.length < 1000) return result;
    }
  }
  // There are two products -> product_categories foreign keys. Unqualified
  // PostgREST embedding is ambiguous (PGRST201); do not rely on schema inference.
  const [rows, categories] = await Promise.all([
    all("products", "id,club_id,category_id,name,stock,sell_price,active"),
    all("product_categories", "id,club_id,name,unit_type,archived"),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const products: ReadOnlyCatalogProduct[] = [];
  for (const row of rows) {
    const category = byId.get(row.category_id);
    if (!category) throw new CatalogReadError("CATALOG_CATEGORY");
    if (row.active === false || category.archived === true) continue;
    if (!["gr", "unit"].includes(category.unit_type))
      throw new CatalogReadError("CATALOG_CATEGORY");
    products.push({
      id: row.id,
      category_id: row.category_id,
      category_name: category.name,
      name: row.name,
      stock: Number(row.stock ?? 0),
      sell_price_eur: Number(row.sell_price ?? 0),
      unit_type: category.unit_type,
    });
  }
  return {
    products,
    categories: categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })),
    visibleRowCount: rows.length,
    hiddenRowCount: rows.length - products.length,
  };
}
export function catalogReadMessage(error: unknown) {
  if (error instanceof CatalogReadError && ["42501", "PGRST301", "PGRST302"].includes(error.code))
    return `No tienes permiso para consultar este catálogo (${error.code}).`;
  return `No se pudo cargar el catálogo${error instanceof CatalogReadError ? ` (${error.code})` : ""}. Vuelve a intentarlo.`;
}

export function filterReadOnlyCatalog(
  products: ReadOnlyCatalogProduct[],
  categoryId: string,
  search: string,
) {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es")
      .trim();
  const query = normalize(search);
  return products.filter(
    (p) =>
      (categoryId === "all" || p.category_id === categoryId) &&
      (!query || normalize(p.name).includes(query) || normalize(p.category_name).includes(query)),
  );
}
