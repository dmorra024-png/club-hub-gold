import { useEffect } from "react";
import { getClubTheme } from "@/lib/club-theme-storage";
import { applySnoopTheme, DEFAULT_SNOOP_THEME, isSnoopThemeId } from "@/lib/snoop-themes";

export function useClubTheme(clubId: string | null | undefined) {
  useEffect(() => {
    let active = true;
    applySnoopTheme(DEFAULT_SNOOP_THEME);
    if (!clubId) return () => { active = false; };
    const load = async () => {
      try {
        const id = await getClubTheme(clubId);
        if (active) applySnoopTheme(id);
      } catch {
        // Fail safely to branded default; no unverified cross-club cache.
        if (active) applySnoopTheme(DEFAULT_SNOOP_THEME);
      }
    };
    void load();
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.clubId === clubId && isSnoopThemeId(detail.themeId))
        applySnoopTheme(detail.themeId);
    };
    window.addEventListener("snoop:club-theme-changed", onChange);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      window.removeEventListener("snoop:club-theme-changed", onChange);
      window.removeEventListener("focus", load);
    };
  }, [clubId]);
}
