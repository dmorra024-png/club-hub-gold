import { searchSpecialistCatalog, type CatalogDescription } from "./specialist-catalog.server";
import { createServerFn } from "@tanstack/react-start";
import { requireClubCatalogAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  describeCatalog,
  searchCatalogImages,
  type CatalogImage,
} from "./catalog-enrichment.server";
const Input = z
  .object({
    name: z.string().trim().min(1).max(120),
    strain: z.string().max(80).optional().default(""),
    is_smokeable: z.boolean().optional().default(false),
    category_name: z.string().max(120).optional().default(""),
  })
  .strict();
export type EnrichResult = {
  description: string;
  image_url: string;
  images: CatalogImage[];
  warning: string;
  descriptions: CatalogDescription[];
};
export const enrichProduct = createServerFn({ method: "POST" })
  .middleware([requireClubCatalogAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<EnrichResult> => {
    if (process.env.AI_PROVIDER !== "cloudflare")
      throw new Error(
        "Configura el binding gratuito SNOOP_AI. No se utiliza un proveedor de pago.",
      );
    // Retrieve evidence first: the AI must not describe a strain without seeing
    // the specialist source material. Each lookup fails independently.
    const lookups = await Promise.allSettled([
      searchCatalogImages(data.strain.trim() || data.name),
      searchSpecialistCatalog(data.strain.trim() || data.name),
    ]);
    const images = lookups[0].status === "fulfilled" ? lookups[0].value : [];
    const specialist =
      lookups[1].status === "fulfilled"
        ? lookups[1].value
        : { descriptions: [], images: [], warning: "Fuentes especializadas no disponibles." };
    let description = "";
    try {
      description = await describeCatalog({
        name: data.name,
        category_name: data.category_name,
        strain: data.strain,
        sources: specialist.descriptions.map(({ title, source, excerpt }) => ({
          title, source, excerpt,
        })),
      });
    } catch {
      // No invented facts or copied descriptions if the free model is unavailable.
      // The short, attributable candidates are still offered for manual review.
    }
    const eligibleImages = [...specialist.images, ...images]
      .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
      .slice(0, 3);
    const warning = [
      specialist.warning,
      !description
        ? "Descripción IA no disponible: revisa el binding SNOOP_AI, la autorización de catálogo o la cuota gratuita."
        : "",
      !eligibleImages.length
        ? "No se encontró una imagen con nombre y licencia compatibles. Usa una imagen propia."
        : "Comprueba que la imagen corresponde al producto exacto antes de seleccionarla.",
    ]
      .filter(Boolean)
      .join(" ");
    if (!description && !eligibleImages.length && !specialist.descriptions.length) throw new Error(warning);
    // No generated photography, automatic image selection, database writes or paid fallback.
    return {
      description,
      image_url: "",
      images: eligibleImages,
      warning,
      descriptions: specialist.descriptions,
    };
  });
