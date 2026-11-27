import {
  ConversationProposal,
  conversationAllowed,
  targetPath,
  type ConversationProposalValue,
} from "./snoop-conversation.ts";
import { applicationPorts, isMemberCardPath, type VoicePort } from "./voice/application-ports.ts";
import type { AccountAccess } from "./access-context.ts";
import { parseCashCents, calendarDate } from "./member-administration.ts";
import { removeSingleLocalEmailDot } from "./gervis-snoop/email-correction.ts";
const formOwners = new WeakMap<object, Map<string, VoicePort>>();
export function protectedVoicePatch(
  current: Record<string, string>,
  last: Record<string, string>,
  patch: Record<string, string>,
) {
  const applied: Record<string, string> = {},
    skipped: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (Object.hasOwn(last, key) ? current[key] !== last[key] : !!current[key]) skipped.push(key);
    else applied[key] = value;
  }
  return { applied, skipped };
}
export async function applyDeepgramDraft(
  value: unknown,
  options: {
    access: AccountAccess;
    owner?: string;
    navigate: (path: string) => Promise<unknown> | void;
    path: () => string;
    current: () => boolean;
    last: Record<string, Record<string, string>>;
    reportDay?: string;
    verifyNavigation?: boolean;
  },
) {
  const parsed = ConversationProposal.safeParse(value);
  if (!parsed.success || !conversationAllowed(options.access, parsed.data))
    throw Error("SNOOP_PROPOSAL_NOT_AUTHORIZED");
  const p = parsed.data;
  if (!options.current()) throw Error("SNOOP_STALE_PROPOSAL");
  const from = options.path(),
    to = p.target ? targetPath[p.target] : null;
  if (to && to !== from) {
    await options.navigate(to);
    const until = performance.now() + 2500;
    while (options.current() && options.path() === from && performance.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    if (options.verifyNavigation && options.path() !== to)
      throw Error("SNOOP_FORM_UNAVAILABLE");
  }
  const needsMemberCard =
    ["member_edit", "member_section"].includes(p.intent) ||
    (p.intent === "administrative_draft" &&
      ["member_discount", "wallet_topup"].includes(p.form!.kind));
  if (needsMemberCard && !isMemberCardPath(options.path()))
    throw Error("SNOOP_FORM_UNAVAILABLE_MEMBER_CARD");
  const valid = () => options.current() && options.path() === (to ?? from);
  const port = async (name: string) => {
    const found = await applicationPorts.wait(options.owner ?? "", name, valid);
    if (!valid()) throw Error("SNOOP_STALE_PROPOSAL");
    return found;
  };
  // Gervis only: a URL transition is not enough to claim that the member
  // form is usable. Wait for the REAL registered form port to become ready.
  // Legacy Pilot retains its previous behavior.
  if (options.verifyNavigation && p.intent === "navigate" &&
      p.target === "member_create")
    await port("member.form");
  let skipped: string[] = [];
  let applied: string[] = [];
  if (
    p.target &&
    ["products", "product_create", "categories", "stock", "warehouse"].includes(p.target)
  ) {
    const page = await port("products.page");
    if (!page.open) throw Error("SNOOP_FORM_UNAVAILABLE");
    page.open(p.target, p.query);
  }
  if (p.intent === "stock_draft") {
    const page = await port("products.page");
    if (!page.stageStock || !p.stock_movement ||
        !page.stageStock(p.stock_movement.name, p.stock_movement.delta))
      throw Error("SNOOP_STOCK_DRAFT_UNAVAILABLE");
    // Only the existing inventory panel can confirm. No RPC is executed here.
  }
  if (p.intent === "cash_draft") {
    const page = await port("cash.page");
    if (!page.open) throw Error("SNOOP_FORM_UNAVAILABLE");
    page.open("mine");
  }
  const kind =
    p.intent === "administrative_draft"
      ? "admin." + p.form!.kind
      : p.intent === "cash_draft"
        ? "cash"
        : p.intent === "member_edit"
          ? "member_edit"
          : p.intent === "member"
            ? "member"
            : p.intent === "product"
              ? "product"
              : p.intent === "category"
                ? "category"
                : null;
  if (kind) {
    const form = await port(
      kind.startsWith("admin.") ? kind : kind === "member_edit" ? "member.edit" : kind + ".form",
    );
    if (!valid()) throw Error("SNOOP_STALE_PROPOSAL");
    let forms = formOwners.get(options.last);
    if (!forms) {
      forms = new Map();
      formOwners.set(options.last, forms);
    }
    if (forms.get(kind) !== form) {
      options.last[kind] =
        kind.startsWith("admin.") || ["member_edit", "cash"].includes(kind)
          ? (form.baseline?.() ?? {})
          : kind === "product"
            ? {
                // Initial empty form values, NOT manually entered values.
                // A changed value is still protected by protectedVoicePatch.
                stock: "0",
                buy_price: "0.00",
                sell_price: "0.00",
                destination: "dispensario",
              }
            : {};
      forms.set(kind, form);
    }
    const patch = {
      ...(kind.startsWith("admin.")
        ? p.form!.fields
        : kind === "cash"
          ? (p.cash ?? {})
          : ["member", "member_edit"].includes(kind)
            ? p.member
            : p.product),
    } as Record<string, string>;
    if (p.email_correction) {
      // Only the Gervis phone-test pathway may use this narrow local edit.
      // Never replace a manually modified email or guess punctuation.
      if (!options.verifyNavigation || kind !== "member" || !form.snapshot ||
          Object.keys(patch).length !== 0)
        throw Error("SNOOP_EMAIL_CORRECTION_UNCLEAR");
      const currentEmail = form.snapshot().email;
      const voiceOwnedEmail = options.last.member?.email;
      if (!voiceOwnedEmail || voiceOwnedEmail !== currentEmail)
        throw Error("SNOOP_EMAIL_CORRECTION_UNCLEAR");
      patch.email = removeSingleLocalEmailDot(currentEmail);
    }
    if (kind === "admin.membership_fee" && patch.price !== undefined) {
      const cents = parseCashCents(patch.price);
      if (cents === null) throw Error("SNOOP_INVALID_AMOUNT");
      patch.price = String(cents / 100);
    }
    if (!form.snapshot) throw Error("SNOOP_FORM_UNAVAILABLE");
    const next = protectedVoicePatch(form.snapshot(), options.last[kind] ?? {}, patch);
    skipped = next.skipped;
    if (Object.keys(next.applied).length) {
      if (!form.patch) throw Error("SNOOP_FORM_UNAVAILABLE");
      form.patch(next.applied);
      applied = Object.keys(next.applied);
      options.last[kind] = { ...options.last[kind], ...next.applied };
    }
  }
  if (p.intent === "member_section") {
    const member = await port("member.sections");
    if (!member.open) throw Error("SNOOP_FORM_UNAVAILABLE");
    member.open(p.query!);
  }
  if (p.intent === "search" && p.target === "members") {
    const search = await port("members.search");
    if (!search.search) throw Error("SNOOP_FORM_UNAVAILABLE");
    search.search(p.query ?? "");
  }
  if (p.target === "cash_report") {
    if (options.reportDay !== undefined && !calendarDate(options.reportDay))
      throw Error("SNOOP_INVALID_REPORT_DAY");
    const cash = await port("cash.page");
    if (!cash.open) throw Error("SNOOP_FORM_UNAVAILABLE");
    cash.open("report", options.reportDay);
  }
  return { proposal: p, skipped, applied };
}
