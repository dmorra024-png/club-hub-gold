import { createClient } from "@supabase/supabase-js";
import { loadCash } from "../cash-sessions.server.ts";
import { cashDaySummary } from "../cash-sessions.ts";
import { calendarDate, madridToday } from "../member-administration.ts";
import { z } from "zod";
import { readWalletCashEvidence } from "../cash-wallet-evidence.server.ts";
import { readCashLedger } from "../cash-ledger.ts";
import { cashMovements } from "../cash-sessions.ts";
import { clubDayRange } from "../cash-summary.ts";
import type { AccountAccess } from "../access-context.ts";
export const VoiceCashDay = z
  .object({
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => calendarDate(value) === value),
  })
  .strict();
export const VoiceCashPeriod = z
  .object({ from: VoiceCashDay.shape.day, to: VoiceCashDay.shape.day })
  .strict()
  .refine(
    (v) =>
      v.from <= v.to &&
      (Date.parse(v.to + "T00:00:00Z") - Date.parse(v.from + "T00:00:00Z")) / 86400000 < 366,
    "Invalid or oversized period",
  );
/** Same report source and user JWT as the manual screen; only the aggregate leaves the server. */
export async function voiceCashToday(
  url: string,
  key: string,
  token: string,
  userId: string,
  clubId: string,
  fetcher?: typeof fetch,
) {
  return voiceCashDay(url, key, token, userId, clubId, madridToday(), fetcher);
}
export async function voiceCashDay(
  url: string,
  key: string,
  token: string,
  userId: string,
  clubId: string,
  day: string,
  fetcher?: typeof fetch,
) {
  VoiceCashDay.parse({ day });
  const client = voiceCashClient(url, key, token, fetcher);
  const report = await loadCash(client, { userId, clubId }, day);
  const summary = cashDaySummary(report.movements, report.sessions, report.start, report.end);
  if (!Number.isSafeInteger(summary.totalCents)) throw Error("CASH_UNAVAILABLE");
  return {
    day: report.day,
    cents: summary.totalCents,
    currency: "EUR",
    scope: report.admin ? "club" : "own",
  };
}
function voiceCashClient(url: string, key: string, token: string, fetcher?: typeof fetch) {
  if (url !== "https://bnwanxbmprbymbutoths.supabase.co") throw Error("AUTH_CONFIG");
  const deadline = AbortSignal.timeout(6000);
  const boundedFetch: typeof fetch = async (input, init) => {
    const response = await (fetcher ?? fetch)(input, {
      ...init,
      // Workerd rejects redirect:"error" before sending the request. Manual mode
      // plus an explicit rejection retains the no-credential-forwarding boundary.
      redirect: "manual",
      signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
    });
    if (response.status >= 300 && response.status < 400) throw Error("CASH_REDIRECT_REJECTED");
    return response;
  };
  return createClient(url, key, {
    global: {
      headers: { Authorization: "Bearer " + token },
      fetch: boundedFetch,
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
/** Same ledger reader and exact calculations as the manual report; openings never receipts. */
export async function voiceCashPeriod(
  url: string,
  key: string,
  token: string,
  userId: string,
  access: AccountAccess,
  args: unknown,
  fetcher?: typeof fetch,
) {
  const period = VoiceCashPeriod.parse(args);
  if (
    access.status !== "active" ||
    !access.clubId ||
    !access.permissions.includes("use_cash") ||
    !access.permissions.includes("view_reports")
  )
    throw Error("AUTH_FORBIDDEN");
  const client = voiceCashClient(url, key, token, fetcher);
  const { data: admin, error } = await client.rpc("is_current_user_club_admin", {
    _club_id: access.clubId,
  });
  if (error || typeof admin !== "boolean") throw Error("CASH_UNAVAILABLE");
  const start = clubDayRange(period.from).start,
    end = clubDayRange(period.to).end;
  const { orders, fees } = await readCashLedger(
    client,
    { userId, clubId: access.clubId, admin },
    start,
    end,
    true,
  );
  // Keep parity with the released manual report: topups are cash receipts;
  // wallet-funded orders must not count those same funds a second time.
  const evidence = await readWalletCashEvidence(client, start, end);
  const scopedTopups = admin
    ? evidence.topups
    : evidence.topups.filter((row) => row.actorId === userId);
  const verifiedOrders = orders.map((order: any) => ({
    ...order,
    payment_method: evidence.walletOrderIds.has(order.id) ? "wallet" : (order.payment_method ?? null),
  }));
  const summary = cashDaySummary(
    cashMovements(verifiedOrders, fees, [], scopedTopups),
    [],
    start,
    end,
  );
  return {
    ...period,
    cents: summary.totalCents,
    orderCents: summary.orderCents,
    feeCents: summary.feeCents,
    currency: "EUR",
    scope: admin ? "club" : "own",
    measurement: "recorded_receipts",
    persisted: false,
  };
}
