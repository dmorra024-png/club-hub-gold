import { z } from "zod";
import { geneticsName, informationalSource } from "../genetics-archive.ts";
import { researchGenetics } from "../genetics-research.server.ts";
import { searchSpecialistCatalog, specialistUrl } from "../specialist-catalog.server.ts";
import { voiceGeneticsSource } from "./source-links.ts";
export const VoiceGeneticsQuery = z.object({ name: z.string().transform(geneticsName) }).strict();
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
  const [research, specialists] = await Promise.all([
    researchGenetics(name, bounded),
    searchSpecialistCatalog(name, bounded),
  ]);
  const facts = research.facts.filter((f) => informationalSource(f.source)).slice(0, 6);
  const excerpts = specialists.descriptions
    .filter((d) => specialistUrl(d.source) && voiceGeneticsSource(d.source, name))
    .slice(0, 3);
  return {
    name,
    facts,
    excerpts,
    verified: facts.length > 0 || excerpts.length > 0,
    persisted: false,
    limitations:
      "Only facts and excerpts with attached sources are verified. Catalog names are not botanical evidence. Do not invent missing breeder, genealogy, composition, effects or medical claims.",
    sources: [...new Set([...facts.map((f) => f.source), ...excerpts.map((d) => d.source)])],
  };
}
