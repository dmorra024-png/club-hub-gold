import { z } from "zod";
import type { ConversationMemoryValue, ConversationProposalValue } from "../snoop-conversation.ts";
const FieldKey = z.enum([
  "first_name",
  "last_name",
  "birth_date",
  "city",
  "phone",
  "name",
  "category",
]);
export const ActionReceipt = z
  .object({
    type: z.literal("AppActionResult"),
    id: z.string().min(1).max(120),
    status: z.enum(["opened", "prepared", "confirmation_required", "completed", "rejected"]),
    applied: z.array(FieldKey).max(12).default([]),
    skipped: z.array(FieldKey).max(12).default([]),
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

/** Remember applied drafts, never proposals that failed or values overridden manually. */
export function acknowledgedMemory(
  previous: ConversationMemoryValue,
  proposal: ConversationProposalValue,
  value: unknown,
): ConversationMemoryValue {
  const receipt = ActionReceipt.parse(value);
  if (receipt.status === "rejected") return previous;
  const next = structuredClone(previous);
  if (["member", "product", "category", "search"].includes(proposal.intent))
    next.operation = proposal.intent as ConversationMemoryValue["operation"];
  for (const field of receipt.applied) {
    if (Object.hasOwn(proposal.member, field))
      (next.member as Record<string, string>)[field] = (proposal.member as Record<string, string>)[
        field
      ];
    if (Object.hasOwn(proposal.product, field))
      (next.product as Record<string, string>)[field] = (
        proposal.product as Record<string, string>
      )[field];
  }
  for (const field of receipt.skipped) {
    delete (next.member as Record<string, string>)[field];
    delete (next.product as Record<string, string>)[field];
  }
  if (proposal.declined.includes("phone")) next.declined = ["phone"];
  else if (receipt.applied.includes("phone") && proposal.member.phone) next.declined = [];
  next.lastQuestion = proposal.question;
  return next;
}
