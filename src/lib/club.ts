import { supabase } from "@/integrations/supabase/client";
let cached: string | null = null,
  generation = 0;
export async function getCurrentClubId(): Promise<string | null> {
  if (cached) return cached;
  const version = generation;
  const { data, error } = await supabase.rpc("current_club_id" as any);
  if (error) throw error;
  if (version !== generation) throw new Error("La sesión ha cambiado. Reintenta la operación.");
  cached = (data as string) ?? null;
  return cached;
}
export function clearClubCache() {
  generation++;
  cached = null;
}
