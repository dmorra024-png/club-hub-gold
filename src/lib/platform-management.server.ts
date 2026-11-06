import { assertSuperAdmin } from "./account-access.server.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
type Client = SupabaseClient<Database>;
// This allowlist deliberately excludes counters, member/finance data and profiles.
export const PLATFORM_CLUB_FIELDS =
  "id,name,slug,city,logo_url,active,subscription_expires_at,created_at" as const;
export async function updatePlatformClub(
  context: { supabase: Client; userId: string },
  admin: Client,
  id: string,
  values: {
    name: string;
    city: string | null;
    logo_url: string | null;
    active: boolean;
    subscription_expires_at: string | null;
  },
) {
  await assertSuperAdmin(context);
  const { data, error } = await admin
    .from("clubs")
    .update(values)
    .eq("id", id)
    .select(PLATFORM_CLUB_FIELDS)
    .single();
  if (error) throw error;
  return data;
}
