import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { requireSupabaseClubAuth } from "@/integrations/supabase/auth-middleware";
import { parseAccountAccess } from "./access-context";
import { deepgramPilotAllowed, normalizedPilotNames } from "./deepgram-pilot-policy";

/**
 * A safe first gate for the admin-only voice pilot.
 * This endpoint does NOT create a Deepgram session, expose provider tokens,
 * send personal data, or enable any operational write.
 */
export const deepgramPilotCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((input: unknown) => {
    if (
      !input ||
      typeof input !== "object" ||
      (input as { consent?: unknown }).consent !== true ||
      Object.keys(input).some((key) => key !== "consent")
    )
      throw new Error("SNOOP_DEEPGRAM_CONSENT_REQUIRED");
    return { consent: true as const };
  })
  .handler(async ({ context }) => {
    setResponseHeader("Cache-Control", "no-store, private");
    const { data: accessData, error: accessError } =
      await context.supabase.rpc("snoop_access_context");
    if (accessError) throw new Error("SNOOP_DEEPGRAM_ACCESS_UNAVAILABLE");
    const access = parseAccountAccess(accessData);
    if (
      access.clubId !== context.clubId ||
      !deepgramPilotAllowed(access, context.userId, {
        enabled: process.env.SNOOP_DEEPGRAM_PILOT_ENABLED,
        allowedUserId: process.env.SNOOP_DEEPGRAM_PILOT_USER_ID,
        allowedClubId: process.env.SNOOP_DEEPGRAM_PILOT_CLUB_ID,
      })
    )
      throw new Error("SNOOP_DEEPGRAM_NOT_AUTHORIZED");

    // User-scoped RLS plus explicit club filters; names only, never member,
    // financial, order, pricing or inventory quantities.
    const [categories, products] = await Promise.all([
      context.supabase
        .from("product_categories")
        .select("name")
        .eq("club_id", context.clubId)
        .eq("archived", false)
        .order("name")
        .limit(35),
      context.supabase
        .from("products")
        .select("name")
        .eq("club_id", context.clubId)
        .eq("active", true)
        .order("name")
        .limit(35),
    ]);
    if (categories.error || products.error)
      throw new Error("SNOOP_DEEPGRAM_CATALOG_UNAVAILABLE");
    return {
      categories: normalizedPilotNames(categories.data),
      products: normalizedPilotNames(products.data),
      mode: "synthetic-preview" as const,
      writesEnabled: false as const,
      providerConnected: false as const,
    };
  });
