import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import { memberOrderHistory } from "../member-order-history.server.ts";
import { loadCash } from "../cash-sessions.server.ts";
import { sessionRevenue, reconcileCash } from "../cash-sessions.ts";
import { madridToday } from "../member-administration.ts";
export const VoiceInspection = z
  .object({
    kind: z.enum([
      "member_history",
      "cash_session",
      "stock_history",
      "stock_locations",
      "wallet_balance",
    ]),
    id: z.string().uuid(),
    page: z.number().int().min(0).max(100).default(0),
  })
  .strict();
export async function voiceInspect(
  options: {
    url: string;
    key: string;
    jwt: string;
    actor: string;
    access: AccountAccess;
    walletEnabled: boolean;
    fetch?: typeof fetch;
  },
  input: unknown,
) {
  const args = VoiceInspection.parse(input),
    a = options.access;
  if (
    options.url !== "https://bnwanxbmprbymbutoths.supabase.co" ||
    a.status !== "active" ||
    !a.clubId ||
    !z.string().uuid().safeParse(options.actor).success
  )
    throw Error("VOICE_READ_FORBIDDEN");
  const permission =
    args.kind === "stock_history" || args.kind === "stock_locations"
      ? "manage_products"
      : args.kind === "cash_session" || args.kind === "wallet_balance"
        ? "use_cash"
        : "manage_members";
  if (
    !a.permissions.includes(permission) ||
    (args.kind === "wallet_balance" &&
      (!options.walletEnabled || !a.permissions.includes("manage_members")))
  )
    throw Error("VOICE_READ_FORBIDDEN");
  const client = createClient(options.url, options.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: "Bearer " + options.jwt },
      fetch: async (input, init) => {
        const r = await (options.fetch ?? fetch)(input, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        if (r.status >= 300 && r.status < 400) throw Error("VOICE_READ_REDIRECT");
        return r;
      },
    },
  });
  if (args.kind === "member_history") {
    const result = await memberOrderHistory(
      client,
      { userId: options.actor, clubId: a.clubId },
      args.id,
      args.page,
    );
    return {
      kind: args.kind,
      summary: {
        count: result.orders.length,
        hasMore: result.hasMore,
        ownOnly: result.ownOnly,
        records: result.orders.map(
          (r: {
            reference: string;
            at: string;
            cents: number;
            status: string;
            cancelledAt: string | null;
          }) => ({
            reference: r.reference,
            at: r.at,
            cents: r.cents,
            status: r.status,
            cancelledAt: r.cancelledAt,
          }),
        ),
      },
      destination: { memberId: args.id, section: "history" },
    };
  }
  if (args.kind === "cash_session") {
    const { data: row, error } = await client
      .from("cash_sessions")
      .select("id,user_id,opened_at")
      .eq("club_id", a.clubId)
      .eq("id", args.id)
      .maybeSingle();
    if (error || !row || (a.role !== "admin" && row.user_id !== options.actor))
      throw Error("VOICE_READ_FORBIDDEN");
    const day = madridToday(new Date(row.opened_at));
    const report = await loadCash(client, { userId: options.actor, clubId: a.clubId }, day);
    const session = report.sessions.find((s) => s.id === args.id);
    if (!session) throw Error("VOICE_READ_UNAVAILABLE");
    return {
      kind: args.kind,
      summary: {
        openedAt: session.opened_at,
        closedAt: session.closed_at,
        status: session.status,
        recordedCents: sessionRevenue(session, report.movements),
        openingCents: session.opening_cash_cents,
        countedCents: session.closing_cash_cents,
        ...reconcileCash(session, report.movements),
      },
      destination: { day },
    };
  }
  if (args.kind === "wallet_balance") {
    const { data: member, error: memberError } = await client
      .from("members")
      .select("id")
      .eq("club_id", a.clubId)
      .eq("id", args.id)
      .maybeSingle();
    if (memberError || !member) throw Error("VOICE_READ_FORBIDDEN");
    const { data, error } = await client.rpc("socio_wallet_staff_member_state", {
      p_member_id: args.id,
    });
    const parsed = z
      .object({
        enabled: z.boolean(),
        clubEnabled: z.boolean(),
        balanceCents: z.number().int().nonnegative().safe().nullable(),
      })
      .strict()
      .safeParse(data);
    if (
      error ||
      !parsed.success ||
      (parsed.data.enabled && (parsed.data.balanceCents === null || !parsed.data.clubEnabled))
    )
      throw Error("VOICE_READ_UNAVAILABLE");
    return { kind: args.kind, summary: parsed.data };
  }
  const { data: product, error: productError } = await client
    .from("products")
    .select("id,stock,category_id")
    .eq("club_id", a.clubId)
    .eq("id", args.id)
    .maybeSingle();
  if (productError || !product) throw Error("VOICE_READ_FORBIDDEN");
  if (args.kind === "stock_locations") {
    const { data, error } = await client
      .from("snoop_stock_locations")
      .select("location,quantity")
      .eq("club_id", a.clubId)
      .eq("product_id", args.id)
      .order("location")
      .limit(3);
    const parsed = z
      .array(
        z
          .object({
            location: z.enum(["almacen", "dispensario"]),
            quantity: z.union([z.string(), z.number().finite().nonnegative()]),
          })
          .strict(),
      )
      .max(2)
      .safeParse(data);
    if (
      error ||
      !parsed.success ||
      new Set(parsed.data.map((row) => row.location)).size !== parsed.data.length
    )
      throw Error("VOICE_LOCATION_UNVERIFIED");
    const scale = (value: unknown) => {
      const text = String(value);
      if (!/^\d+(?:\.\d+)?$/.test(text)) throw Error("VOICE_LOCATION_UNVERIFIED");
      const [whole, raw = ""] = text.split(".");
      const fraction = raw.replace(/0+$/, "");
      if (fraction.length > 3) throw Error("VOICE_LOCATION_UNVERIFIED");
      return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    };
    // The installed owner schema initially creates only a dispensary row.
    // A missing location is zero ONLY when all nonnegative balances reconcile
    // exactly to products.stock; failed reads or mismatches never become zero.
    const amounts = {
      almacen: 0 as number | string,
      dispensario: 0 as number | string,
      ...Object.fromEntries(parsed.data.map((row) => [row.location, row.quantity])),
    };
    if (scale(amounts.almacen) + scale(amounts.dispensario) !== scale(product.stock))
      throw Error("VOICE_LOCATION_UNVERIFIED");
    const { data: category, error: categoryError } = await client
      .from("product_categories")
      .select("unit_type")
      .eq("club_id", a.clubId)
      .eq("id", product.category_id)
      .maybeSingle();
    if (categoryError || !category || !["gr", "unit"].includes(category.unit_type))
      throw Error("VOICE_LOCATION_UNVERIFIED");
    return {
      kind: args.kind,
      summary: {
        total: product.stock,
        almacen: amounts.almacen,
        dispensario: amounts.dispensario,
        unit_type: category.unit_type,
        measurement: "verified_location_balances",
        ...(parsed.data.length < 2
          ? {
              inferredZeroLocations: ["almacen", "dispensario"].filter(
                (location) => !parsed.data.some((row) => row.location === location),
              ),
            }
          : {}),
      },
    };
  }
  const { data, error } = await client
    .from("stock_movements")
    .select("id,delta,reason,created_at")
    .eq("club_id", a.clubId)
    .eq("product_id", args.id)
    .order("created_at", { ascending: false })
    .order("id")
    .range(args.page * 20, args.page * 20 + 20);
  if (error || !Array.isArray(data)) throw Error("VOICE_READ_UNAVAILABLE");
  return {
    kind: args.kind,
    summary: {
      hasMore: data.length > 20,
      records: data.slice(0, 20).map((r) => ({
        delta: r.delta,
        reason: [
          "initial_stock",
          "administrative_adjustment",
          "administrative_edit",
          "order",
          "order_cancelled",
        ].includes(r.reason)
          ? r.reason
          : "other",
        at: r.created_at,
      })),
    },
  };
}
