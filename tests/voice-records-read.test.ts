import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceRecordsRead } from "../src/lib/voice/records-read.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const access: AccountAccess = {
  role: "admin",
  status: "active",
  clubId: "00000000-0000-4000-8000-000000000101",
  clubName: "Synthetic",
  clubLogo: null,
  permissions: ["manage_members", "manage_products"],
};
const rowId = "00000000-0000-4000-8000-000000000501";
test("registered reads use user JWT, explicit club, bounded projection and two-token member matching", async () => {
  for (const kind of ["members", "products", "categories", "stock", "membership_plans"]) {
    const result = await voiceRecordsRead(
      {
        url: "https://bnwanxbmprbymbutoths.supabase.co",
        key: "synthetic",
        jwt: "synthetic",
        access,
        fetch: async (u, r) => {
          const url = new URL(String(u));
          assert.equal(new Headers(r?.headers).get("Authorization"), "Bearer synthetic");
          assert.equal(r?.redirect, "manual");
          if (kind === "members") {
            assert.equal(url.pathname, "/rest/v1/rpc/snoop_voice_find_members");
            assert.equal(url.search, "");
            assert.equal(r?.method, "POST");
            assert.deepEqual(JSON.parse(String(r?.body)), {
              p_query: "Marco Rossi",
              p_club: access.clubId,
              p_limit: 7,
            });
          } else {
            assert.equal(url.searchParams.get("club_id"), "eq." + access.clubId);
            assert.equal(url.searchParams.get("limit"), "7");
          }
          return Response.json([
            {
              id: rowId,
              name: "Synthetic",
              first_name: "Marco",
              last_name: "Rossi",
              dni_number: "FORBIDDEN",
              email: "FORBIDDEN",
              stock: "10.000",
            },
          ]);
        },
      },
      { kind, query: "Marco Rossi" },
    );
    assert.equal(result.rows.length, 1);
    assert(!JSON.stringify(result).includes("FORBIDDEN"));
  }
});
test("permission denied, unregistered fields and filter injection stop before network access", async () => {
  let calls = 0;
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    access: { ...access, permissions: [] },
    fetch: async () => {
      calls++;
      return Response.json([]);
    },
  };
  await assert.rejects(
    () => voiceRecordsRead(options, { kind: "members", query: "Marco" }),
    /FORBIDDEN/,
  );
  await assert.rejects(() =>
    voiceRecordsRead({ ...options, access }, { kind: "members", query: "A),club_id.eq.other" }),
  );
  await assert.rejects(() =>
    voiceRecordsRead({ ...options, access }, { kind: "members", query: "Marco", club_id: "other" }),
  );
  assert.equal(calls, 0);
});
test("catalog punctuation is retained and wildcard characters are escaped as literal names", async () => {
  await voiceRecordsRead(
    {
      url: "https://bnwanxbmprbymbutoths.supabase.co",
      key: "synthetic",
      jwt: "synthetic",
      access,
      fetch: async (u) => {
        const url = new URL(String(u));
        assert.equal(url.searchParams.get("name"), "ilike.%Gelato #41 CBD 10\\%%");
        assert.equal(url.searchParams.get("club_id"), "eq." + access.clubId);
        return Response.json([]);
      },
    },
    { kind: "products", query: "Gelato #41 CBD 10%" },
  );
});

test("cash-session references are always scoped to the verified actor; discounts retain the club filter", async () => {
  let calls = 0;
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    actor: rowId,
    access: {
      ...access,
      permissions: [...access.permissions, "use_cash"] as AccountAccess["permissions"],
    },
    fetch: async (input: RequestInfo | URL) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("club_id"), "eq." + access.clubId);
      if (url.pathname.endsWith("/cash_sessions")) {
        assert.equal(url.searchParams.get("user_id"), "eq." + rowId);
        assert.equal(url.searchParams.get("order"), "opened_at.desc,id");
      }
      return Response.json([
        {
          id: rowId,
          status: "open",
          name: "Synthetic discount",
          percentage_basis_points: 1250,
          active: true,
          valid_from: null,
          valid_until: null,
        },
      ]);
    },
  };
  await voiceRecordsRead(options, { kind: "cash_sessions", query: "" });
  await voiceRecordsRead(options, { kind: "discounts", query: "Synthetic" });
  await assert.rejects(() =>
    voiceRecordsRead({ ...options, actor: undefined }, { kind: "cash_sessions", query: "" }),
  );
  assert.equal(calls, 2);
});
