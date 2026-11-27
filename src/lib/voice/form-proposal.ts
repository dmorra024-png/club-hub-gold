import { normalizeNavigationProposal } from "./navigation-proposal.ts";

/** Complete only omitted transport envelope keys on an explicitly targeted
 * member/product FORM draft. No unknown fields are silently removed.
 * The existing Zod proposal schema, club permissions and form-field checks
 * remain authoritative after this normalization. */
export function normalizeVoiceFormProposal(value: unknown): unknown {
  const opening = normalizeNavigationProposal(value);
  if (opening !== value) return opening;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const member = raw.intent === "member" && raw.target === "member_create";
  const product = raw.intent === "product" && raw.target === "product_create";
  if (!member && !product) return value;
  const allowed = new Set([
    "intent", "target", "member", "product", "query", "declined", "question", "asking",
  ]);
  if (Object.keys(raw).some(key => !allowed.has(key))) return value;
  const fields = member ? raw.member : raw.product;
  const other = member ? raw.product : raw.member;
  if (!fields || typeof fields !== "object" || Array.isArray(fields) ||
      Object.keys(fields).length === 0) return value;
  if (other !== undefined &&
      (!other || typeof other !== "object" || Array.isArray(other) ||
       Object.keys(other).length !== 0)) return value;
  if (raw.query !== undefined && raw.query !== null && raw.query !== "") return value;
  if (raw.declined !== undefined && !Array.isArray(raw.declined)) return value;
  if (raw.question !== undefined && typeof raw.question !== "string") return value;
  if (raw.asking !== undefined && raw.asking !== null &&
      typeof raw.asking !== "string") return value;
  return {
    ...raw,
    member: member ? fields : {},
    product: product ? fields : {},
    query: raw.query ?? null,
    declined: raw.declined ?? [],
    question: raw.question ?? "",
    asking: raw.asking ?? null,
  };
}
