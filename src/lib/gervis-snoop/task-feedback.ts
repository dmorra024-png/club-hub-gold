import type { ConversationProposalValue } from "../snoop-conversation.ts";

/**
 * Feedback is based ONLY on the app's validated receipt; it cannot turn a
 * draft into a saved record. It helps the conversational agent continue the
 * current task instead of asking the operator to start again.
 */
export function gervisTaskFeedback(
  proposal: ConversationProposalValue,
  outcome: {ok: boolean; status: string; persisted: boolean; applied?: readonly string[]; skipped?: readonly string[]; code?: string},
): {ok: boolean; status: string; persisted: boolean; applied?: readonly string[]; skipped?: readonly string[]; code?: string; next_step?: string} {
  if (!outcome.ok || outcome.status === "rejected") {
    return {
      ...outcome,
      next_step: outcome.code === "STOCK_DRAFT_UNAVAILABLE"
        ? "The stock movement was NOT prepared and inventory did NOT change. Ask the operator to check the exact existing product and signed quantity, or open the stock list to choose. Do not claim permission denied."
        : outcome.code === "MEMBER_NOT_FOUND"
        ? "No matching existing member was found in the authorized club. Keep the member search open; ask for surname, member number or corrected spelling. Do not open the new member form."
        : outcome.code === "MEMBER_SEARCH_UNAVAILABLE"
        ? "The real club member search failed. Do NOT report zero results or permission denied. Offer a retry or the manual member list."
        : outcome.code === "SURNAME_SPELLING_UNCLEAR"
        ? "The surname was NOT corrected. Keep name, date and other form fields unchanged. Ask for the FULL surname to be spelled letter by letter; never append a sound or suffix to the existing surname."
        : outcome.code === "EMAIL_CORRECTION_UNCLEAR"
        ? "The member email correction was NOT applied. Do not retry blindly or claim success. Ask the operator to spell the complete corrected address with arroba and punto. Preserve all earlier form fields."
        : outcome.code === "STALE"
        ? "The operator changed screens. Ask if they want to resume this task; never retry a write."
        : "This step was not completed. Explain the real error, retain previous confirmed progress and ask for the next safe step.",
    };
  }
  if (proposal.intent === "search" && proposal.target === "members" && outcome.status === "opened") {
    return {...outcome, next_step: outcome.code === "MEMBER_AMBIGUOUS"
      ? "Multiple possible members were found. Ask the operator to choose in the existing member list; NEVER select a member by guess."
      : "The authenticated member search ran in the existing member UI. If one match was verified its ficha was opened. Do not invent personal details or claim any record was changed."};
  }
  if (proposal.intent === "navigate" && outcome.status === "opened") {
    const next_step = proposal.target === "member_create"
      ? "The NEW MEMBER form is open. Ask for one missing member detail, then fill it through the existing authorized draft tool. The member has NOT been registered."
      : proposal.target === "product_create"
        ? "The NEW PRODUCT form is open. Ask for the next required product detail; preserve already edited fields. The product has NOT been saved."
        : "The requested section is open. Continue with the operator's next request, using scoped reads or drafts when needed.";
    return {...outcome, next_step};
  }
  if (proposal.intent === "member" && outcome.status === "prepared") {
    return {
      ...outcome,
      next_step: "The member FORM draft was updated with the acknowledged fields only. Keep other fields unchanged. Ask for one missing required detail. Wait for human Save; no member was registered.",
    };
  }
  if (proposal.intent === "product" && outcome.status === "prepared") {
    return {
      ...outcome,
      next_step: "The product FORM draft was updated. Do not re-send or erase previous fields. Continue gathering missing required values; manual Save is still required.",
    };
  }
  if (proposal.intent === "stock_draft" && outcome.status === "prepared") {
    return {
      ...outcome,
      next_step: "A stock movement is staged for HUMAN confirmation, not applied. Verify product and signed quantity; do not claim inventory changed.",
    };
  }
  return outcome;
}
