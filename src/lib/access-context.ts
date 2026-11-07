export type Permission =
  | "manage_members"
  | "manage_products"
  | "manage_collaborators"
  | "view_reports"
  | "use_cash";
export type AccessStatus = "active" | "platform" | "suspended" | "expired" | "unassigned";
export interface AccountAccess {
  role: "super_admin" | "admin" | "collaborator" | null;
  permissions: Permission[];
  clubId: string | null;
  clubName: string | null;
  clubLogo: string | null;
  status: AccessStatus;
}
export const EMPTY_ACCESS: AccountAccess = {
  role: null,
  permissions: [],
  clubId: null,
  clubName: null,
  clubLogo: null,
  status: "unassigned",
};
export function parseAccountAccess(input: unknown): AccountAccess {
  if (!input || typeof input !== "object") return { ...EMPTY_ACCESS };
  const row = input as Partial<AccountAccess>;
  if (row.role === "super_admin")
    return { ...EMPTY_ACCESS, role: "super_admin", status: "platform" };
  if (!["admin", "collaborator"].includes(row.role ?? "")) return { ...EMPTY_ACCESS };
  const status = ["active", "suspended", "expired"].includes(row.status ?? "")
    ? row.status!
    : "unassigned";
  const valid = [
    "manage_members",
    "manage_products",
    "manage_collaborators",
    "view_reports",
    "use_cash",
  ];
  return {
    role: row.role!,
    clubId: typeof row.clubId === "string" ? row.clubId : null,
    clubName: typeof row.clubName === "string" ? row.clubName : null,
    clubLogo: typeof row.clubLogo === "string" ? row.clubLogo : null,
    status,
    permissions:
      status === "active" && Array.isArray(row.permissions)
        ? row.permissions.filter((p) => valid.includes(p))
        : [],
  };
}
export function operationalPermission(path: string): Permission | null {
  if (path.startsWith("/soci") || path.startsWith("/control-acceso")) return "manage_members";
  if (path.startsWith("/productos")) return "manage_products";
  if (path.startsWith("/caja")) return "use_cash";
  if (path.startsWith("/ajustes/informes")) return "view_reports";
  return null;
}
export function accessRedirect(access: AccountAccess, path: string): string | null {
  if (path === "/perfil") return null;
  if (access.role === "super_admin") return path === "/snoop-admin" ? null : "/snoop-admin";
  if (access.status !== "active") return path === "/club-status" ? null : "/club-status";
  if (path === "/snoop-admin" || path === "/club-status") return "/";
  if (
    path.startsWith("/ajustes") &&
    !path.startsWith("/ajustes/informes") &&
    access.role !== "admin"
  )
    return "/";
  const permission = operationalPermission(path);
  if (permission && !access.permissions.includes(permission)) return "/";
  if (
    path === "/cuotas" &&
    !access.permissions.some((p) => p === "use_cash" || p === "view_reports")
  )
    return "/";
  return null;
}
