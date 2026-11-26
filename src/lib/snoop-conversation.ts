import { z } from "zod";
import { calendarDate, isAdult } from "./member-administration.ts";
import { accessRedirect, type AccountAccess } from "./access-context.ts";
import { voiceDestinations, voiceDestinationNames } from "./voice/destinations.ts";
import {
  AdministrativeDraft,
  administrativeDraftAllowed,
  administrativeFormTargets,
} from "./voice/administrative-forms.ts";
export const ConversationMode = z.enum(["pilot", "real", "demo"]);
export const ConversationTarget = z.enum(voiceDestinationNames);
export const memberFields = z
  .object({
    first_name: z.string().max(80).optional(),
    last_name: z.string().max(120).optional(),
    birth_date: z.string().max(10).optional(),
    city: z.string().max(120).optional(),
    address: z.string().trim().max(240).optional(),
    postal_code: z
      .string()
      .trim()
      .regex(/^[\p{L}\p{N} -]{1,20}$/u)
      .optional(),
    plan_name: z.string().trim().min(1).max(120).optional(),
    phone: z.string().max(24).optional(),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict();
// Informational fields only. No pricing, stock mutation, payment or fulfillment tools.
export const productFields = z
  .object({
    name: z.string().max(120).optional(),
    category: z.string().max(100).optional(),
  })
  .strict();
export const cashDraftFields = z
  .object({
    opening_cash: z
      .string()
      .regex(/^\d{1,8}(?:[.,]\d{1,2})?$/)
      .optional(),
    closing_cash: z
      .string()
      .regex(/^\d{1,8}(?:[.,]\d{1,2})?$/)
      .optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();
export const ConversationMemory = z
  .object({
    operation: z.enum(["none", "member", "product", "category", "search"]).default("none"),
    member: memberFields.default({}),
    product: productFields.default({}),
    declined: z.array(z.literal("phone")).max(1).default([]),
    lastQuestion: z.string().max(180).default(""),
  })
  .strict();
export type ConversationMemoryValue = z.infer<typeof ConversationMemory>;
export const emptyConversation = (): ConversationMemoryValue => ({
  operation: "none",
  member: {},
  product: {},
  declined: [],
  lastQuestion: "",
});
export const ConversationRequest = z
  .object({
    mode: ConversationMode,
    owner: z
      .object({ userId: z.string().min(1).max(80), clubId: z.string().min(1).max(80) })
      .strict(),
    consent: z.literal(true),
    synthetic: z.boolean(),
    text: z.string().trim().min(1).max(1200),
    screen: ConversationTarget,
    context: ConversationMemory,
  })
  .strict();
export const ConversationProposal = z
  .object({
    intent: z.enum([
      "navigate",
      "member",
      "member_edit",
      "member_section",
      "cash_draft",
      "administrative_draft",
      "product",
      "category",
      "search",
      "clarify",
      "review",
      "stop",
    ]),
    target: ConversationTarget.nullable(),
    member: memberFields,
    product: productFields,
    query: z.string().max(120).nullable(),
    cash: cashDraftFields.optional(),
    form: AdministrativeDraft.optional(),
    declined: z.array(z.literal("phone")).max(1),
    question: z.string().max(180),
    asking: z.enum(["first_name", "last_name", "birth_date", "city", "phone", "other"]).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Missing model values must never erase an existing draft. Clearing phone
    // requires the explicit declined-field action; other clears stay manual.
    for (const [key, value] of Object.entries(v.member))
      if (!value.trim() && !(key === "phone" && v.declined.includes("phone")))
        ctx.addIssue({ code: "custom", message: "Empty member patch" });
    for (const value of Object.values(v.product))
      if (!value.trim()) ctx.addIssue({ code: "custom", message: "Empty product patch" });

    if (
      (v.form && v.intent !== "administrative_draft") ||
      (v.intent === "administrative_draft" &&
        (!v.form || v.target !== administrativeFormTargets[v.form.kind]))
    )
      ctx.addIssue({ code: "custom", message: "Invalid administrative draft target" });
    if (Object.keys(v.cash ?? {}).length && v.intent !== "cash_draft")
      ctx.addIssue({ code: "custom", message: "Wrong cash draft intent" });
    if (
      v.intent === "cash_draft" &&
      (v.target !== "cash" ||
        !Object.keys(v.cash ?? {}).length ||
        (v.cash?.opening_cash !== undefined &&
          (v.cash?.closing_cash !== undefined || v.cash?.notes !== undefined)))
    )
      ctx.addIssue({ code: "custom", message: "Invalid cash draft" });
    if (v.intent === "navigate" && v.target === null)
      ctx.addIssue({ code: "custom", message: "Missing destination" });
    if (v.intent === "category" && Object.keys(v.product).some((k) => k !== "name"))
      ctx.addIssue({ code: "custom", message: "Unsupported category patch" });

    if (Object.keys(v.member).length && !["member", "member_edit"].includes(v.intent))
      ctx.addIssue({ code: "custom", message: "Wrong member intent" });
    if (Object.keys(v.product).length && !["product", "category"].includes(v.intent))
      ctx.addIssue({ code: "custom", message: "Wrong product intent" });
    if (v.intent === "member" && v.target !== "member_create")
      ctx.addIssue({ code: "custom", message: "Wrong member target" });
    if (
      v.intent === "member_edit" &&
      ["address", "postal_code", "plan_name"].some((key) => Object.hasOwn(v.member, key))
    )
      ctx.addIssue({
        code: "custom",
        message: "Creation-only fields require the existing registration form",
      });
    if (v.intent === "member_edit" && v.target !== null)
      ctx.addIssue({ code: "custom", message: "Edit only the currently selected member" });
    if (v.intent === "product" && v.target !== "product_create")
      ctx.addIssue({ code: "custom", message: "Wrong product target" });
    if (v.intent === "category" && v.target !== "categories")
      ctx.addIssue({ code: "custom", message: "Wrong category target" });
    if (v.intent === "search" && !["members", "products"].includes(v.target ?? ""))
      ctx.addIssue({ code: "custom", message: "Wrong search target" });
    if (
      v.intent === "member_section" &&
      (v.target !== null || !["qr", "history", "discounts", "renewal"].includes(v.query ?? ""))
    )
      ctx.addIssue({ code: "custom", message: "Unknown selected-member section" });
    if (v.query !== null && !["search", "member_section"].includes(v.intent))
      ctx.addIssue({ code: "custom", message: "Wrong query intent" });
    if (["stop", "clarify", "review"].includes(v.intent) && v.target !== null)
      ctx.addIssue({ code: "custom", message: "Unexpected destination" });
    if (
      v.member.birth_date &&
      (!calendarDate(v.member.birth_date) || !isAdult(v.member.birth_date))
    )
      ctx.addIssue({ code: "custom", message: "Invalid birth date" });
    if (v.member.phone && !/^\+?[\d\s()-]{6,24}$/.test(v.member.phone))
      ctx.addIssue({ code: "custom", message: "Invalid phone" });
  });
export type ConversationProposalValue = z.infer<typeof ConversationProposal>;
export const targetPath: Record<z.infer<typeof ConversationTarget>, string> = voiceDestinations;
export function conversationAllowed(access: AccountAccess, p: ConversationProposalValue) {
  return (
    access.status === "active" &&
    !!access.clubId &&
    (p.intent !== "administrative_draft" ||
      (!!p.form && administrativeDraftAllowed(access, p.form))) &&
    (!["member_edit", "member_section"].includes(p.intent) ||
      access.permissions.includes("manage_members")) &&
    (p.intent !== "member_section" ||
      p.query !== "history" ||
      access.permissions.some(
        (permission) => permission === "use_cash" || permission === "view_reports",
      )) &&
    (p.target !== "cash_report" || access.permissions.includes("view_reports")) &&
    (p.target === null || accessRedirect(access, targetPath[p.target]) === null)
  );
}
export function reduceConversation(
  previous: ConversationMemoryValue,
  p: ConversationProposalValue,
): ConversationMemoryValue {
  if (p.intent === "stop") return emptyConversation();
  const operation = ["member", "member_edit"].includes(p.intent)
    ? "member"
    : p.intent === "product"
      ? "product"
      : p.intent === "category"
        ? "category"
        : p.intent === "search"
          ? "search"
          : previous.operation;
  const base = previous;
  return {
    operation,
    member: { ...base.member, ...p.member },
    product: { ...base.product, ...p.product },
    declined: p.member.phone ? [] : [...new Set([...base.declined, ...p.declined])],
    lastQuestion: p.question,
  };
}
export function screenTarget(path: string): z.infer<typeof ConversationTarget> {
  return path === "/soci/nuovo"
    ? "member_create"
    : path.startsWith("/soci")
      ? "members"
      : path === "/productos"
        ? "products"
        : path === "/caja"
          ? "cash"
          : path === "/actividades"
            ? "activity"
            : path === "/ajustes/informes"
              ? "reports"
              : "home";
}
