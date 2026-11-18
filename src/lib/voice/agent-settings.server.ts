import {
  canonicalGeneticOrProduct,
  catalogVocabulary,
  canonicalCategory,
  speechKeyterms,
  vocabularyPrompt,
  vocabularyMatch,
  EMPTY_CATALOG,
  type CatalogVocabulary,
} from "./catalog-vocabulary.ts";
import { ConversationProposal, conversationAllowed } from "../snoop-conversation.ts";
import type { AccountAccess } from "../access-context.ts";
import { voiceDestinationNames } from "./destinations.ts";
import { madridToday } from "../member-administration.ts";
export function authorizeProposal(
  value: unknown,
  access: AccountAccess,
  vocabulary: CatalogVocabulary = EMPTY_CATALOG,
  declined: readonly string[] = [],
) {
  const parsed = ConversationProposal.safeParse(value);
  if (
    !parsed.success ||
    !conversationAllowed(access, parsed.data) ||
    ((parsed.data.declined.includes("phone") || declined.includes("phone")) &&
      parsed.data.asking === "phone")
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
    parsed.data.query =
      vocabularyMatch(parsed.data.query, catalogVocabulary(vocabulary).products) ??
      canonicalGeneticOrProduct(parsed.data.query, vocabulary);
  return {
    ok: true as const,
    proposal: parsed.data,
    requiresManualSave: true,
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
      enum: [...voiceDestinationNames, null],
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
  vocabulary: CatalogVocabulary = EMPTY_CATALOG,
) {
  const settings = {
    type: "Settings",
    mip_opt_out: true,
    tags: ["snoop-application"],
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
        prompt: `You are SNOOP in an authorized SNOOP application. Speak ${language === "it" ? "Italian" : language === "es" ? "Spanish" : "English"} naturally and briefly. Privacy restrictions are provided by the application. Personal data require the configured privacy approval; never request identity documents. Never claim an action completed before the application confirms it. Maintain conversation context and remember corrections and refused optional fields. This is an administrative application session: when the user provides a permitted member name and details to prepare, call snoop_propose rather than merely repeating them, even if the creation verb or SNOOP was slightly mistranscribed. Extract only the facts actually stated; ask a brief clarification if the requested action is genuinely ambiguous. Never say a member was created: only a draft was prepared. declined must be [] unless the user explicitly refuses an optional phone. Missing information is not a refusal. Never ask for phone if declined contains phone. For administrative navigation or draft fields call snoop_propose with ONLY explicit new fields. Ask a short relevant question for missing data, never invent. ISO birth dates require full unambiguous year. You cannot save, pay, cancel, mutate stock or access a database directly; use only the bounded authorized application tools. SNOOP independently validates permissions and demands confirmation; a rejected tool must not be described as successful. Navigation to cash and reports is permitted only through authorized app tools. For today’s actual receipts call snoop_cash_today; never invent a balance or infer it from conversation. ${vocabularyPrompt(vocabulary)} For greetings and general conversation, reply conversationally without a tool. Stop requests: call snoop_propose with intent stop, target null; stop capture.`,
        functions: [
          {
            name: "snoop_catalog_search",
            description:
              "Search the authenticated club's actual product/category names beyond the initial pronunciation hints. Use a distinctive name fragment, not invented availability. Only names are returned; no member, pricing or stock data. Refine the query if truncated or ambiguous, then use snoop_propose to open the real search or prepare a verified category draft.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                kind: { type: "string", enum: ["products", "categories"] },
                query: { type: "string", minLength: 2, maxLength: 60 },
              },
              required: ["kind", "query"],
            },
            defer_until_eot: true,
          },
          {
            name: "snoop_cash_day",
            description:
              "Read authorized receipts for one explicit Europe/Madrid calendar day. Resolve dates to YYYY-MM-DD; ask if ambiguous. Same user permissions and source as the manual report; no writes.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: { day: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
              required: ["day"],
            },
            defer_until_eot: true,
          },
          {
            name: "snoop_cash_today",
            description:
              "Read the authorized Madrid calendar-day receipts using the same source as Informe de caja. Read-only; no opening balance included.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {},
              required: [],
            },
            defer_until_eot: true,
          },
          {
            name: "snoop_propose",
            description:
              "Open an authorized application screen or prepare a form. Await the actual application result; this tool never saves automatically.",
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
  settings.agent.think.prompt =
    `Current Europe/Madrid calendar date: ${madridToday()}. For any day other than today use snoop_cash_day with an explicit ISO calendar day; ask for clarification for ambiguous dates. Available navigation targets: ${voiceDestinationNames.join(", ")}. These targets only open existing screens and never imply that their forms were saved. ` +
    settings.agent.think.prompt;
  return settings;
}
