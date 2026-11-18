import { createClient } from "@supabase/supabase-js";
import { loadCash } from "../cash-sessions.server.ts";
import { cashDaySummary } from "../cash-sessions.ts";
import { calendarDate, madridToday } from "../member-administration.ts";
import { z } from "zod";
export const VoiceCashDay = z
  .object({
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => calendarDate(value) === value),
  })
  .strict();
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
  const client = createClient(url, key, {
    global: {
      headers: { Authorization: "Bearer " + token },
      fetch: boundedFetch,
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
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
