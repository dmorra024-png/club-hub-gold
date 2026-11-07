import { generateText } from "ai";
import { administrativeModel } from "./administrative-ai.server.ts";

export type CatalogImage = {
  url: string;
  source: string;
  title: string;
  author: string;
  license: string;
  license_url: string;
};
const plain = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
const norm = (s: string) =>
  plain(s)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// License metadata and an exact phrase match are mandatory. Results are candidates,
// never claims of product identity; the operator must check the source and confirm.
export function licensedCatalogImages(payload: any, name: string): CatalogImage[] {
  const needle = norm(name);
  if (needle.length < 3) return [];
  return Object.values(payload?.query?.pages ?? {})
    .flatMap((page: any) => {
      const info = page.imageinfo?.[0],
        meta = info?.extmetadata;
      const license = plain(meta?.LicenseShortName?.value);
      let licenseUrl = meta?.LicenseUrl?.value;
      const title = plain(page.title).replace(/^File:/i, "");
      const description = plain(meta?.ImageDescription?.value);
      const haystack = ` ${norm(title + " " + description)} `;
      if (
        !haystack.includes(` ${needle} `) ||
        !/^(CC0|Public domain|CC BY(?:-SA)? [1-4]\.0)$/i.test(license)
      )
        return [];
      try {
        const url = new URL(info.thumburl || info.url),
          source = new URL(info.descriptionurl);
        if (
          url.protocol !== "https:" ||
          !["upload.wikimedia.org", "thumb.wikimedia.org"].includes(url.hostname) ||
          !/\.(?:jpe?g|png|webp)$/i.test(url.pathname) ||
          source.protocol !== "https:" ||
          source.hostname !== "commons.wikimedia.org"
        )
          return [];
        if (licenseUrl) {
          const reference = new URL(licenseUrl);
          if (
            !["http:", "https:"].includes(reference.protocol) ||
            reference.hostname !== "creativecommons.org" ||
            reference.username ||
            reference.password ||
            reference.search ||
            reference.hash
          )
            return [];
          const match = /^CC (BY(?:-SA)?) ([1-4]\.0)$/i.exec(license);
          const expected = match
            ? `/licenses/${match[1].toLowerCase()}/${match[2]}`
            : "/publicdomain/";
          if (!reference.pathname.startsWith(expected)) return [];
          reference.protocol = "https:";
          licenseUrl = reference.href;
        } else if (license !== "Public domain") return [];
        const author = plain(meta?.Artist?.value);
        if (!author) return [];
        return [
          {
            url: url.href,
            source: source.href,
            title,
            author: author.slice(0, 300),
            license,
            license_url: licenseUrl || source.href,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 4);
}
export async function searchCatalogImages(name: string, request: typeof fetch = fetch) {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrnamespace: "6",
    gsrsearch: `"${name.replace(/["\\]/g, " ")}" filetype:bitmap`,
    gsrlimit: "6",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
  }).toString();
  const response = await request(url, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
    headers: {
      "User-Agent": "SNOOP/1.0 (administrative catalog image lookup)",
    },
  });
  if (!response.ok)
    throw new Error("La búsqueda de imágenes no está disponible; carga una imagen propia.");
  return licensedCatalogImages(await response.json(), name);
}
export async function describeCatalog(input: {
  name: string;
  category_name: string;
  strain: string;
}) {
  // Only the three explicitly validated public catalog fields; never member data,
  // documents, conversation history, inventory, prices or club/user identifiers.
  const { text } = await generateText({
    model: administrativeModel("catalog"),
    maxRetries: 0,
    system:
      "Redacta en español una ficha administrativa informativa de hasta 2 frases usando exclusivamente los datos proporcionados. No inventes propiedades, composición, origen, efectos, marcas, resultados de búsqueda ni datos medicinales. Señala que cualquier detalle no proporcionado está pendiente de verificación. No uses markdown ni recomendaciones de consumo.",
    prompt: JSON.stringify(input),
  });
  let output = text.trim();
  if (output.startsWith("{")) {
    try {
      const parsed = JSON.parse(output);
      output = typeof parsed.description === "string" ? parsed.description : "";
    } catch {
      output = "";
    }
  }
  const description = output
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 400);
  if (!description)
    throw new Error("Workers AI no devolvió una descripción. Puedes escribirla manualmente.");
  return description;
}
