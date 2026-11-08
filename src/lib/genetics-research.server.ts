import { licensedCatalogImages } from "./catalog-enrichment.server.ts";
import {
  geneticsName,
  normalizeGenetics,
  exactBotanicalImage,
  type BotanicalFact,
} from "./genetics-archive.ts";
export type GeneticsResearch = {
  name: string;
  facts: BotanicalFact[];
  images: ReturnType<typeof licensedCatalogImages>;
  references: { title: string; url: string }[];
  warnings: string[];
};
async function openJson(url: URL, request: typeof fetch) {
  const r = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      "User-Agent": "SNOOP/1.0 (informational botanical archive)",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // Bound external payloads, including chunked responses.
  const reader = r.body?.getReader();
  if (!reader) throw new Error("Empty source");
  let bytes = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 250000) throw new Error("Source too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(text + decoder.decode());
}
export async function researchGenetics(
  raw: string,
  request: typeof fetch = fetch,
): Promise<GeneticsResearch> {
  const name = geneticsName(raw),
    result: GeneticsResearch = { name, facts: [], images: [], references: [], warnings: [] };
  const endpoint = new URL("https://www.wikidata.org/w/api.php");
  endpoint.search = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "en",
    format: "json",
    limit: "5",
  }).toString();
  await Promise.all([
    (async () => {
      try {
        const json = await openJson(endpoint, request);
        // A matching name alone is not evidence: reject unrelated astronomy, music etc.
        const matches = (json.search ?? []).filter(
          (e: any) =>
            normalizeGenetics(e.label ?? "") === normalizeGenetics(name) &&
            /\bcannabis\b/i.test(e.description ?? "") &&
            /^Q\d+$/.test(e.id ?? ""),
        );
        if (matches.length === 1) {
          const source = `https://www.wikidata.org/wiki/${matches[0].id}`;
          result.references.push({ title: matches[0].label, url: source });
          result.facts.push({
            field: "botany",
            value: "variedad de Cannabis identificada en Wikidata",
            source,
          });
        } else
          result.warnings.push(
            "Wikidata no ofrece una coincidencia botánica única y verificable. Breeder, genealogía y aroma requieren documentación del administrador.",
          );
      } catch {
        result.warnings.push("Wikidata no disponible. No se han inventado datos.");
      }
    })(),
    (async () => {
      try {
        const commons = new URL("https://commons.wikimedia.org/w/api.php");
        commons.search = new URLSearchParams({
          action: "query",
          format: "json",
          generator: "search",
          gsrnamespace: "6",
          gsrsearch: `"${name}" cannabis filetype:bitmap`,
          gsrlimit: "6",
          prop: "imageinfo",
          iiprop: "url|extmetadata",
          iiurlwidth: "640",
        }).toString();
        const payload = await openJson(commons, request);
        for (const [id, page] of Object.entries(payload?.query?.pages ?? {}) as [string, any][]) {
          const meta = page.imageinfo?.[0]?.extmetadata;
          const context = `${page.title ?? ""} ${meta?.ImageDescription?.value ?? ""} ${meta?.Categories?.value ?? ""}`;
          if (!/\b(cannabis|marijuana|hemp|hanf|cáñamo)\b/i.test(context))
            delete payload.query.pages[id];
        }
        result.images = licensedCatalogImages(payload, name)
          .filter((i) => exactBotanicalImage(i, name))
          .slice(0, 3);
      } catch {
        result.warnings.push("La búsqueda de fotografías no está disponible.");
      }
    })(),
  ]);
  result.warnings.push(
    "Breeder, genealogía y perfil aromático no verificados automáticamente: aporta fuentes documentadas antes de completarlos.",
  );
  if (!result.images.length)
    result.warnings.push(
      "No se encontró una fotografía con nombre exacto y licencia reutilizable comprobada. Puedes aportar una foto propia.",
    );
  result.warnings.push(
    "Las fuentes especializadas no se extraen automáticamente sin condiciones de reutilización verificadas. Revisa identidad, autor y licencia antes de confirmar.",
  );
  return result;
}
