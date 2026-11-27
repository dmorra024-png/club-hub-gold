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
      "suppliers",
      "expenses",
      "purchases",
      "wallet_topups",
      "collaborators",
    ]),
    query: z
      .string()
      .trim()
      .min(0)
      .max(100)
      .regex(/^[\p{L}\p{N} .&'’%_\/#-]*$/u),
  })
  .strict();
/** Keep personal names inside the authenticated club RPC, never in the
 * agent's catalog keyterms. Remove only voice-command prefixes, and offer
 * candidates for human selection rather than guessing a member identity. */
export function spokenMemberQuery(input: string) {
  // Voice commands are optional: do not strip a real surname like "De Luca".
  // Only strip grammatical prefixes once an explicit search/open intent exists.
  let value = input.trim().replace(/^[¿¡\s]+|[?.!\s]+$/g, "");
  value = value.replace(/^(?:(?:por favor|per favore)\s*,?\s*)/iu, "");
  const intent = /^(?:(?:puedes|potresti|puoi)\s+)?(?:(?:quiero|necesito|vorrei|voglio)\s+(?:que\s+)?)?(?:abre|abrir|apri|apre|busca|buscar|búscame|cerca|trova|encuentra|encontrar|mostrar|mostra|muéstrame|ver|vedere|cercare|trovare)\s+/iu;
  const started = intent.test(value);
  if (!started) return value;
  value = value.replace(intent, "");
  value = value.replace(/^(?:(?:la|el|lo|una|un)\s+)?(?:(?:ficha|scheda|perfil|profile|datos|dati)\s+)?(?:(?:del|de|della|di|al)\s+)?(?:socio|socia|soci|miembro|member)\s+(?:(?:de\s+nombre|di\s+nome)\s+)?/iu, "");
  value = value.replace(/^(?:(?:la|el)\s+)?(?:ficha|scheda|perfil|profile)\s+(?:del|de|di)\s+/iu, "");
  value = value.replace(/^(?:que\s+se\s+llama|che\s+si\s+chiama|llamado|llamada|de\s+nombre|di\s+nome|nombre)\s+/iu, "");
  return value.trim();
}

function memberFallbackQuery(input: string) {
  // A deliberately broad candidate lookup. The server still enforces the
  // same actor and club permissions and the model receives opaque refs only.
  const words = input.split(/\s+/).filter((x) => x.length >= 4);
  return words.length > 1 ? words.sort((a, b) => b.length - a.length)[0] : null;
}
const projections = {
  members: "id,first_name,last_name,city,expires_at",
  products: "id,name,description,category_id",
  categories: "id,name,archived",
  stock: "id,name,stock,category_id",
  membership_plans: "id,name,price_cents,duration_days,active",
  discounts: "id,name,percentage_basis_points,active,valid_from,valid_until",
  suppliers: "id,name",
  expenses: "id,description,amount_cents,payment_method,occurred_on,cancelled_at",
  purchases: "id,reference,description,amount_cents,status",
  wallet_topups: "id,description,amount_cents,payment_method,created_at,voided",
  collaborators: "id,name",
  cash_sessions: "id,status,opened_at,closed_at,opening_cash_cents,closing_cash_cents,notes",
} as const;
export async function voiceRecordsRead(
  options: {
    url: string;
    key: string;
    jwt: string;
    access: AccountAccess;
    actor?: string;
    walletEnabled?: boolean;
    fetch?: typeof fetch;
  },
  input: unknown,
) {
  const query = RecordsQuery.parse(input),
    access = options.access;
  const finance = ["suppliers", "expenses", "purchases"].includes(query.kind);
  const collaborators = query.kind === "collaborators";
  const permission =
    query.kind === "members" || query.kind === "membership_plans" || query.kind === "discounts"
      ? "manage_members"
      : query.kind === "cash_sessions"
        ? "use_cash"
        : "manage_products";
  if (
    access.status !== "active" ||
    !access.clubId ||
    (!finance && !collaborators && !access.permissions.includes(permission)) ||
    ((finance || collaborators) && access.role !== "admin")
  )
    throw Error("VOICE_READ_FORBIDDEN");
  if (options.url !== "https://bnwanxbmprbymbutoths.supabase.co") throw Error("VOICE_READ_CONFIG");
  if (query.kind === "wallet_topups") {
    if (
      !options.walletEnabled ||
      query.query ||
      !access.permissions.includes("use_cash") ||
      !access.permissions.includes("manage_members")
    )
      throw Error("VOICE_READ_FORBIDDEN");
    const end = new Date(),
      start = new Date(end.getTime() - 365 * 86400000);
    const response = await (options.fetch ?? fetch)(
      options.url + "/rest/v1/rpc/socio_wallet_cash_evidence",
      {
        method: "POST",
        headers: {
          apikey: options.key,
          Authorization: "Bearer " + options.jwt,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_start: start.toISOString(), p_end: end.toISOString() }),
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw Error("VOICE_READ_UNAVAILABLE");
    const data = z
      .object({
        topups: z
          .array(
            z.object({
              id: z.string().uuid(),
              kind: z.enum(["topup", "topup_reversal"]),
              amountCents: z.number().int().safe(),
              paymentMethod: z.enum(["cash", "card", "transfer"]),
              at: z.string().datetime(),
              voided: z.boolean(),
            }),
          )
          .max(10000),
      })
      .parse(await response.json());
    const rows = data.topups
      .filter((r) => r.kind === "topup")
      .sort((a, b) => b.at.localeCompare(a.at));
    return {
      kind: query.kind,
      truncated: rows.length > 6,
      rows: rows.slice(0, 6).map((r) => ({
        id: r.id,
        description: r.voided ? "Recarga ANULADA" : "Recarga",
        amount_cents: r.amountCents,
        payment_method: r.paymentMethod,
        created_at: r.at,
        voided: r.voided,
      })),
    };
  }
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
  const personal = query.kind === "members" || finance || collaborators;
  const memberText = query.kind === "members" ? spokenMemberQuery(query.query) : query.query;
  const response = await (options.fetch ?? fetch)(
    options.url +
      (personal
        ? collaborators
          ? "/rest/v1/rpc/snoop_voice_collaborators"
          : finance
            ? "/rest/v1/rpc/snoop_voice_finance_search"
            : "/rest/v1/rpc/snoop_voice_find_members"
        : "/rest/v1/" + table + "?" + params),
    {
      method: personal ? "POST" : "GET",
      headers: {
        apikey: options.key,
        Authorization: "Bearer " + options.jwt,
        ...(personal ? { "Content-Type": "application/json" } : {}),
      },
      ...(personal
        ? {
            body: JSON.stringify({
              p_query: memberText,
              p_club: access.clubId,
              p_limit: 7,
              ...(finance ? { p_kind: query.kind } : {}),
            }),
          }
        : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw Error("VOICE_READ_UNAVAILABLE");
  const row = z.object({ id: z.string().uuid() }).passthrough();
  let rows = z.array(row).max(7).parse(await response.json());
  if (query.kind === "members" && rows.length === 0) {
    const fallback = memberFallbackQuery(memberText);
    if (fallback) {
      const retry = await (options.fetch ?? fetch)(
        options.url + "/rest/v1/rpc/snoop_voice_find_members",
        {
          method: "POST",
          headers: {
            apikey: options.key,
            Authorization: "Bearer " + options.jwt,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ p_query: fallback, p_club: access.clubId, p_limit: 7 }),
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!retry.ok) throw Error("VOICE_READ_UNAVAILABLE");
      rows = z.array(row).max(7).parse(await retry.json());
      // The result is only a list of possible identities for human selection.
      // No automatic member update, checkout or registration may use this match.
    }
  }
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
      row.stock_scope = "total";
      row.unit_type = units.get(String(row.category_id)) ?? null;
    }
  }
  return { kind: query.kind, truncated: rows.length > 6, rows: projected };
}
