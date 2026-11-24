import { z } from "zod";
const id = z.string().uuid();
export const executionSchemas = {
  "access_control.set": z.object({ enabled: z.boolean() }).strict(),
  "category.update": z
    .object({ id, name: z.string().max(120).trim().min(1), archived: z.boolean() })
    .strict(),
  "product.description": z.object({ id, description: z.string().max(4000).trim().min(1) }).strict(),
  "member.renew": z
    .object({ member_id: id, plan_id: id, method: z.enum(["cash", "card", "transfer", "other"]) })
    .strict(),
} as const;
export const executionNames = Object.keys(executionSchemas) as [
  keyof typeof executionSchemas,
  ...(keyof typeof executionSchemas)[],
];
export const ExecutionRequest = z
  .object({ action: z.enum(executionNames), arguments: z.record(z.unknown()) })
  .strict()
  .superRefine((v, c) => {
    if (!executionSchemas[v.action].safeParse(v.arguments).success)
      c.addIssue({ code: "custom", message: "Invalid registered action arguments" });
  })
  .transform((value) => ({
    ...value,
    arguments: executionSchemas[value.action].parse(value.arguments),
  }));
export const executionCapabilities = {
  "access_control.set": {
    permission: "admin",
    rpc: "snoop_set_club_access_control",
    confirmation: true,
  },
  "category.update": {
    permission: "manage_products",
    rpc: "manage_administrative_category",
    confirmation: true,
  },
  "product.description": {
    permission: "manage_products",
    rpc: "save_administrative_product_checked",
    confirmation: true,
  },
  "member.renew": {
    permission: "manage_members",
    rpc: "confirm_membership_with_receipt",
    confirmation: true,
  },
} as const;
