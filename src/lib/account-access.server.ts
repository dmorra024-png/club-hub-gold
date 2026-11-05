import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";

type Client = SupabaseClient<Database>;
type AccessContext = { supabase: Client; userId: string };

export async function assertSuperAdmin(context: AccessContext) {
  const { data, error } = await context.supabase.rpc("is_super_admin", {
    _user_id: context.userId,
  });
  if (error) throw error;
  if (!data) throw new Error("Forbidden: super admin only");
}

export async function requireClubAdmin(context: AccessContext): Promise<string> {
  const { data: clubId, error } = await context.supabase.rpc("current_club_id");
  if (error) throw error;
  if (!clubId) throw new Error("No tienes un club asignado");
  const { data: isSuper, error: superError } = await context.supabase.rpc("is_super_admin", {
    _user_id: context.userId,
  });
  if (superError) throw superError;
  if (isSuper) return clubId;
  // A role in another club must never authorize this club's account operations.
  const { data: role, error: roleError } = await context.supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", context.userId)
    .eq("club_id", clubId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) throw new Error("Forbidden: club admin only");
  return clubId;
}

export function accountRedirectUrl(): string {
  // Never build password/invitation links from an untrusted Host header.
  const value = process.env.APP_URL;
  if (!value) throw new Error("Configura APP_URL para enviar invitaciones y recuperación");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("APP_URL debe ser un origen HTTPS (HTTP solo en localhost)");
  }
  return new URL("/reset-password", url).href;
}

export async function findUserByEmail(admin: Client, email: string) {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 1000; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  // Exhaustion is not evidence that an account does not exist.
  throw new Error("No se ha podido completar la búsqueda de la cuenta");
}

export async function resolveInvitedAccount(
  admin: Client,
  input: { email: string; full_name: string },
) {
  const email = input.email.trim().toLowerCase();
  const existing = await findUserByEmail(admin, email);
  if (existing) return { userId: existing.id, invited: false };
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: accountRedirectUrl(),
    data: { full_name: input.full_name },
  });
  if (error) throw error; // Includes races: never reset or overwrite an existing user.
  if (!data.user) throw new Error("No se ha podido invitar a la cuenta");
  return { userId: data.user.id, invited: true };
}

export async function addClubRole(
  admin: Client,
  input: Database["public"]["Tables"]["user_roles"]["Insert"],
) {
  // Insert only. An upsert on (user_id, role) could move an existing membership
  // from another club or silently overwrite its permissions.
  const { error } = await admin.from("user_roles").insert(input);
  if (error) {
    if (error.code === "23505") {
      throw new Error("La cuenta ya tiene este rol. No se ha modificado su acceso existente.");
    }
    throw error;
  }
}

export async function updateClubPermissions(
  admin: Client,
  clubId: string,
  roleId: string,
  permissions: Database["public"]["Enums"]["app_permission"][],
) {
  const { data, error } = await admin
    .from("user_roles")
    .update({ permissions })
    .eq("id", roleId)
    .eq("club_id", clubId)
    .eq("role", "collaborator")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Colaborador no encontrado");
}

export async function revokeClubCollaborator(admin: Client, clubId: string, roleId: string) {
  const { data, error } = await admin
    .from("user_roles")
    .delete()
    .eq("id", roleId)
    .eq("club_id", clubId)
    .eq("role", "collaborator")
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Colaborador no encontrado");
  // Auth identity, profile, other clubs and historical records remain intact.
}

export async function requestClubPasswordReset(admin: Client, clubId: string, roleId: string) {
  const { data: role, error } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("id", roleId)
    .eq("club_id", clubId)
    .eq("role", "collaborator")
    .maybeSingle();
  if (error) throw error;
  if (!role) throw new Error("Colaborador no encontrado");
  const { data, error: userError } = await admin.auth.admin.getUserById(role.user_id);
  if (userError) throw userError;
  if (!data.user?.email) throw new Error("La cuenta no tiene email");
  const { error: resetError } = await admin.auth.resetPasswordForEmail(data.user.email, {
    redirectTo: accountRedirectUrl(),
  });
  if (resetError) throw resetError;
}
