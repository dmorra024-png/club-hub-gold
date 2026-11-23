import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getClubTheme, saveClubTheme } from "@/lib/club-theme-storage";
import { SNOOP_THEMES, DEFAULT_SNOOP_THEME, type SnoopThemeId } from "@/lib/snoop-themes";

export function ClubThemeSettingsPanel() {
  const { access, isAdmin, loading } = useAuth();
  const clubId = access.clubId;
  const [selected, setSelected] = useState<SnoopThemeId>(DEFAULT_SNOOP_THEME);
  const [saved, setSaved] = useState<SnoopThemeId>(DEFAULT_SNOOP_THEME);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (loading || !isAdmin || !clubId) return;
    let active = true;
    setReady(false);
    setMessage("");
    getClubTheme(clubId).then(id => {
      if (active) { setSaved(id); setSelected(id); setReady(true); }
    }).catch(() => {
      if (active) setMessage("No se pudieron cargar los temas. Reintenta más tarde.");
    });
    return () => { active = false; };
  }, [clubId, isAdmin, loading]);
  async function apply() {
    if (!clubId || !isAdmin || !ready || busy || selected === saved) return;
    setBusy(true);
    setMessage("");
    try {
      await saveClubTheme(clubId, selected);
      setSaved(selected);
      setMessage("Tema guardado para este club. Los socios lo verán al abrir su carnet.");
    } catch {
      setMessage("No se pudo guardar el tema. Comprueba la conexión y los permisos.");
    } finally { setBusy(false); }
  }
  if (loading || !isAdmin || !clubId) return null;
  return (
    <section id="tema-visual" aria-labelledby="snoop-theme-title" className="snoop-theme-settings">
      <div className="snoop-theme-heading">
        <span className="snoop-theme-icon"><Palette size={22} aria-hidden="true" /></span>
        <div>
          <h2 id="snoop-theme-title">Tema visual</h2>
          <p>Elige un diseño premium para este club. Se aplica al gestor y a SNOOP Socio.</p>
        </div>
      </div>
      <div role="radiogroup" aria-label="Paletas de color del club" className="snoop-theme-grid">
        {(Object.entries(SNOOP_THEMES) as [SnoopThemeId, typeof SNOOP_THEMES[SnoopThemeId]][]).map(([key, theme]) => (
          <button type="button" key={key} role="radio" aria-checked={selected === key}
            disabled={!ready || busy} className="snoop-theme-choice"
            data-selected={selected === key} onClick={() => setSelected(key)}>
            <span className="snoop-theme-preview" style={{ background: theme.canvas, borderColor: theme.border }}>
              <span className="snoop-theme-preview-card" style={{ background: theme.panel, borderColor: theme.border }}>
                <span style={{ background: theme.accent, width: "60%" }} />
                <span style={{ background: theme.muted, width: "80%" }} />
                <span style={{ background: theme.elevated, width: "44%" }} />
              </span>
              <span className="snoop-theme-preview-button" style={{ background: theme.accent }} />
            </span>
            <span className="snoop-theme-name">{theme.label}</span>
            {selected === key && <Check aria-hidden="true" size={16} />}
          </button>
        ))}
      </div>
      <div className="snoop-theme-actions">
        <span role="status" aria-live="polite">{message || (ready ? "Selecciona una paleta para tu club." : "Cargando temas…")}</span>
        <button type="button" disabled={!ready || busy || saved === selected}
          className="snoop-theme-save" onClick={() => void apply()}>
          {busy ? "Guardando…" : "Aplicar tema"}
        </button>
      </div>
    </section>
  );
}
