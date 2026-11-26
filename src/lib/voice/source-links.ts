import { informationalSource, normalizeGenetics } from "../genetics-archive.ts";
/** Shared citation boundary: informational paths only, never shop/tracking links. */
export function voiceGeneticsSource(value: string, name: string) {
  if (value.length > 2000) return null;
  if (informationalSource(value)) return value;
  try {
    const u = new URL(value),
      host = u.hostname.replace(/^www\./, ""),
      slug = normalizeGenetics(name).replace(/ /g, "-");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash ||
      !slug
    )
      return null;
    const path = u.pathname.replace(/\/$/, "");
    return (host === "wikileaf.com" && path === "/strain/" + slug) ||
      (host === "strainpedia.com" && path === "/" + slug)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
