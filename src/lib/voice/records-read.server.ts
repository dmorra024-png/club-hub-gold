import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
export const RecordsQuery = z
  .object({
    kind: z.enum([
      "members",
      "products",
      "categories",
      "stock",
      "membership_plans",
      "discounts",
      "cash_sessions",
    ]),
    query: z
      .string()
      .trim()
      .min(0)
      .max(100)
      .regex(/^[\p{L}\p{N} .&'’%_\/#-]*$/u),
  })
  .strict();
const projections = {
  members: "id,first_name,last_name,city,expires_at",
  products: "id,name,description,category_id",
  categories: "id,name,archived",
  stock: "id,name,stock,category_id",
  membership_plans: "id,name,price_cents,duration_days,active",
  discounts: "id,name,percentage_basis_points,active,valid_from,valid_until",
  cash_sessions: "id,status,opened_at,closed_at,opening_cash_cents,closing_cash_cents,notes",
} as const;
export async function voiceRecordsRead(
  options: {
    url: string;
    key: string;
    jwt: string;
    access: AccountAccess;
    actor?: string;
    fetch?: typeof fetch;
  },
  input: unknown,
) {
  const query = RecordsQuery.parse(input),
    access = options.access;
  const permission =
    query.kind === "members" || query.kind === "membership_plans" || query.kind === "discounts"
      ? "manage_members"
      : query.kind === "cash_sessions"
        ? "use_cash"
        : "manage_products";
  if (access.status !== "active" || !access.clubId || !access.permissions.includes(permission))
    throw Error("VOICE_READ_FORBIDDEN");
  if (options.url !== "https://bnwanxbmprbymbutoths.supabase.co") throw Error("VOICE_READ_CONFIG");
  const table =
    query.kind === "categories"
      ? "product_categories"
      : query.kind === "stock"
        ? "products"
        : query.kind === "discounts"
          ? "member_discounts"
          : query.kind;
  const params = new URLSearchParams({
    select: projections[query.kind],
    club_id: "eq." + access.clubId,
    limit: "7",
    order: "id",
  });
  if (query.kind === "cash_sessions") {
    if (!z.string().uuid().safeParse(options.actor).success || query.query)
      throw Error("VOICE_READ_INVALID_QUERY");
    params.set("user_id", "eq." + options.actor);
    params.set("order", "opened_at.desc,id");
  }
  if (query.query && query.kind !== "members" && query.kind !== "cash_sessions")
    params.set("name", "ilike.%" + query.query.replace(/[\\%_]/g, "\\$&") + "%");
  const personal = query.kind === "members";
  const response = await (options.fetch ?? fetch)(
    options.url +
      (personal ? "/rest/v1/rpc/snoop_voice_find_members" : "/rest/v1/" + table + "?" + params),
    {
      method: personal ? "POST" : "GET",
      headers: {
        apikey: options.key,
        Authorization: "Bearer " + options.jwt,
        ...(personal ? { "Content-Type": "application/json" } : {}),
      },
      ...(personal
        ? { body: JSON.stringify({ p_query: query.query, p_club: access.clubId, p_limit: 7 }) }
        : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw Error("VOICE_READ_UNAVAILABLE");
  const row = z.object({ id: z.string().uuid() }).passthrough();
  const rows = z
    .array(row)
    .max(7)
    .parse(await response.json());
  // Return only the requested projection, even if a malformed upstream sends more data.
  const allowed = projections[query.kind].split(",");
  const projected = rows
    .slice(0, 6)
    .map((r) =>
      Object.fromEntries(allowed.filter((k) => Object.hasOwn(r, k)).map((k) => [k, r[k]])),
    );
  if (query.kind === "stock") {
    const ids = [
      ...new Set(
        projected
          .map((row) => row.category_id)
          .filter((id): id is string => z.string().uuid().safeParse(id).success),
      ),
    ];
    const units = new Map<string, string>();
    if (ids.length) {
      const unitsQuery = new URLSearchParams({
        select: "id,unit_type",
        club_id: "eq." + access.clubId,
        id: "in.(" + ids.join(",") + ")",
        limit: "7",
      });
      const r = await (options.fetch ?? fetch)(
        options.url + "/rest/v1/product_categories?" + unitsQuery,
        {
          headers: { apikey: options.key, Authorization: "Bearer " + options.jwt },
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!r.ok) throw Error("VOICE_READ_UNAVAILABLE");
      for (const entry of z
        .array(z.object({ id: z.string().uuid(), unit_type: z.enum(["gr", "unit"]) }).strict())
        .max(7)
        .parse(await r.json()))
        units.set(entry.id, entry.unit_type);
    }
    for (const row of projected) {
      if (
        !z
          .union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)])
          .safeParse(row.stock).success
      )
        throw Error("VOICE_READ_INVALID_STOCK");
      row.unit_type = units.get(String(row.category_id)) ?? null;
    }
  }
  return { kind: query.kind, truncated: rows.length > 6, rows: projected };
}
