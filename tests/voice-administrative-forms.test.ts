import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AdministrativeDraft,
  administrativeFormTargets,
} from "../src/lib/voice/administrative-forms.ts";
import { authorizeProposal } from "../src/lib/voice/agent-settings.server.ts";
import { applyDeepgramDraft } from "../src/lib/deepgram-draft-actions.ts";
import { applicationPorts } from "../src/lib/voice/application-ports.ts";
const admin: any = {
  role: "admin",
  status: "active",
  clubId: "synthetic",
  permissions: ["manage_members", "use_cash"],
  clubName: null,
  clubLogo: null,
};
const request = (kind: keyof typeof administrativeFormTargets, fields: Record<string, string>) => ({
  intent: "administrative_draft",
  target: administrativeFormTargets[kind],
  member: {},
  product: {},
  query: null,
  declined: [],
  question: "Revisa el formulario",
  asking: null,
  form: { kind, fields },
});
const cases = {
  collaborator_invite: { first_name: "Ana", last_name: "Prueba", email: "synthetic@example.test" },
  membership_fee: { name: "Semestral", duration_days: "180", price: "30,25" },
  discount: {
    name: "Sintético",
    percentage: "12,50",
    valid_from: "2026-11-18",
    valid_until: "2026-12-31",
  },
  member_discount: { discount_name: "Sintético" },
  wallet_topup: { amount: "50,25" },
};
test("every administrative draft is typed, permission checked and routed to a registered existing form", async () => {
  for (const [kind, fields] of Object.entries(cases)) {
    const value = request(kind as keyof typeof cases, fields);
    assert(AdministrativeDraft.safeParse(value.form).success);
    const result = authorizeProposal(value, admin);
    assert(result.ok);
    assert(result.requiresConfirmation);
    assert.equal(result.persisted, false);
    const initial: Record<string, string> =
      kind === "membership_fee" ? { name: "", duration_days: "30", price: "20" } : {};
    let current: Record<string, string> = { ...initial };
    let path = value.target
      ? (
          {
            collaborators: "/ajustes/colaboradores",
            membership_fees: "/ajustes/cuotas",
            general_settings: "/ajustes/generales",
          } as any
        )[value.target]
      : "/soci/synthetic";
    const remove = applicationPorts.register("admin-form-test", "admin." + kind, {
      baseline: () => initial,
      snapshot: () => current,
      patch: (patch) => {
        current = { ...current, ...patch };
      },
    });
    try {
      const options = {
        access: admin,
        owner: "admin-form-test",
        current: () => true,
        path: () => path,
        navigate: (target: string) => {
          path = target;
        },
        last: {},
      };
      const applied = await applyDeepgramDraft(value, options);
      assert.equal(applied.applied.length, Object.keys(fields).length);
      for (const [key, field] of Object.entries(fields))
        assert.equal(current[key], kind === "membership_fee" && key === "price" ? "30.25" : field);
      if (kind === "membership_fee") {
        await applyDeepgramDraft(request("membership_fee", { price: "32,50" }), options);
        await applyDeepgramDraft(request("membership_fee", { price: "33,50" }), options);
        assert.equal(current.price, "33.5");
      }
      const collaborator = { ...admin, role: "collaborator" };
      assert.equal(authorizeProposal(value, collaborator).ok, kind === "wallet_topup");
      assert(!authorizeProposal(value, { ...admin, status: "suspended" }).ok);
      assert(!authorizeProposal(value, { ...admin, clubId: null }).ok);
    } finally {
      remove();
    }
  }
});
test("administrative drafts cannot change permissions, secrets, IDs, activate wallets or cross form boundaries", () => {
  for (const [kind, fields] of Object.entries(cases)) {
    for (const key of [
      "permissions",
      "club_id",
      "member_id",
      "role",
      "password",
      "api_key",
      "enabled",
      "confirmed",
    ])
      assert(
        !AdministrativeDraft.safeParse({ kind, fields: { ...fields, [key]: "true" } }).success,
      );
    assert(
      !authorizeProposal({ ...request(kind as keyof typeof cases, fields), target: "home" }, admin)
        .ok,
    );
  }
  for (const fields of [
    { price: "-1" },
    { price: "1.234" },
    { duration_days: "0" },
    { duration_days: "9999" },
  ])
    assert(!AdministrativeDraft.safeParse({ kind: "membership_fee", fields }).success);
  assert(
    !AdministrativeDraft.safeParse({ kind: "discount", fields: { percentage: "101" } }).success,
  );
  assert(
    !AdministrativeDraft.safeParse({ kind: "discount", fields: { valid_from: "2026-02-30" } })
      .success,
  );
  assert(
    !authorizeProposal(request("wallet_topup", { amount: "10" }), {
      ...admin,
      permissions: ["manage_members"],
    }).ok,
  );
});
