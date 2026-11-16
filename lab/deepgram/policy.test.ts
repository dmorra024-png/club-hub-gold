import test from "node:test";
import assert from "node:assert/strict";
import { authorizeProposal, agentSettings, LAB_ACCESS } from "./policy.ts";
const draft = {
  intent: "member",
  target: "member_create",
  member: { first_name: "Luca", last_name: "Prova", birth_date: "1995-03-12" },
  product: {},
  query: null,
  declined: [],
  question: "",
  asking: null,
};
test("SNOOP validates a synthetic draft without allowing a save", () => {
  const r = authorizeProposal(draft);
  assert(r.ok);
  assert.equal(r.persisted, false);
  assert.equal(r.requiresConfirmation, true);
});
test("SNOOP rejects unknown economic, stock and execution fields", () => {
  for (const extra of [{ save: true }, { amount: 20 }, { stock: 5 }, { execute: "pay" }])
    assert.equal(authorizeProposal({ ...draft, ...extra }).ok, false);
});
test("lab role cannot access cash/reports and inactive access is rejected", () => {
  for (const target of ["cash", "cash_report", "reports"])
    assert.equal(authorizeProposal({ ...draft, intent: "navigate", target, member: {} }).ok, false);
  assert.equal(authorizeProposal(draft, { ...LAB_ACCESS, status: "suspended" }).ok, false);
  assert.equal(authorizeProposal(draft, { ...LAB_ACCESS, clubId: null }).ok, false);
});
test("malformed fields and mixed intent are rejected by existing SNOOP schema", () => {
  assert.equal(authorizeProposal({ ...draft, member: { birth_date: "yesterday" } }).ok, false);
  assert.equal(authorizeProposal({ ...draft, intent: "navigate" }).ok, false);
});
test("Deepgram uses explicit IT/ES streaming voices with MIP opt-out and one proposal-only tool", () => {
  for (const language of ["it", "es"] as const) {
    const c = agentSettings(language, 48000);
    assert.equal(c.mip_opt_out, true);
    assert.deepEqual(c.agent.listen.provider.language_hints, [language]);
    assert.equal(c.agent.speak.provider.version, "v2");
    assert(c.agent.speak.provider.model.endsWith("-" + language));
    assert.equal(c.agent.think.functions.length, 1);
    assert.equal(c.agent.think.functions[0].defer_until_eot, true);
    assert.equal(c.audio.input.sample_rate, 48000);
    assert.equal(c.audio.output.sample_rate, 24000);
    assert(!JSON.stringify(c).includes("api_key"));
  }
});
