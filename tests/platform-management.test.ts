import { test } from "node:test";
import assert from "node:assert/strict";
import { updatePlatformClub, PLATFORM_CLUB_FIELDS } from "../src/lib/platform-management.server.ts";
const values = {
  name: "Synthetic Club",
  city: null,
  logo_url: null,
  active: false,
  subscription_expires_at: null,
};
function fixture(isSuper: boolean) {
  let touched = false;
  const context = {
    userId: "synthetic",
    supabase: { rpc: async () => ({ data: isSuper, error: null }) } as any,
  };
  const admin = {
    from: (table: string) => {
      touched = true;
      assert.equal(table, "clubs");
      return {
        update: (v: typeof values) => {
          assert.deepEqual(v, values);
          return {
            eq: (key: string, id: string) => {
              assert.equal(key, "id");
              assert.equal(id, "synthetic-club");
              return {
                select: (fields: string) => {
                  assert.equal(fields, PLATFORM_CLUB_FIELDS);
                  return { single: async () => ({ data: { id, ...values }, error: null }) };
                },
              };
            },
          };
        },
      };
    },
  } as any;
  return { context, admin, touched: () => touched };
}
test("non-platform identities are rejected before the privileged client is touched", async () => {
  const f = fixture(false);
  await assert.rejects(
    updatePlatformClub(f.context, f.admin, "synthetic-club", values),
    /Forbidden/,
  );
  assert.equal(f.touched(), false);
});
test("platform update modifies only selected club metadata and returns no private data", async () => {
  const f = fixture(true);
  assert.equal(
    (await updatePlatformClub(f.context, f.admin, "synthetic-club", values)).active,
    false,
  );
  assert.ok(!/members|receipts|next_member|profiles|stock/.test(PLATFORM_CLUB_FIELDS));
});
