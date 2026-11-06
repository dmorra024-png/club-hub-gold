import { test } from "node:test";
import assert from "node:assert/strict";
import { accessRedirect, parseAccountAccess } from "../src/lib/access-context.ts";
test("platform account cannot inherit club permissions or enter operational routes", () => {
  const a = parseAccountAccess({
    role: "super_admin",
    clubId: "private-club",
    status: "active",
    permissions: ["manage_members", "use_cash"],
  });
  assert.equal(a.clubId, null);
  assert.deepEqual(a.permissions, []);
  for (const p of ["/", "/soci", "/cuotas", "/productos", "/ajustes"])
    assert.equal(accessRedirect(a, p), "/snoop-admin");
  assert.equal(accessRedirect(a, "/snoop-admin"), null);
});
test("staff navigation enforces only its granted permissions", () => {
  const a = parseAccountAccess({
    role: "collaborator",
    clubId: "a",
    status: "active",
    permissions: ["view_reports"],
  });
  assert.equal(accessRedirect(a, "/ajustes/informes"), null);
  for (const p of ["/soci", "/productos", "/caja", "/ajustes/colaboradores", "/snoop-admin"])
    assert.equal(accessRedirect(a, p), "/");
  assert.equal(accessRedirect(a, "/cuotas"), null);
});
test("suspended, expired and unassigned users retain account status but no operations", () => {
  for (const status of ["suspended", "expired", "unassigned"]) {
    const a = parseAccountAccess({
      role: "admin",
      clubId: "a",
      status,
      permissions: ["manage_members"],
    });
    assert.deepEqual(a.permissions, []);
    assert.equal(accessRedirect(a, "/soci"), "/club-status");
    assert.equal(accessRedirect(a, "/club-status"), null);
  }
});
