import {
  canonicalGeneticOrProduct,
  catalogVocabulary,
  canonicalCategory,
  speechKeyterms,
  vocabularyPrompt,
  LAB_CATALOG,
  type CatalogVocabulary,
} from "./vocabulary.ts";
import { ConversationProposal, conversationAllowed } from "../../src/lib/snoop-conversation.ts";
import type { AccountAccess } from "../../src/lib/access-context.ts";
export const LAB_ACCESS: AccountAccess = Object.freeze<AccountAccess>({
  role: "collaborator",
  status: "active",
  clubId: "synthetic-voice-lab",
  clubName: "Synthetic lab",
  clubLogo: null,
  permissions: ["manage_members", "manage_products"],
});
export function authorizeProposal(
  value: unknown,
  access: AccountAccess = LAB_ACCESS,
  vocabulary: CatalogVocabulary = LAB_CATALOG,
) {
  const parsed = ConversationProposal.safeParse(value);
  if (
    !parsed.success ||
    !conversationAllowed(access, parsed.data) ||
    (parsed.data.declined.includes("phone") && parsed.data.asking === "phone")
  )
    return { ok: false as const, code: "SNOOP_PROPOSAL_REJECTED" };
  if (parsed.data.product.category) {
    const canonical = canonicalCategory(parsed.data.product.category, vocabulary);
    if (!canonical)
      return {
        ok: false as const,
        code: catalogVocabulary(vocabulary).categories.length
          ? "SNOOP_UNKNOWN_CATEGORY"
          : "SNOOP_CATEGORY_CONTEXT_REQUIRED",
        hint: "Category not assigned. Ask for a verified category; never create or guess one.",
      };
    parsed.data.product.category = canonical;
  }
  if (parsed.data.intent === "product" && parsed.data.product.name)
    parsed.data.product.name = canonicalGeneticOrProduct(parsed.data.product.name, vocabulary);
  if (parsed.data.intent === "search" && parsed.data.target === "products" && parsed.data.query)
    parsed.data.query = canonicalGeneticOrProduct(parsed.data.query, vocabulary);
  return {
    ok: true as const,
    proposal: parsed.data,
    synthetic: true,
    requiresConfirmation: true,
    persisted: false,
  };
}
export const proposalSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "target", "member", "product", "query", "declined", "question", "asking"],
  properties: {
    intent: {
      type: "string",
      enum: ["navigate", "member", "product", "category", "search", "clarify", "review", "stop"],
    },
    target: {
      type: ["string", "null"],
      enum: [
        "home",
        "member_create",
        "members",
        "products",
        "product_create",
        "categories",
        "stock",
        "cash",
        "cash_report",
        "reports",
        "activity",
        null,
      ],
    },
    member: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        ["first_name", "last_name", "birth_date", "city", "phone"].map((k) => [
          k,
          { type: "string" },
        ]),
      ),
    },
    product: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string" }, category: { type: "string" } },
    },
    query: { type: ["string", "null"] },
    declined: { type: "array", items: { enum: ["phone"] } },
    question: { type: "string" },
    asking: {
      type: ["string", "null"],
      enum: ["first_name", "last_name", "birth_date", "city", "phone", "other", null],
    },
  },
};
export function agentSettings(
  language: "it" | "es" | "en",
  sampleRate: number,
  vocabulary: CatalogVocabulary = LAB_CATALOG,
) {
  return {
    type: "Settings",
    mip_opt_out: true,
    tags: ["snoop-isolated-synthetic-lab"],
    audio: {
      input: { encoding: "linear16", sample_rate: sampleRate },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      listen: {
        provider: {
          type: "deepgram",
          version: "v2",
          model: "flux-general-multi",
          language_hints: [
            language,
            ...(["it", "es", "en"] as const).filter((l) => l !== language),
          ],
          // Confidence tuning, not a blanket delay. Keep the documented 5s silence backstop.
          eot_threshold: 0.85,
          eot_timeout_ms: 5000,
          // No eager threshold: avoid speculative extra LLM calls/credit consumption.
          keyterms: speechKeyterms(vocabulary),
        },
      },
      think: {
        provider: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.2 },
        prompt: `You are SNOOP in an ISOLATED SYNTHETIC voice laboratory. Speak ${language === "it" ? "Italian" : language === "es" ? "Spanish" : "English"} naturally and briefly. Only fictional people and data are allowed. Do not request real identifiers, documents or club information. Do not claim anything was saved or done in a real app. Maintain conversation context and remember corrections and refused optional fields. This is an administrative draft session: when the user provides a fictional member name and details to prepare, call snoop_propose rather than merely repeating them, even if the creation verb or SNOOP was slightly mistranscribed. Extract only the facts actually stated; ask a brief clarification if the requested action is genuinely ambiguous. Never say a member was created: only a draft was prepared. declined must be [] unless the user explicitly refuses an optional phone. Missing information is not a refusal. Never ask for phone if declined contains phone. For administrative navigation or draft fields call snoop_propose with ONLY explicit new fields. Ask a short relevant question for missing data, never invent. ISO birth dates require full unambiguous year. You cannot save, pay, cancel, mutate stock or access a database. SNOOP independently validates permissions and demands confirmation; a rejected tool must not be described as successful. This lab role permits member and informational product drafts/search only, not financial/reports access. ${vocabularyPrompt(vocabulary)} For greetings and general conversation, reply conversationally without a tool. Stop requests: say goodbye briefly.`,
        functions: [
          {
            name: "snoop_propose",
            description:
              "Propose navigation or a synthetic draft patch. Never executes or saves. All proposals are checked by SNOOP.",
            parameters: proposalSchema,
            defer_until_eot: true,
          },
        ],
      },
      speak: {
        provider: {
          type: "deepgram",
          version: "v2",
          model:
            language === "it"
              ? "flux-paola-it"
              : language === "es"
                ? "flux-carmen-es"
                : "flux-kit-en",
        },
      },
    },
  };
}
