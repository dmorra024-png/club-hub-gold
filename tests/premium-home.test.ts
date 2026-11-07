import test from "node:test";
import assert from "node:assert/strict";
import { activitySources, activityRows, relativeActivityTime } from "../src/lib/club-activity.ts";
import { accessRedirect, type AccountAccess } from "../src/lib/access-context.ts";
const access: AccountAccess = {
  role: "collaborator",
  clubId: "synthetic-club",
  clubName: "Synthetic",
  clubLogo: null,
  status: "active",
  permissions: ["manage_products"],
};
test("premium activity never requests member or financial sources without their permissions", () => {
  assert.deepEqual(activitySources(access), ["products", "stock_movements"]);
  assert.deepEqual(activitySources({ ...access, permissions: [] }), []);
  for (const status of ["expired", "suspended", "unassigned", "platform"] as const)
    assert.deepEqual(activitySources({ ...access, status }), []);
  assert.deepEqual(activitySources({ ...access, role: "super_admin" }), []);
  assert.deepEqual(activitySources({ ...access, clubId: null }), []);
  assert.deepEqual(activitySources({ ...access, permissions: ["view_reports"] }), [
    "orders",
    "membership_receipts",
  ]);
});
test("activity derives timestamps, amounts and descriptions from rows without exposing free text or identities", () => {
  const at = "2026-11-07T10:00:00Z";
  assert.deepEqual(
    activityRows("members", [
      {
        id: "one",
        created_at: at,
        member_number: "0007",
        first_name: "PRIVATE",
        dni_number: "PRIVATE",
      },
    ]),
    [
      {
        key: "members:one",
        at,
        kind: "member",
        title: "Nuevo socio registrado",
        detail: "Nº 0007",
        href: "/soci/gestisci",
      },
    ],
  );
  const [cash] = activityRows(
    "membership_receipts",
    [{ id: "fee", recorded_at: at, amount_cents: 1234 }],
    false,
  );
  assert.match(cash.detail, /12,34/);
  assert.equal(cash.href, "/ajustes/informes");
  assert.deepEqual(activityRows("members", [{ id: "bad", created_at: "invalid" }]), []);
  assert.equal(relativeActivityTime(at, Date.parse(at) + 720000), "Hace 12 min");
});
test("personal profile is available for own-account recovery without unlocking operational routes", () => {
  assert.equal(accessRedirect(access, "/perfil"), null);
  assert.equal(
    accessRedirect({ ...access, status: "suspended", permissions: [] }, "/perfil"),
    null,
  );
  assert.equal(
    accessRedirect({ ...access, status: "suspended", permissions: [] }, "/productos"),
    "/club-status",
  );
  assert.equal(accessRedirect(access, "/soci"), "/");
  assert.equal(
    accessRedirect({ ...access, role: "super_admin", status: "platform" }, "/perfil"),
    null,
  );
  assert.equal(
    accessRedirect({ ...access, role: "super_admin", status: "platform" }, "/soci"),
    "/snoop-admin",
  );
});
