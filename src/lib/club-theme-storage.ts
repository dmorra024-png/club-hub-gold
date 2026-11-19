import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SNOOP_THEME, isSnoopThemeId, type SnoopThemeId } from "./snoop-themes";

/** All selections are scoped and protected by database RLS. */
export async function getClubTheme(clubId: string): Promise<SnoopThemeId> {
  const { data, error } = await (supabase.from as any)("snoop_club_themes")
    .select("theme_id").eq("club_id", clubId).maybeSingle();
  if (error) throw error;
  return isSnoopThemeId(data?.theme_id) ? data.theme_id : DEFAULT_SNOOP_THEME;
}
export async function saveClubTheme(clubId: string, themeId: SnoopThemeId): Promise<void> {
  if (!isSnoopThemeId(themeId)) throw Error("INVALID_THEME");
  const { error } = await (supabase.from as any)("snoop_club_themes")
    .upsert({ club_id: clubId, theme_id: themeId }, { onConflict: "club_id" });
  if (error) throw error;
  window.dispatchEvent(new CustomEvent("snoop:club-theme-changed", { detail: { clubId, themeId } }));
}
