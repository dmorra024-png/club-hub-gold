import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
export async function requireOperationalClub(
  context: { supabase: SupabaseClient<Database>; userId: string },
  permission?: Database["public"]["Enums"]["app_permission"],
) {
  const { data: superAdmin, error: roleError } = await context.supabase.rpc("is_super_admin", {
    _user_id: context.userId,
  });
  if (roleError) throw roleError;
  if (superAdmin) throw new Error("Forbidden: platform account cannot access club operations");
  const { data: clubId, error } = await context.supabase.rpc("current_club_id");
  if (error) throw error;
  if (!clubId) throw new Error("Forbidden: club suspended, expired or unassigned");
  const { data: allowed, error: accessError } = await context.supabase.rpc("can_operate_club", {
    target: clubId,
    ...(permission ? { permission } : {}),
  });
  if (accessError) throw accessError;
  if (!allowed) throw new Error("Forbidden: club permission required");
  return clubId;
}
