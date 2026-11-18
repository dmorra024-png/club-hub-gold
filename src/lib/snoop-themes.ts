/** SNOOP branded palettes. Fixed curated themes; never accept arbitrary CSS from users. */
export const SNOOP_THEMES = {
  "navy-gold": { label: "Azul y oro", canvas: "#050C17", panel: "#0B1827", elevated: "#13263B", accent: "#E5BC78", accentLight: "#F8DDA7", foreground: "#F3F4F7", muted: "#A7B3C2", border: "#41516A", accentInk: "#091321" },
  "graphite-copper": { label: "Grafito y cobre", canvas: "#101114", panel: "#1B1E23", elevated: "#292D34", accent: "#C98A5D", accentLight: "#E7B58E", foreground: "#F7F5F3", muted: "#B0B4BC", border: "#5A5353", accentInk: "#151113" },
  "aubergine-amethyst": { label: "Berenjena y amatista", canvas: "#160B20", panel: "#261433", elevated: "#39204D", accent: "#C292F0", accentLight: "#E0C5FA", foreground: "#F8F2FC", muted: "#C4B4D0", border: "#644878", accentInk: "#190E21" },
  "petrol-titanium": { label: "Petróleo y titanio", canvas: "#041C20", panel: "#0B3035", elevated: "#13434B", accent: "#71D5D2", accentLight: "#B4ECEA", foreground: "#F1F9FA", muted: "#B1C8CB", border: "#37696D", accentInk: "#041F24" },
  "ivory-champagne": { label: "Marfil y champagne", canvas: "#F7F2EA", panel: "#FFFCF8", elevated: "#E9DED0", accent: "#93612D", accentLight: "#B98552", foreground: "#30251F", muted: "#675D57", border: "#CDBDA8", accentInk: "#FFFFFF" },
  "ruby-gold": { label: "Rojo rubí y oro", canvas: "#30050E", panel: "#4A0C1B", elevated: "#720D20", accent: "#D4AF67", accentLight: "#F2D394", foreground: "#FFF5EE", muted: "#D3B5B6", border: "#9A5960", accentInk: "#310610" },
  "emerald-gold": { label: "Verde esmeralda y oro", canvas: "#03261F", panel: "#08392E", elevated: "#10513F", accent: "#D4AF77", accentLight: "#F3DBA9", foreground: "#F4F8F1", muted: "#B9CDBF", border: "#477A65", accentInk: "#08271C" },
} as const;

export type SnoopThemeId = keyof typeof SNOOP_THEMES;
export const DEFAULT_SNOOP_THEME: SnoopThemeId = "navy-gold";
export function isSnoopThemeId(value: unknown): value is SnoopThemeId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SNOOP_THEMES, value);
}
export function applySnoopTheme(id: SnoopThemeId) {
  if (typeof document === "undefined") return;
  const palette = SNOOP_THEMES[id];
  const root = document.documentElement;
  root.dataset.snoopTheme = id;
  for (const [name, value] of Object.entries(palette)) {
    if (name !== "label") root.style.setProperty("--snoop-" + name.replace(/[A-Z]/g, x => "-" + x.toLowerCase()), value);
  }
  root.style.setProperty("--background", palette.canvas);
  root.style.setProperty("--foreground", palette.foreground);
  root.style.setProperty("--card", palette.panel);
  root.style.setProperty("--card-foreground", palette.foreground);
  root.style.setProperty("--popover", palette.panel);
  root.style.setProperty("--popover-foreground", palette.foreground);
  root.style.setProperty("--primary", palette.accent);
  root.style.setProperty("--primary-foreground", palette.accentInk);
  root.style.setProperty("--secondary", palette.elevated);
  root.style.setProperty("--secondary-foreground", palette.foreground);
  root.style.setProperty("--muted", palette.elevated);
  root.style.setProperty("--muted-foreground", palette.muted);
  root.style.setProperty("--accent", palette.elevated);
  root.style.setProperty("--accent-foreground", palette.foreground);
  root.style.setProperty("--border", palette.border);
  root.style.setProperty("--input", palette.elevated);
  root.style.setProperty("--ring", palette.accent);
  root.style.setProperty("--neon", palette.accent);
  root.style.setProperty("--neon-dim", palette.accent);
  root.style.setProperty("--neon-deep", palette.elevated);
  root.style.setProperty("--gold", palette.accent);
  root.style.setProperty("--gradient-neon", `linear-gradient(115deg, ${palette.accentLight}, ${palette.accent})`);
  root.style.setProperty("--gradient-bg", `radial-gradient(ellipse at 80% 0%, ${palette.elevated} 0%, ${palette.canvas} 68%)`);
  root.style.colorScheme = id === "ivory-champagne" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", palette.canvas);
}
