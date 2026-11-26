import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceCashToday } from "../src/lib/voice/cash-read.server.ts";
import { voiceCashOpenersToday } from "../src/lib/voice/cash-openers.server.ts";
import { madridToday } from "../src/lib/member-administration.ts";
test("voice cash uses actual report calculations with user JWT, never sends names or false zero on errors", async () => {
  let fail = false;
  const requests: URL[] = [];
  const at = madridToday() + "T12:00:00Z";
  const fetcher: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    requests.push(u);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-user-jwt");
    const table = u.pathname.split("/").at(-1);
    let data: unknown = [];
    if (table === "is_current_user_club_admin") data = true;
    else if (table === "orders") {
      if (fail)
        return Response.json({ code: "XX000", message: "synthetic failure" }, { status: 500 });
      const original = {
        id: "order-a",
        total_cents: 1000,
        created_at: at,
        created_by: "actor",
        status: "completed",
        cash_session_id: null,
      };
      data = [
        original,
        original,
        { ...original, id: "cancelled", status: "cancelled", total_cents: 10000 },
      ];
    } else if (table === "membership_receipts")
      data = [
        {
          id: "fee-a",
          amount_cents: 300,
          recorded_at: at,
          recorded_by: "actor",
          payment_method: "cash",
        },
      ];
    else if (table === "profiles") data = [{ id: "actor", full_name: "Synthetic private name" }];
    else
      assert(
        ["cash_sessions", "financial_order_reversals", "financial_order_refunds"].includes(table!),
        String(table),
      );
    if (!u.pathname.includes("/rpc/") && table !== "profiles")
      assert.equal(u.searchParams.get("club_id"), "eq.synthetic-club");
    return Response.json(data);
  };
  const result = await voiceCashToday(
    "https://bnwanxbmprbymbutoths.supabase.co",
    "synthetic-key",
    "synthetic-user-jwt",
    "actor",
    "synthetic-club",
    fetcher,
  );
  assert.equal(result.cents, 1300);
  assert.equal(result.scope, "club");
  assert(!JSON.stringify(result).includes("private"));
  assert(!JSON.stringify(result).includes("actor"));
  assert(requests.length > 3);
  fail = true;
  await assert.rejects(
    voiceCashToday(
      "https://bnwanxbmprbymbutoths.supabase.co",
      "synthetic-key",
      "synthetic-user-jwt",
      "actor",
      "synthetic-club",
      fetcher,
    ),
  );
});

test("Caja voice opener lookup denies missing permissions or foreign club before fetching any data", async () => {
  let calls = 0;
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    actor: "00000000-0000-4000-8000-000000000001",
    access: {
      role: "admin" as const,
      status: "active" as const,
      clubId: "00000000-0000-4000-8000-000000000002",
      clubName: "Synthetic",
      clubLogo: null,
      permissions: [] as Array<"use_cash">,
    },
    fetch: async () => { calls++; return Response.json([]); },
  };
  await assert.rejects(voiceCashOpenersToday(options), /VOICE_READ_FORBIDDEN/);
  await assert.rejects(voiceCashOpenersToday({ ...options, access: { ...options.access, clubId: null, permissions: ["use_cash"] } }), /VOICE_READ_FORBIDDEN/);
  await assert.rejects(voiceCashOpenersToday({ ...options, actor: "not-an-id", access: { ...options.access, permissions: ["use_cash"] } }), /VOICE_READ_FORBIDDEN/);
  assert.equal(calls, 0);
});
