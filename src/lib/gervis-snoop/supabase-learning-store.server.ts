import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import type { GervisLearningStore, GervisLearningRecord, GervisLearningEntryValue } from "./learning.ts";

const Stored = z.object({
  club_id: z.string().uuid(),
  kind: z.enum(["pronunciation", "workflow_preference"]),
  phrase: z.string().min(2).max(90),
  meaning: z.string().min(2).max(160),
  approved_by: z.string().uuid(),
  approved_at: z.string(),
}).strict();

/**
 * Server-only adapter for a future gervis_learning RLS table.
 * Does not create tables or access a service-role key. Existing signed-in user
 * JWT and Postgres RLS are both required. Do not mount before the schema and
 * its per-club SELECT/INSERT/UPDATE/DELETE policies are verified.
 */
export function createGervisSupabaseLearningStore(options: {
  url: string;
  publishableKey: string;
  jwt: string;
  access: AccountAccess;
  authenticatedUserId: string;
  fetch?: typeof fetch;
}): GervisLearningStore {
  const { url, publishableKey, jwt, access, authenticatedUserId } = options;
  // Explicit project and club guard: no cross-club query can leave the Worker.
  if (url !== "https://bnwanxbmprbymbutoths.supabase.co" ||
      !z.string().uuid().safeParse(access.clubId).success ||
      !z.string().uuid().safeParse(authenticatedUserId).success ||
      access.status !== "active" || !publishableKey.startsWith("sb_publishable_") ||
      jwt.split(".").length !== 3)
    throw Error("GERVIS_LEARNING_AUTH_REQUIRED");
  const club = access.clubId!;
  const canWrite = access.role === "admin";
  const request = async (path: string, method: "GET"|"POST"|"DELETE", body?: unknown) => {
    const response = await (options.fetch ?? fetch)(url + "/rest/v1/gervis_learning" + path, {
      method,
      headers: {
        apikey: publishableKey,
        Authorization: "Bearer " + jwt,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method === "POST" ? { Prefer: "resolution=merge-duplicates,return=minimal" } : {}),
      },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}),
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok || response.status >= 300) throw Error("GERVIS_LEARNING_UNAVAILABLE");
    return response;
  };
  const requireOwnClub = (requested: string) => {
    if (requested !== club) throw Error("GERVIS_LEARNING_SCOPE");
  };
  return {
    async list(clubId) {
      requireOwnClub(clubId);
      const query = "?select=club_id,kind,phrase,meaning,approved_by,approved_at&club_id=eq." +
        encodeURIComponent(clubId) + "&order=approved_at.desc&limit=50";
      const result = await (await request(query, "GET")).json();
      const parsed = z.array(Stored).max(50).parse(result);
      if (parsed.some(item => item.club_id !== clubId)) throw Error("GERVIS_LEARNING_SCOPE");
      return parsed.map(item => ({
        clubId:item.club_id, kind:item.kind, phrase:item.phrase,
        meaning:item.meaning, approvedBy:item.approved_by, approvedAt:item.approved_at,
      }));
    },
    async upsert(item: GervisLearningRecord) {
      requireOwnClub(item.clubId);
      if (!canWrite || item.approvedBy !== authenticatedUserId)
        throw Error("GERVIS_LEARNING_AUTH_REQUIRED");
      const parsed = Stored.parse({
        club_id:item.clubId, kind:item.kind, phrase:item.phrase,
        meaning:item.meaning, approved_by:item.approvedBy, approved_at:item.approvedAt,
      });
      await request("?on_conflict=club_id,kind,phrase", "POST", parsed);
    },
    async remove(clubId: string, kind: GervisLearningEntryValue["kind"], phrase: string) {
      requireOwnClub(clubId);
      if (!canWrite) throw Error("GERVIS_LEARNING_AUTH_REQUIRED");
      if (phrase.length < 2 || phrase.length > 90) throw Error("GERVIS_LEARNING_INVALID");
      await request("?club_id=eq." + encodeURIComponent(clubId) +
        "&kind=eq." + encodeURIComponent(kind) +
        "&phrase=eq." + encodeURIComponent(phrase), "DELETE");
    },
  };
}
