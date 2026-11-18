import { z } from "zod";
import type { AccountAccess } from "../access-context.ts";
import { calendarDate } from "../member-administration.ts";
const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[\u0000-\u001f<>]/.test(value));
const money = z.string().regex(/^\d{1,6}(?:[.,]\d{1,2})?$/);
const date = z.string().refine((value) => value === "" || calendarDate(value) === value);
export const administrativeFormSchemas = {
  collaborator_invite: z
    .object({
      first_name: name.optional(),
      last_name: name.optional(),
      email: z.string().email().max(254).optional(),
    })
    .strict(),
  membership_fee: z
    .object({
      name: name.optional(),
      duration_days: z
        .string()
        .regex(/^[1-9]\d{0,3}$/)
        .refine((value) => Number(value) <= 3650)
        .optional(),
      price: money.optional(),
    })
    .strict(),
  discount: z
    .object({
      name: name.optional(),
      percentage: z
        .string()
        .regex(/^\d{1,3}(?:[.,]\d{1,2})?$/)
        .refine(
          (value) => Number(value.replace(",", ".")) > 0 && Number(value.replace(",", ".")) <= 100,
        )
        .optional(),
      valid_from: date.optional(),
      valid_until: date.optional(),
    })
    .strict(),
  member_discount: z.object({ discount_name: name }).strict(),
  wallet_topup: z
    .object({ amount: money.refine((value) => Number(value.replace(",", ".")) > 0) })
    .strict(),
} as const;
export const administrativeFormTargets = {
  collaborator_invite: "collaborators",
  membership_fee: "membership_fees",
  discount: "membership_settings",
  member_discount: null,
  wallet_topup: null,
} as const;
export const AdministrativeDraft = z
  .object({
    kind: z.enum([
      "collaborator_invite",
      "membership_fee",
      "discount",
      "member_discount",
      "wallet_topup",
    ]),
    fields: z.record(z.string().max(254)),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !Object.keys(value.fields).length ||
      !administrativeFormSchemas[value.kind].safeParse(value.fields).success
    )
      context.addIssue({ code: "custom", message: "Invalid administrative form fields" });
    const { valid_from, valid_until } = value.fields;
    if (valid_from && valid_until && valid_from > valid_until)
      context.addIssue({ code: "custom", message: "Invalid validity interval" });
  });
export function administrativeDraftAllowed(
  access: AccountAccess,
  draft: z.infer<typeof AdministrativeDraft>,
) {
  if (access.status !== "active" || !access.clubId) return false;
  return draft.kind === "wallet_topup"
    ? access.permissions.includes("manage_members") && access.permissions.includes("use_cash")
    : access.role === "admin";
}
