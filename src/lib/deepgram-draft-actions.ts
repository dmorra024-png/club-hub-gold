import {
  ConversationProposal,
  conversationAllowed,
  targetPath,
  type ConversationProposalValue,
} from "./snoop-conversation.ts";
import type { AccountAccess } from "./access-context.ts";
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
    navigate: (path: string) => Promise<unknown> | void;
    path: () => string;
    current: () => boolean;
    last: Record<string, Record<string, string>>;
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
  }
  const valid = () => options.current() && (!to || options.path() === to);
  const wait = async <T>(read: () => T | null | undefined): Promise<T> => {
    const until = performance.now() + 4000;
    while (valid()) {
      const v = read();
      if (v) return v;
      if (performance.now() > until) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error("SNOOP_FORM_UNAVAILABLE");
  };
  const event = (name: string, detail: unknown) => {
    if (!valid()) throw Error("SNOOP_STALE_PROPOSAL");
    window.dispatchEvent(new CustomEvent(name, { detail }));
  };
  const snapshot = (kind: string): Record<string, string> | null => {
    let result: Record<string, string> | null = null;
    window.dispatchEvent(
      new CustomEvent("snoop:ai-form", {
        detail: {
          kind,
          respond: (v: Record<string, string>) => {
            result = v;
          },
        },
      }),
    );
    return result;
  };
  let skipped: string[] = [];
  if (p.target && ["products", "product_create", "categories", "stock"].includes(p.target)) {
    await wait(() => document.querySelector("[data-snoop-products-page]"));
    event("snoop:ai-products", { target: p.target, patch: {}, query: p.query });
  }
  if (p.intent === "category" && p.product.name) {
    const input = await wait(() =>
      document.querySelector<HTMLInputElement>('input[placeholder="ej. Flores"]'),
    );
    const next = protectedVoicePatch({ name: input.value }, options.last.category ?? {}, {
      name: p.product.name,
    });
    skipped = next.skipped;
    if (next.applied.name) {
      event("snoop:ai-products", { target: "categories", patch: next.applied });
      options.last.category = { ...options.last.category, ...next.applied };
    }
  }
  const kind = p.intent === "member" ? "member" : p.intent === "product" ? "product" : null;
  if (kind) {
    const current = await wait<Record<string, string>>(() => snapshot(kind));
    const patch = (kind === "member" ? p.member : p.product) as Record<string, string>;
    const next = protectedVoicePatch(current, options.last[kind] ?? {}, patch);
    skipped = next.skipped;
    if (Object.keys(next.applied).length) {
      event("snoop:ai-form", { kind, patch: next.applied });
      options.last[kind] = { ...options.last[kind], ...next.applied };
    }
  }
  if (p.intent === "search" && p.target === "members") {
    await wait(() => document.querySelector('input[placeholder^="Buscar por nº socio"]'));
    event("snoop:search-members", { query: p.query ?? "" });
  }
  if (p.target === "cash_report") {
    const tab = await wait(() =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (t) => t.textContent === "Informe de caja",
      ),
    );
    if (!valid() || tab.disabled) throw Error("SNOOP_REPORT_NOT_AUTHORIZED");
    tab.focus();
    tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
  return { proposal: p, skipped };
}
