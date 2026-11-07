import { accessRedirect, type AccountAccess } from "./access-context.ts";
const key = "snoop:resume-route";
export function safeResumePath(path: string) {
  return /^\/(?:productos|caja|control-acceso|soci(?:\/(?:nuovo|gestisci|importar|[a-f0-9-]{36}))?|ajustes(?:\/(?:colaboradores|socios|cuotas|informes|dispositivos))?)$/.test(
    path,
  );
}
export function rememberRoute(uid: string, clubId: string, path: string) {
  try {
    if (safeResumePath(path)) localStorage.setItem(key, JSON.stringify({ uid, clubId, path }));
  } catch {}
}
export function forgetRoute() {
  try {
    localStorage.removeItem(key);
  } catch {}
}
export function resumeRoute(uid: string, access: AccountAccess) {
  if (access.role === "super_admin") return "/snoop-admin";
  if (access.status !== "active") return "/club-status";
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (
      saved?.uid === uid &&
      saved.clubId === access.clubId &&
      safeResumePath(saved.path) &&
      !accessRedirect(access, saved.path)
    )
      return saved.path;
  } catch {}
  return "/";
}
