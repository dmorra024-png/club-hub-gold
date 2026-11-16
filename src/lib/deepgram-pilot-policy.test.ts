import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deepgramPilotAllowed, normalizedPilotNames } from "./deepgram-pilot-policy.ts";
import type { AccountAccess } from "./access-context.ts";

const admin: AccountAccess = {
  role: "admin",
  clubId: "club-one",
  clubName: "Club",
  clubLogo: null,
  status: "active",
  permissions: ["manage_products"],
};
const flags = {
  enabled: "true",
  allowedUserId: "owner-one",
  allowedClubId: "club-one",
};

test("Deepgram pilot is off unless single-account server flags match", () => {
  assert.equal(deepgramPilotAllowed(admin, "owner-one", flags), true);
  assert.equal(deepgramPilotAllowed(admin, "owner-one", { ...flags, enabled: "false" }), false);
  assert.equal(deepgramPilotAllowed(admin, "someone-else", flags), false);
  assert.equal(deepgramPilotAllowed(admin, "owner-one", { ...flags, allowedClubId: "other" }), false);
  assert.equal(deepgramPilotAllowed({ ...admin, status: "suspended" }, "owner-one", flags), false);
  assert.equal(deepgramPilotAllowed({ ...admin, role: "collaborator" }, "owner-one", flags), false);
  assert.equal(deepgramPilotAllowed({ ...admin, role: "super_admin" }, "owner-one", flags), false);
  assert.equal(deepgramPilotAllowed({ ...admin, permissions: [] }, "owner-one", flags), false);
});

test("name-only catalog strips unsafe, duplicate and oversized entries", () => {
  assert.deepEqual(
    normalizedPilotNames([
      { name: "Flores" },
      { name: " flores " },
      { name: "Amnesia Haze" },
      { name: "<private>" },
      { name: "X" },
      { name: "A".repeat(61) },
      { id: 15 },
    ]),
    ["Flores", "Amnesia Haze"],
  );
  assert.deepEqual(normalizedPilotNames([{ name: "A" }, { name: "Bebidas" }], 1), ["Bebidas"]);
});
