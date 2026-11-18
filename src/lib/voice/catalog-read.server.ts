import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import { normalizedPilotNames } from "../deepgram-pilot-policy.ts";
export const VoiceCatalogQuery = z
  .object({
    kind: z.enum(["products", "categories"]),
    query: z
      .string()
      .trim()
      .min(2)
      .max(60)
      .regex(/^[\p{L}\p{N} .&'’()+,:%_\/#-]+$/u),
  })
  .strict();
/** Bounded on-demand lookup beyond the initial pronunciation snapshot. Names ONLY. */
export async function voiceCatalogSearch(
  url: string,
  key: string,
  token: string,
  access: AccountAccess,
  args: unknown,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  const input = VoiceCatalogQuery.parse(args);
  if (url !== "https://bnwanxbmprbymbutoths.supabase.co" || !key || !token)
    throw Error("AUTH_CONFIG");
  if (
    access.status !== "active" ||
    !access.clubId ||
    !access.permissions.includes("manage_products")
  )
    throw Error("AUTH_FORBIDDEN");
  const target = new URL(
    "/rest/v1/" + (input.kind === "products" ? "products" : "product_categories"),
    url,
  );
  target.searchParams.set("select", "name");
  target.searchParams.set("club_id", "eq." + access.clubId);
  target.searchParams.set(
    "or",
    input.kind === "products"
      ? "(active.eq.true,active.is.null)"
      : "(archived.eq.false,archived.is.null)",
  );
  target.searchParams.set("name", "ilike.%" + input.query.replace(/[\\%_]/g, "\\$&") + "%");
  target.searchParams.set("order", "name.asc");
  target.searchParams.set("limit", "7");
  const deadline = AbortSignal.timeout(6000);
  const response = await fetcher(target, {
    method: "GET",
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    headers: {
      Authorization: "Bearer " + token,
      apikey: key,
      "Cache-Control": "no-cache, no-store",
    },
  });
  if (!response.ok) throw Error("CATALOG_UNAVAILABLE");
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 7 || rows.some((r) => !r || typeof r.name !== "string"))
    throw Error("CATALOG_UNAVAILABLE");
  return {
    kind: input.kind,
    matches: normalizedPilotNames(rows, 6),
    truncated: rows.length > 6,
    source: "authorized-club-catalog",
    persisted: false,
  };
}
