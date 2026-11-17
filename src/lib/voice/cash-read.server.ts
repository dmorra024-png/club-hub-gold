import { createClient } from "@supabase/supabase-js";
import { loadCash } from "../cash-sessions.server.ts";
import { cashDaySummary } from "../cash-sessions.ts";
import { madridToday } from "../member-administration.ts";
/** Same report source and user JWT as the manual screen; only the aggregate leaves the server. */
export async function voiceCashToday(
  url: string,
  key: string,
  token: string,
  userId: string,
  clubId: string,
  fetcher?: typeof fetch,
) {
  if (url !== "https://bnwanxbmprbymbutoths.supabase.co") throw Error("AUTH_CONFIG");
  const deadline = AbortSignal.timeout(6000);
  const boundedFetch: typeof fetch = (input, init) =>
    (fetcher ?? fetch)(input, {
      ...init,
      redirect: "error",
      signal: init?.signal ? AbortSignal.any([deadline, init.signal]) : deadline,
    });
  const client = createClient(url, key, {
    global: {
      headers: { Authorization: "Bearer " + token },
      fetch: boundedFetch,
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const report = await loadCash(client, { userId, clubId }, madridToday());
  const summary = cashDaySummary(report.movements, report.sessions, report.start, report.end);
  if (!Number.isSafeInteger(summary.totalCents)) throw Error("CASH_UNAVAILABLE");
  return {
    day: report.day,
    cents: summary.totalCents,
    currency: "EUR",
    scope: report.admin ? "club" : "own",
  };
}
