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
      searchCatalogImages(data.name),
    ]);
    const description = result[0].status === "fulfilled" ? result[0].value : "";
    const images = result[1].status === "fulfilled" ? result[1].value : [];
    const warning = [
      !description
        ? "Descripción IA no disponible: revisa el binding SNOOP_AI, la autorización de catálogo o la cuota gratuita."
        : "",
      !images.length
        ? "No se encontró una imagen con nombre y licencia compatibles. Usa una imagen propia."
        : "Comprueba que la imagen corresponde al producto exacto antes de seleccionarla.",
    ]
      .filter(Boolean)
      .join(" ");
    if (!description && !images.length) throw new Error(warning);
    // No generated photography, automatic image selection, database writes or paid fallback.
    return { description, image_url: "", images, warning };
  });
