import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import { memberOrderHistory } from "../member-order-history.server.ts";
import { loadCash } from "../cash-sessions.server.ts";
import { sessionRevenue, reconcileCash } from "../cash-sessions.ts";
import { madridToday } from "../member-administration.ts";
export const VoiceInspection = z
  .object({
    kind: z.enum(["member_history", "cash_session", "stock_history", "wallet_balance"]),
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
    args.kind === "stock_history"
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
    .select("id")
    .eq("club_id", a.clubId)
    .eq("id", args.id)
    .maybeSingle();
  if (productError || !product) throw Error("VOICE_READ_FORBIDDEN");
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
      records: data
        .slice(0, 20)
        .map((r) => ({
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
