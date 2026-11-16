import test from "node:test";
import assert from "node:assert/strict";
import { protectedVoicePatch, applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const access: AccountAccess = {
  role: "admin",
  status: "active",
  clubId: "synthetic-club",
  clubName: "Synthetic",
  clubLogo: null,
  permissions: ["manage_members", "manage_products"],
};
const draft = {
  intent: "member",
  target: "member_create",
  member: { first_name: "Ana", last_name: "Prueba", birth_date: "1995-03-12", city: "Palma" },
  product: {},
  query: null,
  declined: [],
  question: "",
  asking: null,
};
test("Deepgram fills multiple explicitly requested empty fields without an automatic save", () => {
  const patch = protectedVoicePatch(
    { first_name: "", last_name: "", birth_date: "", city: "" },
    {},
    draft.member,
  );
  assert.deepEqual(patch.applied, draft.member);
  assert.deepEqual(patch.skipped, []);
});
test("voice corrections update only voice-owned fields; prior manual entries are preserved", () => {
  const r = protectedVoicePatch(
    { first_name: "Manual", city: "Palma" },
    { first_name: "Ana", city: "Palma" },
    { first_name: "Old model value", city: "Inca" },
  );
  assert.deepEqual(r.applied, { city: "Inca" });
  assert.deepEqual(r.skipped, ["first_name"]);
  assert.deepEqual(protectedVoicePatch({ city: "Manual" }, {}, { city: "Model" }).applied, {});
});
test("a manually cleared value is not silently restored from conversation memory", () => {
  const r = protectedVoicePatch({ phone: "" }, { phone: "600000001" }, { phone: "600000002" });
  assert.deepEqual(r.applied, {});
  assert.deepEqual(r.skipped, ["phone"]);
});
test("permission failures, cross-club payloads and stale proposals stop before navigation or DOM effects", async () => {
  let moves = 0;
  const options = {
    access,
    navigate: () => {
      moves++;
    },
    path: () => "/classroom",
    current: () => true,
    last: {},
  };
  await assert.rejects(
    () => applyDeepgramDraft(draft, { ...options, access: { ...access, permissions: [] } }),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(
    () => applyDeepgramDraft({ ...draft, clubId: "other-club" }, options),
    /NOT_AUTHORIZED/,
  );
  await assert.rejects(
    () => applyDeepgramDraft(draft, { ...options, current: () => false }),
    /STALE_PROPOSAL/,
  );
  assert.equal(moves, 0);
});
