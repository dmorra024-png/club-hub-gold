import { normalizeVoiceFormProposal } from "../voice/form-proposal.ts";

/**
 * Gervis may omit the EMPTY transport fields of an otherwise complete,
 * explicitly typed proposal. This never repairs a forbidden key, chooses
 * a target, invents a member/product/stock/money value or grants access.
 * The existing strict ConversationProposal schema and club authorization
 * remain the only validators after this step.
 */
export function normalizeGervisProposal(value: unknown): unknown {
  const ordinary = normalizeVoiceFormProposal(value);
  if (ordinary !== value) return ordinary;
  if (!value || Array.isArray(value) || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const intents = new Set([
    "navigate", "stock_draft", "cash_draft", "administrative_draft",
    "search", "member_edit", "member_section", "category",
    "clarify", "review", "stop",
  ]);
  if (!intents.has(String(raw.intent))) return value;
  const allowed = new Set([
    "intent","target","member","product","stock_movement","query",
    "cash","form","declined","question","asking",
  ]);
  if (Object.keys(raw).some(key => !allowed.has(key))) return value;
  // A destination is ALWAYS explicit (nullable only where the schema allows).
  if (!Object.hasOwn(raw,"target")) return value;
  // Never fix a provided malformed value, nor replace actual dictation.
  if (raw.member !== undefined &&
      (!raw.member || typeof raw.member !== "object" || Array.isArray(raw.member))) return value;
  if (raw.product !== undefined &&
      (!raw.product || typeof raw.product !== "object" || Array.isArray(raw.product))) return value;
  if (raw.query !== undefined && raw.query !== null && typeof raw.query !== "string") return value;
  if (raw.declined !== undefined && !Array.isArray(raw.declined)) return value;
  if (raw.question !== undefined && typeof raw.question !== "string") return value;
  if (raw.asking !== undefined && raw.asking !== null && typeof raw.asking !== "string") return value;
  // Do not fill the meaningful contents of ANY kind of draft. Zod must reject
  // a missing stock_movement, cash or administrative form.
  return {
    ...raw,
    member: raw.member ?? {},
    product: raw.product ?? {},
    query: raw.query ?? null,
    declined: raw.declined ?? [],
    question: raw.question ?? "",
    asking: raw.asking ?? null,
  };
}
