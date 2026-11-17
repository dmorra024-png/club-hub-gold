import { supabase } from "@/integrations/supabase/client";

let cached: string | null = null;

export async function getCurrentClubId(): Promise<string | null> {
  if (cached) return cached;
  const { data } = await supabase.rpc("current_club_id" as any);
  cached = (data as string) ?? null;
  return cached;
}

export function clearClubCache() {
  cached = null;
}
