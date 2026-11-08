/** Informational records only: deliberately no product, inventory or monetary fields. */
export const botanicalFields = ["breeder", "lineage", "aroma", "botany"] as const;
export type BotanicalField = (typeof botanicalFields)[number];
export type BotanicalFact = { field: BotanicalField; value: string; source: string };
export type BotanicalImage = {
  url: string;
  source: string;
  title: string;
  author: string;
  license: string;
  license_url: string;
};
export type GeneticsDraft = {
  name: string;
  facts: BotanicalFact[];
  description: string;
  image: BotanicalImage | null;
};
export const normalizeGenetics = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function geneticsName(value: string) {
  const name = value.trim().replace(/\s+/g, " ");
  if (
    name.length < 3 ||
    name.length > 100 ||
    !/^[\p{L}\p{N} '’().-]+$/u.test(name) ||
    /\d{6}|@|https?:/i.test(name)
  )
    throw new Error("Introduce solo el nombre de la genética, sin datos personales.");
  return name;
}
export function informationalSource(value: string) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash)
      return null;
    const paths: Record<string, RegExp> = {
      "www.wikidata.org": /^\/wiki\/Q\d+$/,
      "commons.wikimedia.org": /^\/wiki\/File:/,
      "www.leafly.com": /^\/strains\/[a-z0-9-]+\/?$/,
      "seedfinder.eu": /^\/(?:en|es)\/strain-info\//,
      "www.allbud.com": /^\/marijuana-strains\//,
    };
    return paths[u.hostname]?.test(u.pathname) ? u.href : null;
  } catch {
    return null;
  }
}
export function originalSpanishDescription(name: string, facts: BotanicalFact[]) {
  const labels: Record<BotanicalField, string> = {
    breeder: "Breeder documentado",
    lineage: "Genealogía documentada",
    aroma: "Perfil aromático descrito",
    botany: "Características botánicas documentadas",
  };
  const usable = facts.filter(
    (f) => botanicalFields.includes(f.field) && f.value.trim() && informationalSource(f.source),
  );
  if (!usable.length) return "";
  return (
    `Ficha informativa de ${geneticsName(name)}. ` +
    usable.map((f) => `${labels[f.field]}: ${f.value.trim()}.`).join(" ")
  );
}
export function conflictingFacts(facts: BotanicalFact[]) {
  return botanicalFields.filter(
    (field) =>
      new Set(facts.filter((f) => f.field === field).map((f) => normalizeGenetics(f.value))).size >
      1,
  );
}
export function exactBotanicalImage(image: BotanicalImage, name: string) {
  const title = normalizeGenetics(image.title.replace(/^File:/i, ""));
  return (
    ` ${title} `.includes(` ${normalizeGenetics(name)} `) &&
    !/\b(grinder|poster|logo|label|packet|packaging|wooden|seed packet|hybrid|cross)\b/i.test(title)
  );
}

/** Treat stored JSON as untrusted too: a client can access the RLS-protected table directly. */
export function safeGeneticsImage(image: unknown): BotanicalImage | null {
  if (!image || typeof image !== "object") return null;
  const i = image as BotanicalImage;
  if (
    !["url", "source", "title", "author", "license", "license_url"].every(
      (k) => typeof (i as any)[k] === "string",
    )
  )
    return null;
  if (i.source === "own:confirmed")
    return i.license === "Propia" &&
      i.license_url === "own:confirmed" &&
      i.url.length < 700000 &&
      /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+=*$/.test(i.url)
      ? i
      : null;
  try {
    const u = new URL(i.url),
      license = new URL(i.license_url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "upload.wikimedia.org" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash ||
      !/\.(jpg|jpeg|png|webp)$/i.test(u.pathname)
    )
      return null;
    if (!informationalSource(i.source) || new URL(i.source).hostname !== "commons.wikimedia.org")
      return null;
    if (!/^(Public domain|CC0|CC BY(?:-SA)? [1-4]\.0)$/i.test(i.license)) return null;
    if (
      license.href !== i.source &&
      (license.protocol !== "https:" ||
        license.hostname !== "creativecommons.org" ||
        license.username ||
        license.password ||
        license.port ||
        license.search ||
        license.hash)
    )
      return null;
    return i;
  } catch {
    return null;
  }
}
