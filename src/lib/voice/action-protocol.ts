import { z } from "zod";
import type { ConversationMemoryValue, ConversationProposalValue } from "../snoop-conversation.ts";
const FieldKey = z.enum([
  "first_name",
  "last_name",
  "birth_date",
  "city",
  "address",
  "postal_code",
  "plan_name",
  "phone",
  "name",
  "category",
  // Product draft fields must match the validated SNOOP product form:
  // otherwise valid browser confirmations close the entire voice session
  // with INVALID_SEQUENCE after a single quantity/price/destination command.
  "stock",
  "buy_price",
  "sell_price",
  "destination",
  "strain",
  "opening_cash",
  "closing_cash",
  "notes",
  "email",
  "dni_number",
  "duration_days",
  "price",
  "percentage",
  "valid_from",
  "valid_until",
  "discount_name",
  "amount",
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
        "FORM_NOT_APPLIED",
        "REFERENCE_NOT_FOUND",
        "AMBIGUOUS_REFERENCE",
        "FIELD_DISABLED",
        "EMAIL_CORRECTION_UNCLEAR",
        "SURNAME_SPELLING_UNCLEAR",
        "MEMBER_NOT_FOUND",
        "MEMBER_AMBIGUOUS",
        "MEMBER_SEARCH_UNAVAILABLE",
        "STOCK_DRAFT_UNAVAILABLE",
        "PERMISSION_DENIED",
        "CONFIRMATION_REQUIRED",
      ])
      .default("OK"),
  })
  .strict();
export const actionDefinitions = Object.freeze({
  navigate: { effect: "navigation", confirmation: false },
  member: { effect: "draft", confirmation: false },
  member_edit: { effect: "draft", confirmation: true },
  member_section: { effect: "navigation", confirmation: false },
  cash_draft: { effect: "draft", confirmation: true },
  administrative_draft: { effect: "draft", confirmation: true },
  product: { effect: "informational-draft", confirmation: false },
  stock_draft: { effect: "informational-draft", confirmation: true },
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
    requiresConfirmation: ["prepared", "confirmation_required"].includes(receipt.status),
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
  if (proposal.intent === "member_edit") next.operation = "member";
  else if (["member", "product", "category", "search"].includes(proposal.intent))
    next.operation = proposal.intent as ConversationMemoryValue["operation"];
  for (const field of receipt.applied) {
    // DNI/NIE is an identity identifier: never copy its raw value into the
    // resumable voice memory or server checkpoint. It lives in the form only.
    if (field !== "dni_number" && Object.hasOwn(proposal.member, field))
      (next.member as Record<string, string>)[field] = (proposal.member as Record<string, string>)[
        field
      ];
    if (Object.hasOwn(proposal.product, field))
      (next.product as Record<string, string>)[field] = (
        proposal.product as Record<string, string>
      )[field];
  }
  delete (next.member as Record<string,string>).dni_number;
  // A spelled surname is assembled in the authenticated browser and is not
  // transmitted back to the model. Once acknowledged, discard the previous
  // misheard value so the next voice turn cannot reuse it as the real surname.
  if (proposal.surname_spelling && receipt.applied.includes("last_name"))
    delete (next.member as Record<string,string>).last_name;
  for (const field of receipt.skipped) {
    delete (next.member as Record<string, string>)[field];
    delete (next.product as Record<string, string>)[field];
  }
  if (proposal.declined.includes("phone")) next.declined = ["phone"];
  else if (receipt.applied.includes("phone") && proposal.member.phone) next.declined = [];
  next.lastQuestion = proposal.question;
  return next;
}
