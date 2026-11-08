/** Read the existing administrative catalog with the user's RLS-bound client, never a service key. */
export async function loadAdministrativeCatalog(client: any, clubId: string) {
  if (!clubId) throw new Error("No se pudo verificar el club");
  async function all(table: "products" | "product_categories") {
    const result: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client
        .from(table)
        .select("*")
        .eq("club_id", clubId)
        .order("name")
        .order("id")
        .range(offset, offset + 999);
      if (error || !Array.isArray(data))
        throw new Error("No se pudo cargar el catálogo. Vuelve a intentarlo.");
      if (data.some((row: any) => row.club_id !== clubId))
        throw new Error("No se pudo verificar el catálogo del club");
      result.push(...data);
      if (data.length < 1000) return result;
    }
  }
  const [categories, products] = await Promise.all([all("product_categories"), all("products")]);
  return { categories, products };
}
