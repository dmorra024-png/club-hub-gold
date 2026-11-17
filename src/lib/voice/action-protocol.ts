import { z } from "zod";
export const ActionReceipt = z
  .object({
    type: z.literal("AppActionResult"),
    id: z.string().min(1).max(120),
    status: z.enum(["opened", "prepared", "confirmation_required", "completed", "rejected"]),
    applied: z.array(z.string().max(40)).max(12).default([]),
    skipped: z.array(z.string().max(40)).max(12).default([]),
    code: z
      .enum([
        "OK",
        "MANUAL_EDIT_PRESERVED",
        "STALE",
        "FORM_UNAVAILABLE",
        "PERMISSION_DENIED",
        "CONFIRMATION_REQUIRED",
      ])
      .default("OK"),
  })
  .strict();
export const actionDefinitions = Object.freeze({
  navigate: { effect: "navigation", confirmation: false },
  member: { effect: "draft", confirmation: false },
  product: { effect: "informational-draft", confirmation: false },
  category: { effect: "draft", confirmation: false },
  search: { effect: "read", confirmation: false },
  review: { effect: "review", confirmation: true },
  clarify: { effect: "none", confirmation: false },
  stop: { effect: "stop", confirmation: false },
});
/** Provider receives only bounded outcome metadata, never DOM/form/database contents. */
export function actionOutcome(value: unknown) {
  const receipt = ActionReceipt.parse(value);
  return {
    ok: receipt.status !== "rejected",
    status: receipt.status,
    applied: receipt.applied,
    skipped: receipt.skipped,
    code: receipt.code,
    persisted: receipt.status === "completed",
    requiresConfirmation: receipt.status !== "completed",
  };
}
