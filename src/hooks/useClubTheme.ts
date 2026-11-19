import { useEffect } from "react";
import { getClubTheme } from "@/lib/club-theme-storage";
import { applySnoopTheme, DEFAULT_SNOOP_THEME, isSnoopThemeId, type SnoopThemeId } from "@/lib/snoop-themes";
// Palette-only, memory-only cache avoids a navy flash on every route navigation.
let lastTheme: { clubId: string; id: SnoopThemeId } | null = null;

export function useClubTheme(clubId: string | null | undefined) {
  useEffect(() => {
    let active = true;
    // Auth/session loading may briefly unset clubId during navigation.
    // Preserve the already applied theme instead of flashing the default.
    if (!clubId) return () => { active = false; };
    applySnoopTheme(lastTheme?.clubId === clubId ? lastTheme.id : DEFAULT_SNOOP_THEME);
    const load = async () => {
      try {
        const id = await getClubTheme(clubId);
        if (active) { lastTheme = { clubId, id }; applySnoopTheme(id); }
      } catch {
        // Fail safely to branded default; no unverified cross-club cache.
        if (active) applySnoopTheme(DEFAULT_SNOOP_THEME);
      }
    };
    void load();
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.clubId === clubId && isSnoopThemeId(detail.themeId)) {
        lastTheme = { clubId, id: detail.themeId };
        applySnoopTheme(detail.themeId);
      }
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
