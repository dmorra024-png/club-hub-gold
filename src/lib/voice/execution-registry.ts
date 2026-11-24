import { z } from "zod";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const cents = z.number().int().min(0).max(10_000_000);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
const fee = {
  name,
  duration_days: z.number().int().min(1).max(36600),
  price_cents: cents,
  active: z.boolean(),
};
const discount = {
  name: name.max(100),
  percentage_basis_points: z.number().int().min(1).max(10000),
  active: z.boolean(),
  valid_from: day.nullable(),
  valid_until: day.nullable(),
};
const discountDates = (v: { valid_from: string | null; valid_until: string | null }) =>
  !v.valid_from || !v.valid_until || v.valid_from <= v.valid_until;

const productFields = {
  name: name.optional(),
  category_id: id.optional(),
  buy_price: cents.optional(),
  sell_price: cents.optional(),
  strain: z.enum(["sativa", "indica", "hybrid"]).nullable().optional(),
  notes: z.string().max(1000).optional(),
  description: z.string().max(4000).optional(),
  active: z.boolean().optional(),
};
export const executionSchemas = {
  "product.create": z
    .object({
      name,
      category_id: id,
      buy_price: cents,
      sell_price: cents,
      strain: z.enum(["sativa", "indica", "hybrid"]).nullable(),
      notes: z.string().max(1000),
      description: z.string().max(4000),
    })
    .strict(),
  "product.update": z
    .object({ id, ...productFields })
    .strict()
    .refine((v) => Object.keys(v).length > 1),
  "stock.adjust": z
    .object({
      id,
      delta: z.preprocess(
        (v) => (typeof v === "string" ? v.replace(",", ".") : v),
        z
          .string()
          .regex(/^-?\d{1,7}(?:\.\d{1,2})?$/)
          .refine((v) => Number(v) !== 0 && Math.abs(Number(v)) <= 1000000),
      ),
      notes: z.string().trim().min(5).max(1000),
    })
    .strict(),
  "wallet.topup": z
    .object({
      member_id: id,
      cash_session_id: id,
      amount_cents: cents.refine((v) => v > 0),
      method: z.enum(["cash", "card", "transfer"]),
    })
    .strict(),
  "wallet.configure": z.object({ enabled: z.boolean() }).strict(),
  "member.create": z
    .object({
      first_name: name,
      last_name: name,
      birth_date: day,
      city: z.string().trim().max(200),
      phone: z.string().trim().max(50),
      email: z.union([z.literal(""), z.string().email().max(254)]),
      address: z.string().trim().max(200),
      postal_code: z.string().trim().max(20),
      plan_id: id.nullable(),
      method: z.enum(["cash", "card", "transfer", "other"]),
    })
    .strict(),
  "member_field.set": z
    .object({
      field_key: z.enum([
        "birth_date",
        "dni_number",
        "dni_photo",
        "address",
        "city",
        "postal_code",
        "phone",
        "email",
        "plan",
        "signature",
      ]),
      visible: z.boolean(),
      required: z.boolean(),
    })
    .strict(),
  "category.create": z
    .object({ name, unit_type: z.enum(["gr", "unit"]), is_smokeable: z.boolean() })
    .strict(),
  "member.update": z
    .object({
      id,
      first_name: name.optional(),
      last_name: name.optional(),
      birth_date: day.optional(),
      city: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(50).optional(),
      email: z.union([z.literal(""), z.string().email().max(254)]).optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 1),
  "fee.create": z.object(fee).strict(),
  "fee.update": z.object({ id, ...fee }).strict(),
  "discount.create": z.object(discount).strict().refine(discountDates),
  "discount.update": z
    .object({ id, ...discount })
    .strict()
    .refine(discountDates),
  "member.discount.set": z.object({ member_id: id, discount_id: id }).strict(),
  "member.discount.clear": z.object({ member_id: id }).strict(),
  "cash.open": z.object({ opening_cash_cents: cents }).strict(),
  "cash.close": z
    .object({ id, closing_cash_cents: cents, notes: z.string().trim().max(2000) })
    .strict(),

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
    const parsed = executionSchemas[v.action].safeParse(v.arguments);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        c.addIssue({
          code: "custom",
          path: ["arguments", ...issue.path],
          message: "Invalid registered field",
        });
  })
  .transform((value) => ({
    ...value,
    arguments: executionSchemas[value.action].parse(value.arguments),
  }));
// References originate only from a scoped server read, never from model-invented IDs.
export const executionReferences: Record<string, Record<string, string>> = {
  "product.create": { category_id: "categories" },
  "product.update": { id: "products", category_id: "categories" },
  "stock.adjust": { id: "products" },
  "wallet.topup": { member_id: "members", cash_session_id: "cash_sessions" },
  "member.create": { plan_id: "membership_plans" },
  "member.renew": { member_id: "members", plan_id: "membership_plans" },
  "member.update": { id: "members" },
  "category.update": { id: "categories" },
  "product.description": { id: "products" },
  "fee.update": { id: "membership_plans" },
  "discount.update": { id: "discounts" },
  "member.discount.set": { member_id: "members", discount_id: "discounts" },
  "member.discount.clear": { member_id: "members" },
  "cash.close": { id: "cash_sessions" },
};
export const executionCapabilities = {
  "product.create": {
    permission: "manage_products",
    rpc: "save_administrative_product",
    confirmation: true,
  },
  "product.update": {
    permission: "manage_products",
    rpc: "save_administrative_product_checked",
    confirmation: true,
  },
  "stock.adjust": {
    permission: "manage_products",
    rpc: "adjust_administrative_stock",
    confirmation: true,
  },
  "wallet.topup": {
    permission: "use_cash+manage_members",
    rpc: "socio_wallet_topup_with_method",
    confirmation: true,
  },
  "wallet.configure": {
    permission: "admin",
    rpc: "socio_wallet_set_club_enabled",
    confirmation: true,
  },
  "member.create": {
    permission: "manage_members",
    rpc: "confirm_membership_with_receipt",
    confirmation: true,
  },
  "member_field.set": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "category.create": {
    permission: "manage_products",
    rpc: "snoop_voice_entity",
    confirmation: true,
  },
  "member.update": { permission: "manage_members", rpc: "snoop_voice_entity", confirmation: true },
  "fee.create": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "fee.update": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "discount.create": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "discount.update": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "member.discount.set": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "member.discount.clear": { permission: "admin", rpc: "snoop_voice_entity", confirmation: true },
  "cash.open": { permission: "use_cash", rpc: "snoop_voice_entity", confirmation: true },
  "cash.close": { permission: "use_cash", rpc: "snoop_voice_entity", confirmation: true },

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

const recordId = { id };
const productResult = {
  ...recordId,
  name: z.string(),
  stock: z.number().finite().nonnegative(),
  category_id: id,
  buy_price: cents,
  sell_price: cents,
  description: z.string().nullable(),
  strain: z.enum(["sativa", "indica", "hybrid"]).nullable(),
  notes: z.string().nullable(),
};
const cashResult = z
  .object({
    ...recordId,
    status: z.enum(["open", "closed"]),
    opening_cash_cents: cents,
    closing_cash_cents: cents.nullable(),
    closed_by: id.nullable(),
  })
  .strict();
export const executionResults: Record<keyof typeof executionSchemas, z.ZodTypeAny> = {
  "access_control.set": z.object({ enabled: z.boolean() }).strict(),
  "category.update": z.object({ ...recordId, name: z.string(), archived: z.boolean() }).strict(),
  "category.create": z
    .object({
      ...recordId,
      name: z.string(),
      unit_type: z.enum(["gr", "unit"]),
      is_smokeable: z.boolean(),
    })
    .strict(),
  "product.description": z.object({ ...recordId, description: z.string() }).strict(),
  "product.create": z.object(productResult).strict(),
  "product.update": z.object({ ...productResult, active: z.boolean() }).strict(),
  "stock.adjust": z.object({ ...recordId, stock: z.number().finite().nonnegative() }).strict(),
  "member.create": z.object(recordId).strict(),
  "member.update": z
    .object({
      ...recordId,
      first_name: z.string(),
      last_name: z.string(),
      birth_date: day,
      city: z.string(),
      phone: z.string(),
      email: z.string(),
    })
    .strict(),
  "member.renew": z.object({ ...recordId, expires_at: day }).strict(),
  "member_field.set": z
    .object({
      ...recordId,
      field_key: executionSchemas["member_field.set"].shape.field_key,
      visible: z.boolean(),
      required: z.boolean(),
    })
    .strict(),
  "fee.create": z.object({ ...recordId, ...fee }).strict(),
  "fee.update": z.object({ ...recordId, ...fee }).strict(),
  "discount.create": z.object({ ...recordId, ...discount }).strict(),
  "discount.update": z.object({ ...recordId, ...discount }).strict(),
  "member.discount.set": z.object({ ...recordId, discount_id: id.nullable() }).strict(),
  "member.discount.clear": z.object({ ...recordId, discount_id: id.nullable() }).strict(),
  "cash.open": cashResult,
  "cash.close": cashResult,
  "wallet.configure": z
    .object({
      ...recordId,
      clubEnabled: z.boolean(),
      configured: z.literal(true),
      changed: z.boolean(),
    })
    .strict(),
  "wallet.topup": z
    .object({ ...recordId, balanceCents: z.number().int().nonnegative().safe() })
    .strict(),
};

function objectSchema(schema: z.ZodTypeAny): z.AnyZodObject {
  return schema instanceof z.ZodEffects
    ? objectSchema(schema.innerType())
    : (schema as z.AnyZodObject);
}
export function executionGuide(walletEnabled: boolean) {
  return executionNames
    .filter((name) => walletEnabled || !name.startsWith("wallet."))
    .map((action) => {
      const shape = objectSchema(executionSchemas[action]).shape;
      return {
        action,
        required: Object.keys(shape).filter((key) => !shape[key].isOptional()),
        optional: Object.keys(shape).filter((key) => shape[key].isOptional()),
      };
    });
}
const knownFields = new Set(
  Object.values(executionSchemas).flatMap((schema) => Object.keys(objectSchema(schema).shape)),
);
export function executionInvalidFields(error: unknown): string[] {
  return error instanceof z.ZodError
    ? [
        ...new Set(
          error.issues
            .map((issue) => String(issue.path.at(-1)))
            .filter((key) => knownFields.has(key)),
        ),
      ].slice(0, 5)
    : [];
}
