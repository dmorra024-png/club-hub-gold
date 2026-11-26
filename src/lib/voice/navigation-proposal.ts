import { voiceDestinationNames, type VoiceDestination } from "./destinations.ts";

/** Normalizes ONLY non-mutating screen openings produced by the voice model.
 * Never drops a spoken field, never grants a permission, and never invokes
 * stock, member, product, cash, or money writes. The ordinary authorization
 * boundary still checks the final proposal and the current club role. */
export function normalizeNavigationProposal(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const intent = raw.intent;
  const target = raw.target;
  if (typeof target !== "string" ||
      !voiceDestinationNames.includes(target as VoiceDestination)) return value;
  if (!(intent === "navigate" ||
        (intent === "member" && target === "member_create") ||
        (intent === "product" && target === "product_create"))) return value;
  // A creation request containing real dictated values must travel through
  // the existing validated form-draft flow, never a navigation shortcut.
  const allowed = new Set(["intent","target","member","product","query","declined","question","asking"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return value;
  const blankObject = (obj: unknown) =>
    obj === undefined || (obj !== null && typeof obj === "object" &&
    !Array.isArray(obj) && Object.keys(obj).length === 0);
  if (!blankObject(raw.member) || !blankObject(raw.product)) return value;
  if (raw.query !== undefined && raw.query !== null && raw.query !== "") return value;
  if (raw.declined !== undefined &&
      (!Array.isArray(raw.declined) || raw.declined.length !== 0)) return value;
  if (raw.asking !== undefined && raw.asking !== null) return value;
  if (raw.question !== undefined && raw.question !== "") return value;
  return {
    intent: "navigate",
    target,
    member: {},
    product: {},
    query: null,
    declined: [],
    question: "",
    asking: null,
  };
}
