import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import { loadCash } from "../cash-sessions.server.ts";
import { madridToday } from "../member-administration.ts";

/** Read-only, authenticated: identical Madrid-day session source to the Caja screen.
 * Only disclose operators for shifts the current role may already view. */
export async function voiceCashOpenersToday(
  options: {
    url: string;
    key: string;
    jwt: string;
    actor: string;
    access: AccountAccess;
    fetch?: typeof fetch;
  },
  now = new Date(),
) {
  const { access } = options;
  if (
    options.url !== "https://bnwanxbmprbymbutoths.supabase.co" ||
    !options.key ||
    !options.jwt ||
    !z.string().uuid().safeParse(options.actor).success ||
    access.status !== "active" ||
    !access.clubId ||
    !access.permissions.includes("use_cash")
  ) throw Error("VOICE_READ_FORBIDDEN");
  const client = createClient(options.url, options.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: "Bearer " + options.jwt },
      fetch: async (input, init) => {
        const response = await (options.fetch ?? fetch)(input, {
          ...init,
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        if (response.status >= 300 && response.status < 400)
          throw Error("VOICE_READ_REDIRECT");
        return response;
      },
    },
  });
  const day = madridToday(now);
  const report = await loadCash(
    client,
    { userId: options.actor, clubId: access.clubId },
    day,
  );
  if (!Array.isArray(report.sessions) || !Array.isArray(report.profiles))
    throw Error("VOICE_READ_UNAVAILABLE");
  const profiles = new Map(
    report.profiles
      .filter((p: any) => typeof p.id === "string" && typeof p.full_name === "string")
      .map((p: any) => [p.id, p.full_name.trim().slice(0, 100)]),
  );
  const opened = report.sessions
    .filter((s: any) =>
      typeof s.opened_at === "string" &&
      typeof s.user_id === "string" &&
      madridToday(new Date(s.opened_at)) === day &&
      (report.admin === true || s.user_id === options.actor),
    )
    .sort((a: any, b: any) => a.opened_at.localeCompare(b.opened_at))
    .slice(0, 20)
    .map((s: any) => ({
      operator: profiles.get(s.user_id) || "Operador sin nombre verificado",
      at: s.opened_at,
      state: s.status === "open" ? "open" : "closed",
    }));
  return {
    day,
    scope: report.admin === true ? "club" : "own",
    opened,
    truncated: report.sessions.length > 20,
    persisted: false,
  };
}
