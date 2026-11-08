import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseClubAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  geneticsName,
  informationalSource,
  safeGeneticsImage,
  botanicalFields,
} from "./genetics-archive";
const Name = z.string().transform(geneticsName);
const Fact = z
  .object({
    field: z.enum(["breeder", "lineage", "aroma", "botany"]),
    value: z.string().trim().min(1).max(500),
    source: z.string().refine((s) => !!informationalSource(s), "Fuente informativa no admitida"),
  })
  .strict();
const Image = z
  .object({
    url: z.string().max(700000),
    source: z.string().max(2000),
    title: z.string().max(200),
    author: z.string().max(300),
    license: z.string().max(60),
    license_url: z.string().max(2000),
  })
  .strict();
async function admin(context: any) {
  const { data, error } = await context.supabase.rpc("is_current_user_club_admin", {
    _club_id: context.clubId,
  });
  if (error || data !== true)
    throw new Error("Solo el administrador del club puede revisar fichas.");
}
export const lookupGenetics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((d: unknown) => z.object({ name: Name }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await admin(context);
    const { researchGenetics } = await import("./genetics-research.server");
    return researchGenetics(data.name);
  });
export const listGenetics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseClubAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any)
      .from("genetics_information")
      .select("id,name,facts,description,image,status,updated_at")
      .eq("club_id", context.clubId)
      .order("name")
      .limit(50);
    if (error)
      throw new Error(
        error.code === "42P01" || error.code === "PGRST205"
          ? "Archivo pendiente de activación: falta la nueva tabla informativa. No se ha modificado el catálogo existente."
          : "No se pudo cargar el archivo informativo.",
      );
    return (data ?? []).map((row: any) => ({
      ...row,
      facts: Array.isArray(row.facts)
        ? row.facts.filter(
            (f: any) =>
              f &&
              botanicalFields.includes(f.field) &&
              typeof f.value === "string" &&
              typeof f.source === "string" &&
              informationalSource(f.source),
          )
        : [],
      image: safeGeneticsImage(row.image),
    })) as any[];
  });
export const saveGenetics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: Name,
        facts: z.array(Fact).max(30),
        description: z.string().trim().min(20).max(4000),
        image: Image.nullable(),
        confirmed: z.literal(true),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await admin(context);
    if (data.image?.source === "own:confirmed") {
      if (
        data.image.license !== "Propia" ||
        data.image.license_url !== "own:confirmed" ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(data.image.url)
      )
        throw new Error("Fotografía propia no válida.");
      const bytes = Buffer.from(data.image.url.split(",")[1], "base64");
      if (bytes.length > 500000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
        throw new Error("Fotografía propia no válida.");
    } else if (data.image) {
      // Re-check externally selected candidates on the server; the browser cannot invent a licence.
      const { researchGenetics } = await import("./genetics-research.server");
      const verified = await researchGenetics(data.name);
      if (!verified.images.some((i) => JSON.stringify(i) === JSON.stringify(data.image)))
        throw new Error(
          "La fotografía ya no puede verificarse. Revisa de nuevo o guarda sin imagen.",
        );
    }
    const { confirmed, ...record } = data;
    const { error } = await (context.supabase as any).from("genetics_information").insert({
      ...record,
      club_id: context.clubId,
      reviewed_by: context.userId,
      status: "reviewed",
    });
    if (error) throw new Error("No se pudo guardar la ficha; no se ha modificado ningún producto.");
    return { saved: true };
  });
