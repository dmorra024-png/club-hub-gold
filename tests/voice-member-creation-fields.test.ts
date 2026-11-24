import { test } from "node:test";
import assert from "node:assert/strict";
import { memberCreationPatch } from "../src/lib/voice/member-creation-fields.ts";
import { ConversationProposal } from "../src/lib/snoop-conversation.ts";
import { protectedVoicePatch } from "../src/lib/deepgram-draft-actions.ts";
import { ActionReceipt } from "../src/lib/voice/action-protocol.ts";
const plans = [{ id: "synthetic-plan", name: "Semestral" }];
test("registration resolves an explicitly named existing fee and address without inventing price or payment", () => {
  assert.deepEqual(
    memberCreationPatch(
      { address: "Calle Sintética 12", postal_code: "07001", plan_name: " semestral " },
      plans,
    ),
    { address: "Calle Sintética 12", postal_code: "07001", plan_id: "synthetic-plan" },
  );
  assert.deepEqual(memberCreationPatch({ city: "Palma" }, plans), { city: "Palma" });
});
test("unknown, ambiguous and injected membership identifiers cannot partially alter registration", () => {
  assert.throws(
    () => memberCreationPatch({ city: "Inca", plan_name: "Desconocida" }, plans),
    /NOT_FOUND/,
  );
  assert.throws(
    () =>
      memberCreationPatch({ plan_name: "Semestral" }, [
        ...plans,
        { id: "other", name: "SEMESTRAL" },
      ]),
    /AMBIGUOUS/,
  );
  for (const fields of [
    { plan_id: "other-club" },
    { price: "1" },
    { dni_number: "forbidden" },
    { postal_code: "<script>" },
  ])
    assert.throws(() => memberCreationPatch(fields, plans));
});
test("manual registration address, postal code and fee choices retain ownership over delayed proposals", () => {
  const current = { address: "Manual", postal_code: "07002", plan_name: "Anual" };
  assert.deepEqual(
    protectedVoicePatch(
      current,
      {},
      { address: "Modelo", postal_code: "07001", plan_name: "Semestral" },
    ),
    { applied: {}, skipped: ["address", "postal_code", "plan_name"] },
  );
});
test("creation-only fields are rejected in an existing member edit and acknowledged without claiming persistence", () => {
  const proposal = {
    intent: "member_edit",
    target: null,
    member: { plan_name: "Semestral" },
    product: {},
    query: null,
    declined: [],
    question: "",
    asking: null,
  };
  assert(!ConversationProposal.safeParse(proposal).success);
  assert(
    ConversationProposal.safeParse({ ...proposal, intent: "member", target: "member_create" })
      .success,
  );
  const receipt = ActionReceipt.parse({
    type: "AppActionResult",
    id: "synthetic",
    status: "prepared",
    applied: ["address", "postal_code", "plan_name"],
  });
  assert.equal(receipt.status, "prepared");
});
test("disabled club fields reject the complete patch before any visible field is changed", () => {
  assert.throws(
    () => memberCreationPatch({ city: "Inca", address: "Hidden" }, plans, ["city"]),
    /FIELD_DISABLED/,
  );
});
