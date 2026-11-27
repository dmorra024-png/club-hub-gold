import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceRecordsRead, spokenMemberQuery } from "../src/lib/voice/records-read.server.ts";
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
test("wallet recharge references use only the existing authorized evidence RPC and never invent a missing history", async () => {
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    access: { ...access, permissions: [...access.permissions, "use_cash" as const] },
    walletEnabled: true,
  };
  let calls = 0;
  const fetcher: typeof fetch = async (url, request) => {
    calls++;
    assert.equal(String(url), options.url + "/rest/v1/rpc/socio_wallet_cash_evidence");
    assert.equal(request?.method, "POST");
    assert.equal(request?.redirect, "manual");
    const range = JSON.parse(String(request?.body));
    assert.equal((Date.parse(range.p_end) - Date.parse(range.p_start)) / 86400000, 365);
    return Response.json({
      walletOrders: [],
      topups: [
        {
          id: rowId,
          kind: "topup",
          amountCents: 1250,
          paymentMethod: "card",
          at: "2026-11-24T12:00:00.000Z",
          voided: false,
          actorId: "PRIVATE",
          memberId: "PRIVATE",
        },
      ],
    });
  };
  const read = await voiceRecordsRead(
    { ...options, fetch: fetcher },
    { kind: "wallet_topups", query: "" },
  );
  assert.equal(read.rows[0].amount_cents, 1250);
  assert(!JSON.stringify(read).includes("PRIVATE"));
  await assert.rejects(
    () =>
      voiceRecordsRead(
        { ...options, walletEnabled: false, fetch: fetcher },
        { kind: "wallet_topups", query: "" },
      ),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () =>
      voiceRecordsRead(
        { ...options, access, fetch: fetcher },
        { kind: "wallet_topups", query: "" },
      ),
    /FORBIDDEN/,
  );
  assert.equal(calls, 1);
  await assert.rejects(() =>
    voiceRecordsRead(
      { ...options, fetch: async () => Response.json({}) },
      { kind: "wallet_topups", query: "" },
    ),
  );
});
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

test("finance text is sent only in a POST body and staff cannot inspect administrative finance tables", async () => {
  let calls = 0;
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    access,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.pathname, "/rest/v1/rpc/snoop_voice_finance_search");
      assert.equal(url.search, "");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        p_query: "Synthetic office",
        p_club: access.clubId,
        p_limit: 7,
        p_kind: "expenses",
      });
      return Response.json([
        {
          id: rowId,
          description: "Synthetic office",
          amount_cents: 100,
          payment_method: "pendiente",
          occurred_on: "2026-11-24",
          cancelled_at: null,
          contact: "PRIVATE",
        },
      ]);
    },
  };
  const result = await voiceRecordsRead(options, { kind: "expenses", query: "Synthetic office" });
  assert(!JSON.stringify(result).includes("PRIVATE"));
  await assert.rejects(
    () =>
      voiceRecordsRead(
        { ...options, access: { ...access, role: "collaborator" } },
        { kind: "expenses", query: "Synthetic office" },
      ),
    /FORBIDDEN/,
  );
  assert.equal(calls, 1);
});

test("spoken member names remove ficha commands without changing club access or disclosing personal data to the model", async () => {
  assert.equal(spokenMemberQuery("abre la ficha del socio Marco Rossi"), "Marco Rossi");
  assert.equal(spokenMemberQuery("apri scheda socio Mario Bianchi"), "Mario Bianchi");
  let calls = 0;
  const result = await voiceRecordsRead({
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    access,
    fetch: async (target, init) => {
      calls++;
      assert.equal(new URL(String(target)).pathname, "/rest/v1/rpc/snoop_voice_find_members");
      assert.equal(new URL(String(target)).search, "");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.p_club, access.clubId);
      assert.equal(body.p_query, calls === 1 ? "Marco Rossi" : "Marco");
      if (calls === 1) return Response.json([]);
      return Response.json([{ id: rowId, first_name: "Marco", last_name: "Rossi", email: "PRIVATE" }]);
    },
  }, { kind: "members", query: "abre la ficha del socio Marco Rossi" });
  assert.equal(calls, 2);
  assert.equal(result.rows.length, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

// Protect member search normalization from swallowing surnames or adding personal
// data to an unscoped catalog query.
test("natural-language member lookup keeps full names and leading De surnames", () => {
  const cases: Array<[string, string]> = [
    ["Marco Rossi", "Marco Rossi"],
    ["De Luca", "De Luca"],
    ["busca socio Marco Rossi", "Marco Rossi"],
    ["busca la ficha del socio Marco Rossi", "Marco Rossi"],
    ["buscar socio de nombre De Luca", "De Luca"],
    ["apri scheda socio Mario Bianchi", "Mario Bianchi"],
    ["encuentra miembro llamado Juan Pérez", "Juan Pérez"],
  ];
  for (const [phrase, expected] of cases)
    assert.equal(spokenMemberQuery(phrase), expected, phrase);
});
