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
    const result = await Promise.allSettled([
      describeCatalog({
        name: data.name,
        category_name: data.category_name,
        strain: data.strain,
      }),
      searchCatalogImages(data.strain.trim() || data.name),
      searchSpecialistCatalog(data.strain.trim() || data.name),
    ]);
    const description = result[0].status === "fulfilled" ? result[0].value : "";
    const images = result[1].status === "fulfilled" ? result[1].value : [];
    const specialist =
      result[2].status === "fulfilled"
        ? result[2].value
        : { descriptions: [], images: [], warning: "Fuentes especializadas no disponibles." };
    const warning = [
      specialist.warning,
      !description
        ? "Descripción IA no disponible: revisa el binding SNOOP_AI, la autorización de catálogo o la cuota gratuita."
        : "",
      !images.length
        ? "No se encontró una imagen con nombre y licencia compatibles. Usa una imagen propia."
        : "Comprueba que la imagen corresponde al producto exacto antes de seleccionarla.",
    ]
      .filter(Boolean)
      .join(" ");
    if (!description && !images.length && !specialist.descriptions.length) throw new Error(warning);
    // No generated photography, automatic image selection, database writes or paid fallback.
    return {
      description,
      image_url: "",
      images: [...specialist.images, ...images]
        .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
        .slice(0, 3),
      warning,
      descriptions: specialist.descriptions,
    };
  });
