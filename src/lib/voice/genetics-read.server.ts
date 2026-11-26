import { z } from "zod";
import { geneticsName } from "../genetics-archive.ts";
import { searchSpecialistCatalog, specialistUrl } from "../specialist-catalog.server.ts";
import { canonicalGeneticOrProduct } from "./catalog-vocabulary.ts";
import { voiceGeneticsSource } from "./source-links.ts";
export const VoiceGeneticsQuery = z.object({ name: z.string().transform((input) => geneticsName(canonicalGeneticOrProduct(input))) }).strict();
/** Existing licensed-source research, informational only: no inventory/pricing or writes. */
export async function voiceGeneticsInformation(
  args: unknown,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const { name } = VoiceGeneticsQuery.parse(args),
    deadline = AbortSignal.timeout(12000);
  const allowed = new Set([
    "www.wikidata.org",
    "commons.wikimedia.org",
    "html.duckduckgo.com",
    "www.leafly.com",
    "leafly.com",
    "www.strainpedia.com",
    "strainpedia.com",
    "seedfinder.eu",
    "www.seedfinder.eu",
    "www.allbud.com",
    "allbud.com",
    "www.wikileaf.com",
    "wikileaf.com",
  ]);
  let calls = 0;
  const bounded: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (
      ++calls > 40 ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !allowed.has(url.hostname)
    )
      throw Error("SOURCE_UNAVAILABLE");
    const signals = [deadline, ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])];
    const result = await request(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.any(signals),
    });
    if (result.status >= 300 && result.status < 400) throw Error("SOURCE_REDIRECT_REJECTED");
    return result;
  };
  // A single sequential source chain, not a simultaneous multi-site search.
  // The specialist reader tries Leafly and uses Strainpedia only if Leafly
  // has no attributable matching description. No Wikidata/Commons fallback.
  const specialists = await searchSpecialistCatalog(name, bounded);
  const facts: Array<{ field: string; value: string; source: string }> = [];
  const excerpts = specialists.descriptions
    .filter((d) => specialistUrl(d.source) && voiceGeneticsSource(d.source, name))
    .slice(0, 1);
  return {
    name,
    facts,
    excerpts,
    verified: facts.length > 0 || excerpts.length > 0,
    persisted: false,
    limitations:
      "Priority Leafly, then Strainpedia only when no matching verified Leafly description exists. A failed or blocked source is not proof of absence. Catalog names are not botanical evidence. Do not invent missing breeder, genealogy, composition, effects or medical claims.",
    sources: [...new Set([...facts.map((f) => f.source), ...excerpts.map((d) => d.source)])],
  };
}
