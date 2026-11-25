import { test } from "node:test";
import assert from "node:assert/strict";
import type { AccountAccess } from "../src/lib/access-context.ts";
import { voiceMemberRequirements } from "../src/lib/voice/member-requirements.server.ts";
const access: AccountAccess = {
  role: "admin",
  status: "active",
  clubId: "00000000-0000-4000-8000-000000000101",
  clubName: null,
  clubLogo: null,
  permissions: ["manage_members"],
};
const base = {
  url: "https://bnwanxbmprbymbutoths.supabase.co",
  key: "synthetic",
  jwt: "synthetic",
  access,
};
test("member requirements reuse defaults and authoritative configuration without collecting any personal data", async () => {
  const initial = await voiceMemberRequirements({ ...base, fetch: async () => Response.json([]) });
  assert.deepEqual(initial.humanInput, ["dni_number", "dni_photo", "signature"]);
  assert(!initial.registrationExecutionEligible);
  const result = await voiceMemberRequirements({
    ...base,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("club_id"), "eq." + access.clubId);
      assert.equal(init?.redirect, "manual");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic");
      return Response.json(
        ["dni_number", "dni_photo", "signature", "phone"].map((field_key) => ({
          field_key,
          visible: true,
          required: false,
        })),
      );
    },
  });
  assert(result.registrationExecutionEligible);
  assert(!result.required.includes("phone"));
  assert(result.optional.includes("phone"));
  assert(result.required.includes("city"));
  assert(result.optional.includes("avalador"));
  assert(!JSON.stringify(result).includes(access.clubId!));
});
test("missing permission, unknown fields, duplicated configuration and network errors fail closed", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      voiceMemberRequirements({
        ...base,
        access: { ...access, permissions: [] },
        fetch: async () => {
          calls++;
          return Response.json([]);
        },
      }),
    /FORBIDDEN/,
  );
  assert.equal(calls, 0);
  for (const rows of [
    [{ field_key: "unknown", visible: true, required: true }],
    [
      { field_key: "phone", visible: true, required: false },
      { field_key: "phone", visible: false, required: true },
    ],
  ])
    await assert.rejects(
      () => voiceMemberRequirements({ ...base, fetch: async () => Response.json(rows) }),
      /UNKNOWN/,
    );
  await assert.rejects(
    () =>
      voiceMemberRequirements({ ...base, fetch: async () => new Response(null, { status: 503 }) }),
    /UNAVAILABLE/,
  );
});
