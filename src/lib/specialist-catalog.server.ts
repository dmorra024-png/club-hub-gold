import type { CatalogImage } from "./catalog-enrichment.server";
export type CatalogDescription = { title: string; source: string; excerpt: string };
const hosts = [
  "www.strainpedia.com",
  "strainpedia.com",
  "www.leafly.com",
  "leafly.com",
  "www.allbud.com",
  "allbud.com",
  "www.wikileaf.com",
  "wikileaf.com",
  "seedfinder.eu",
  "www.seedfinder.eu",
];
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, hex, dec) => {
      const n = parseInt(hex || dec, hex ? 16 : 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    })
    .replace(/&#39;|&apos;/g, "'");
const plain = (s: string) =>
  decode(s.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const norm = (s: string) =>
  plain(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
export function specialistUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      hosts.includes(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
      ? u
      : null;
  } catch {
    return null;
  }
}
function meta(html: string, name: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes: Object & Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs))
      attributes[m[1].toLowerCase()] = decode(m[3]);
    if ((attributes.property || attributes.name || "").toLowerCase() === name)
      return plain(attributes.content || "");
  }
  return "";
}
export function specialistDescription(
  html: string,
  url: string,
  name: string,
): CatalogDescription | null {
  if (!specialistUrl(url)) return null;
  const title =
    meta(html, "og:title") || plain(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  if (norm(name).length < 3 || !(" " + norm(title) + " ").includes(" " + norm(name) + " "))
    return null;
  const description = meta(html, "description") || meta(html, "og:description");
  if (description.length < 20) return null;
  // Short attributed excerpt, never a fabricated AI assertion or a copied full article.
  const excerpt = description.split(/\s+/).slice(0, 35).join(" ").slice(0, 180);
  return { title: title.slice(0, 180), source: url, excerpt };
}
export function specialistImages(html: string, source: string, name: string): CatalogImage[] {
  const origin = specialistUrl(source);
  if (!origin || norm(name).length < 3) return [];
  const candidates: CatalogImage[] = [];
  let visited = 0;
  const walk = (value: any) => {
    if (++visited > 150 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value["@type"] === "ImageObject") {
      try {
        const image = new URL(value.contentUrl || value.url),
          license = new URL(value.license);
        const publisher = origin.hostname.replace(/^www\./, "");
        const author = plain(
          typeof value.creator === "string"
            ? value.creator
            : value.creator?.name || value.creditText || "",
        );
        const label = plain(value.caption || value.name || "");
        if (
          image.protocol === "https:" &&
          !image.username &&
          !image.password &&
          !image.port &&
          !image.search &&
          (image.hostname === publisher || image.hostname.endsWith("." + publisher)) &&
          license.protocol === "https:" &&
          license.hostname === "creativecommons.org" &&
          /^\/(?:licenses\/by(?:-sa)?\/[1-4]\.0|publicdomain\/zero\/1\.0)(?:\/|$)/.test(
            license.pathname,
          ) &&
          author &&
          (" " + norm(label) + " ").includes(" " + norm(name) + " ")
        ) {
          candidates.push({
            url: image.href,
            source,
            title: label.slice(0, 180),
            author: author.slice(0, 180),
            license: license.pathname.includes("/zero/")
              ? "CC0"
              : license.pathname.includes("/by-sa/")
                ? "CC BY-SA " + license.pathname.split("/")[3]
                : "CC BY " + license.pathname.split("/")[3],
            license_url: license.href,
          });
        }
      } catch {}
    }
    for (const [key, item] of Object.entries(value))
      if (!["description", "text", "articleBody"].includes(key)) walk(item);
  };
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1]));
    } catch {}
  }
  return candidates.slice(0, 3);
}
export function robotsAllow(text: string, path: string) {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; pattern: string }[] };
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(user-agent|allow|disallow)\s*:\s*([^#]*)/i.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase(),
      value = match[2].trim();
    if (key === "user-agent") {
      if (group.rules.length) {
        groups.push(group);
        group = { agents: [], rules: [] };
      }
      group.agents.push(value.toLowerCase());
    } else if (value && group.agents.length)
      group.rules.push({ allow: key === "allow", pattern: value });
  }
  groups.push(group);
  let best = -1;
  let rules: { allow: boolean; pattern: string }[] = [];
  for (const g of groups) {
    const specificity = Math.max(
      -1,
      ...g.agents.map((a) => (a === "*" ? 0 : "snoop".startsWith(a) ? a.length : -1)),
    );
    if (specificity > best) {
      best = specificity;
      rules = g.rules;
    } else if (specificity === best && best >= 0) rules.push(...g.rules);
  }
  const matches = rules.filter((rule) => {
    const pattern = rule.pattern
      .split("*")
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")
      .replace(/\\\$$/, "$");
    return new RegExp("^" + pattern).test(path);
  });
  matches.sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}
async function textResponse(url: URL, request: typeof fetch, max = 220000) {
  const r = await request(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(7000),
    headers: {
      "User-Agent": "SNOOP/1.0 (informational catalog lookup)",
      Accept: "text/html,text/plain",
    },
  });
  if (!r.ok) throw new Error("Source unavailable");
  const reader = r.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (bytes < max) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value.subarray(0, max - bytes));
      bytes += value.length;
    }
  } finally {
    await reader.cancel();
  }
  const result = new Uint8Array(Math.min(bytes, max));
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return new TextDecoder().decode(result);
}
export async function searchSpecialistCatalog(name: string, request: typeof fetch = fetch) {
  const slug = norm(name).replace(/ /g, "-");
  if (slug.length < 3 || slug.length > 120)
    return {
      descriptions: [] as CatalogDescription[],
      images: [] as CatalogImage[],
      warning: "Nombre no válido para buscar fuentes.",
    };
  const publishers = [
    { host: "leafly.com", direct: `https://www.leafly.com/strains/${slug}` },
    { host: "strainpedia.com", direct: `https://www.strainpedia.com/${slug}/` },
    { host: "seedfinder.eu", direct: "" },
    { host: "allbud.com", direct: "" },
    { host: "wikileaf.com", direct: `https://www.wikileaf.com/strain/${slug}/` },
  ];
  const descriptions: CatalogDescription[] = [];
  const images: CatalogImage[] = [];
  const seen = new Set<string>();
  // Priority is deterministic: start with Leafly and continue in order when
  // there is no description or no licensed matching image.
  for (const publisher of publishers) {
    if (descriptions.length && images.length) break;
    const candidates: string[] = [];
    if (publisher.direct) candidates.push(publisher.direct);
    // Search is restricted to one specialist publisher at a time. A failed
    // search does not prevent a direct page from being checked.
    try {
      const search = new URL("https://html.duckduckgo.com/html/");
      search.searchParams.set("q", `"${name.replace(/["\\\\]/g, " ")}" site:${publisher.host}`);
      const html = await textResponse(search, request, 120000);
      for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
        try {
          const link = new URL(decode(m[1]), search);
          const destination = link.searchParams.get("uddg") || link.href;
          const u = new URL(destination);
          // Search engine may return query-bearing tracking URLs. Only use
          // canonical HTTPS paths on approved specialist hosts.
          if (!["https:"].includes(u.protocol)) continue;
          u.search = "";
          u.hash = "";
          const approved = specialistUrl(u.href);
          if (approved && approved.hostname.replace(/^www\\./, "") === publisher.host &&
              !candidates.includes(approved.href)) candidates.push(approved.href);
        } catch {}
      }
    } catch {}
    for (const raw of candidates.slice(0, 5)) {
      const url = specialistUrl(raw);
      if (!url || seen.has(url.href)) continue;
      seen.add(url.href);
      try {
        const robots = await textResponse(new URL("/robots.txt", url), request, 32000);
        if (!robotsAllow(robots, url.pathname)) continue;
        const html = await textResponse(url, request);
        const entry = specialistDescription(html, url.href, name);
        if (!entry) continue;
        if (!descriptions.length) descriptions.push(entry);
        if (!images.length) images.push(...specialistImages(html, url.href, name));
        if (descriptions.length && images.length) break;
      } catch {
        // Unavailable, disallowed or unverifiable pages are never invented.
      }
    }
  }
  return {
    descriptions,
    images: images.slice(0, 3),
    warning: descriptions.length
      ? "Ficha informativa con fuente verificada. Las imágenes solo se incorporan con licencia explícita."
      : "No se encontraron fuentes especializadas accesibles y verificadas; puedes aportar una imagen propia.",
  };
}
