import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeProposal } from "../src/lib/voice/agent-settings.server.ts";
import { parseAccountAccess } from "../src/lib/access-context.ts";
test("declined optional phone is enforced from session memory, not just the latest model response", () => {
  const access = parseAccountAccess({
    role: "admin",
    status: "active",
    clubId: "synthetic-club",
    permissions: ["manage_members"],
  });
  const p = {
    intent: "member",
    target: "member_create",
    member: { city: "Palma" },
    product: {},
    query: null,
    declined: [],
    question: "Telefono?",
    asking: "phone",
  };
  assert.equal(authorizeProposal(p, access, { categories: [], products: [] }, ["phone"]).ok, false);
  assert.equal(
    authorizeProposal(
      { ...p, question: "Controlla la bozza", asking: null },
      access,
      { categories: [], products: [] },
      ["phone"],
    ).ok,
    true,
  );
});

test("conversation memory advances only from applied fields; failed proposals and manual edits are never remembered as success", async () => {
  const { acknowledgedMemory } = await import("../src/lib/voice/action-protocol.ts");
  const { emptyConversation, ConversationProposal } =
    await import("../src/lib/snoop-conversation.ts");
  const p = ConversationProposal.parse({
    intent: "member",
    target: "member_create",
    member: { first_name: "Ana", last_name: "Draft" },
    product: {},
    query: null,
    declined: ["phone"],
    question: "Fecha?",
    asking: "birth_date",
  });
  const initial = emptyConversation();
  const rejected = acknowledgedMemory(initial, p, {
    type: "AppActionResult",
    id: "a",
    status: "rejected",
  });
  assert.deepEqual(rejected, initial);
  const next = acknowledgedMemory(initial, p, {
    type: "AppActionResult",
    id: "a",
    status: "prepared",
    applied: ["first_name"],
    skipped: ["last_name"],
  });
  assert.deepEqual(next.member, { first_name: "Ana" });
  assert.deepEqual(next.declined, ["phone"]);
  assert.deepEqual(initial.member, {});
});
