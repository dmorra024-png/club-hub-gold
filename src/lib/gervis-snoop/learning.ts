import { z } from "zod";

/**
 * Approved coworker learning contract, NOT model self-training.
 * Storage is provided by the caller, never global; only the authenticated
 * club can write/read its own entries. This module has NO database side effect.
 */
export const GervisLearningEntry = z.object({
  kind: z.enum(["pronunciation", "workflow_preference"]),
  phrase: z.string().trim().min(2).max(90),
  meaning: z.string().trim().min(2).max(160),
}).strict();
export type GervisLearningEntryValue = z.infer<typeof GervisLearningEntry>;
export type GervisLearningRecord = GervisLearningEntryValue & {
  clubId: string;
  approvedBy: string;
  approvedAt: string;
};

/** The actual authorization and persistence layer must enforce club RLS. */
export interface GervisLearningStore {
  list(clubId: string): Promise<GervisLearningRecord[]>;
  upsert(item: GervisLearningRecord): Promise<void>;
  remove(clubId: string, kind: GervisLearningEntryValue["kind"], phrase: string): Promise<void>;
}

const privateData = /(?:@|\b(?:dni|nie|passport|pasaporte|password|contrase[nñ]a|telefono|tel[eé]fono|documento|cuenta bancaria|iban|birth_date|fecha de nacimiento|firma)\b)/i;
const identityNumber = /\b\d{7,}\b/;

/** Only an authenticated user who explicitly approved the correction can
 * submit it. Never memorize arbitrary utterances or member identity data.
 */
export async function approveGervisLearning(
  store: GervisLearningStore,
  context: { clubId: string; userId: string; confirmed: boolean; canManage: boolean; at: string },
  input: unknown,
) {
  if (!context.clubId || !context.userId || !context.confirmed || !context.canManage)
    return { ok: false as const, reason: "approval_required" as const };
  const entry = GervisLearningEntry.safeParse(input);
  if (!entry.success) return { ok: false as const, reason: "invalid" as const };
  if (privateData.test(entry.data.phrase) || privateData.test(entry.data.meaning) ||
      identityNumber.test(entry.data.phrase) || identityNumber.test(entry.data.meaning))
    return { ok: false as const, reason: "private_data" as const };
  const time = z.string().datetime().safeParse(context.at);
  if (!time.success) return { ok: false as const, reason: "invalid" as const };
  await store.upsert({ ...entry.data, clubId: context.clubId, approvedBy: context.userId, approvedAt: time.data });
  return { ok: true as const };
}

export async function forgetGervisLearning(
  store: GervisLearningStore,
  context: { clubId: string; canManage: boolean; confirmed: boolean },
  entry: GervisLearningEntryValue,
) {
  if (!context.clubId || !context.canManage || !context.confirmed)
    return { ok: false as const, reason: "approval_required" as const };
  const verified = GervisLearningEntry.safeParse(entry);
  if (!verified.success) return { ok: false as const, reason: "invalid" as const };
  await store.remove(context.clubId, verified.data.kind, verified.data.phrase);
  return { ok: true as const };
}
