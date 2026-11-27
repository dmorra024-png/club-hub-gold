import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { authorizeProposal } from "../src/lib/voice/agent-settings.server.ts";
import { applicationPorts, voiceOwner } from "../src/lib/voice/application-ports.ts";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { productFormVoice } from "../src/lib/product-form-voice.ts";

const access = {
  status: "active" as const, role: "admin" as const,
  clubId: "test-club", clubName: "Synthetic", clubLogo: null,
  permissions: ["manage_products" as const],
};
const categories = [
  { id: "smoke", name: "Flores", unit_type: "gr", is_smokeable: true },
];
function draft(name: string, delta: string) {
  return {
    intent: "stock_draft", target: "stock",
    stock_movement: { name, delta },
    member: {}, product: {}, query: null,
    declined: [], question: "", asking: null,
  };
}
test("stock draft is a strict, permissioned, confirmation-only proposal", () => {
  assert(ConversationProposal.safeParse(draft("Amnesia Haze", "50")).success);
  assert(ConversationProposal.safeParse(draft("Amnesia Haze", "-1.50")).success);
  for (const invalid of ["0", "nan", "1000001", "1.999", "1e9"])
    assert(!ConversationProposal.safeParse(draft("Amnesia Haze", invalid)).success, invalid);
  assert(!ConversationProposal.safeParse({ ...draft("Amnesia", "50"), target: "cash" }).success);
  assert(!ConversationProposal.safeParse({ ...draft("Amnesia", "50"), stock_movement: undefined }).success);
  assert(authorizeProposal(draft("Amnesia Haze", "50"), access).ok);
  assert(!authorizeProposal(draft("Amnesia Haze", "50"), { ...access, permissions: [] }).ok);
});
test("stock voice stages the existing preview port but never writes data", async () => {
  const owner = voiceOwner("synthetic", "test-club");
  let value: unknown;
  const remove = applicationPorts.register(owner, "products.page", {
    open: (target) => { assert.equal(target, "stock"); },
    stageStock: (name, delta) => {
      value = { name, delta };
      return true;
    },
  });
  let path = "/productos";
  try {
    const result = await applyDeepgramDraft(ConversationProposal.parse(draft("Amnesia Haze", "50")), {
      access, owner, path: () => path, current: () => true,
      navigate: (target) => { path = target; },
      last: {},
    });
    assert.equal(result.proposal.intent, "stock_draft");
    assert.deepEqual(value, { name: "Amnesia Haze", delta: "50" });
  } finally { remove(); }
});
test("product voice creation never fabricates absent zero prices or wipes previous fields", () => {
  const bare = productFormVoice("crea prodotto Amnesia Haze categoria Flores tipo sativa", categories);
  assert(bare);
  assert.equal(bare.name, "Amnesia Haze");
  assert.equal(bare.category_id, "smoke");
  assert.equal(bare.strain, "sativa");
  assert(!Object.hasOwn(bare, "stock"));
  assert(!Object.hasOwn(bare, "buy_price"));
  assert(!Object.hasOwn(bare, "sell_price"));
});
