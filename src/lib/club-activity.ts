import type { AccountAccess } from "./access-context.ts";
export type ActivityKind = "member" | "cash" | "product" | "inventory";
export type ClubActivity = {
  key: string;
  kind: ActivityKind;
  at: string;
  title: string;
  detail: string;
  href: string;
};
export function activitySources(access: AccountAccess) {
  if (access.status !== "active" || !access.clubId || access.role === "super_admin") return [];
  const sources: string[] = [];
  if (access.permissions.includes("manage_members")) sources.push("members");
  if (access.permissions.some((p) => p === "use_cash" || p === "view_reports"))
    sources.push("orders", "membership_receipts");
  if (access.permissions.includes("manage_products")) sources.push("products", "stock_movements");
  return sources;
}
export function activityRows(
  table: string,
  rows: Record<string, any>[],
  canCash = true,
): ClubActivity[] {
  const money = (value: number) =>
    new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value / 100);
  return rows
    .filter(
      (r) =>
        typeof r.id === "string" &&
        Number.isFinite(Date.parse(r.recorded_at || r.updated_at || r.created_at)),
    )
    .map((r) => {
      const base = { key: `${table}:${r.id}`, at: r.recorded_at || r.updated_at || r.created_at };
      if (table === "members")
        return {
          ...base,
          kind: "member",
          title: "Nuevo socio registrado",
          detail: `Nº ${r.member_number || "—"}`,
          href: "/soci/gestisci",
        };
      if (table === "products")
        return {
          ...base,
          kind: "product",
          title: r.created_at === r.updated_at ? "Producto añadido" : "Producto actualizado",
          detail: String(r.name || "Ficha de producto"),
          href: "/productos",
        };
      if (table === "stock_movements")
        return {
          ...base,
          kind: "inventory",
          title: "Movimiento de inventario",
          detail: `Variación: ${Number(r.delta) > 0 ? "+" : ""}${Number(r.delta).toLocaleString("es-ES")}`,
          href: "/productos",
        };
      const cents = table === "orders" ? r.total_cents : r.amount_cents;
      return {
        ...base,
        kind: "cash",
        title: table === "orders" ? "Operación de caja" : "Cuota asociativa registrada",
        detail: Number.isSafeInteger(cents) ? `Importe: ${money(cents)}` : "Importe no disponible",
        href: canCash ? "/caja" : "/ajustes/informes",
      };
    });
}
export function relativeActivityTime(at: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  if (minutes < 1) return "Ahora";
  if (minutes < 60) return `Hace ${minutes} min`;
  if (minutes < 1440) return `Hace ${Math.floor(minutes / 60)} h`;
  return `Hace ${Math.floor(minutes / 1440)} d`;
}
