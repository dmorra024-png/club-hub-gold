/**
 * Feedback for Gervis only. Errors do not grant any capability and do not
 * mutate data: they inform the model how to recover from the last real tool
 * receipt without misrepresenting an application failure as an authorization
 * denial. The underlying server result remains authoritative.
 */
type GervisRejection = {
  ok: false;
  code?: string;
  reason?: string;
  persisted?: boolean;
  status?: string;
};

const HINTS = {
  permission: "The CURRENT authenticated account lacks authorization for this action. Do not retry with different arguments or claim that an administrator granted access. Offer an authorized alternative.",
  format: "The model supplied invalid tool arguments. This is NOT a user permission failure. Keep the conversation going, use the tool's documented argument schema, and retry once if the user's intent is clear. Never invent missing fields.",
  declined: "The operator already refused an optional field. Respect that choice and continue with other required fields. This is NOT a permission failure.",
  category: "The requested category was not verified in this club. Search authorized categories or ask the operator to choose; do not invent one. This is NOT a permission failure.",
  unknown: "The application did not complete this operation. Do not claim permission was denied, nor that any form was saved. Ask one useful question or offer an authorized next step.",
} as const;

export function gervisToolFeedback(value: GervisRejection) {
  if (value.ok !== false) return value;
  const reason = value.reason === "permission" ? "permission"
    : value.reason === "format" ? "format"
    : value.reason === "declined" ? "declined"
    : value.code === "SNOOP_UNKNOWN_CATEGORY" || value.code === "SNOOP_CATEGORY_CONTEXT_REQUIRED" ? "category"
    : "unknown";
  return {
    ...value,
    status: "rejected" as const,
    persisted: false as const,
    error_kind: reason,
    recovery: HINTS[reason],
  };
}
