import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceInspect } from "../src/lib/voice/inspect.server.ts";
import type { AccountAccess } from "../src/lib/access-context.ts";
const id = "00000000-0000-4000-8000-000000000501",
  actor = "00000000-0000-4000-8000-000000000001",
  club = "00000000-0000-4000-8000-000000000101";
const access: AccountAccess = {
  role: "admin",
  status: "active",
  clubId: club,
  clubName: "Synthetic",
  clubLogo: null,
  permissions: ["manage_members", "manage_products", "use_cash", "view_reports"],
};
const base = {
  url: "https://bnwanxbmprbymbutoths.supabase.co",
  key: "synthetic",
  jwt: "synthetic",
  actor,
  access,
  walletEnabled: true,
};
test("inspection rejects unavailable wallet, revoked permission and foreign records without a fabricated success", async () => {
  let calls = 0;
  const options = {
    ...base,
    fetch: async () => {
      calls++;
      return Response.json([]);
    },
  };
  await assert.rejects(
    () => voiceInspect({ ...options, walletEnabled: false }, { kind: "wallet_balance", id }),
    /FORBIDDEN/,
  );
  await assert.rejects(
    () =>
      voiceInspect(
        { ...options, access: { ...access, permissions: [] } },
        { kind: "stock_history", id },
      ),
    /FORBIDDEN/,
  );
  assert.equal(calls, 0);
  await assert.rejects(() => voiceInspect(options, { kind: "wallet_balance", id }), /FORBIDDEN/);
  assert.equal(calls, 1);
});
test("wallet read delegates to the existing staff RPC and returns only verified enabled balance fields", async () => {
  const seen: string[] = [];
  const result = await voiceInspect(
    {
      ...base,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        seen.push(url.pathname);
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer synthetic");
        assert.equal(init?.redirect, "manual");
        if (url.pathname.endsWith("/members")) {
          assert.equal(url.searchParams.get("club_id"), "eq." + club);
          assert.equal(url.searchParams.get("id"), "eq." + id);
          return Response.json([{ id }]);
        }
        assert.equal(url.pathname, "/rest/v1/rpc/socio_wallet_staff_member_state");
        assert.deepEqual(JSON.parse(String(init?.body)), { p_member_id: id });
        return Response.json({ enabled: true, clubEnabled: true, balanceCents: 1250 });
      },
    },
    { kind: "wallet_balance", id },
  );
  assert.deepEqual(result.summary, { enabled: true, clubEnabled: true, balanceCents: 1250 });
  assert.equal(seen.length, 2);
});
test("stock inspection is paginated and excludes private notes, actors and identifiers from model output", async () => {
  const result = await voiceInspect(
    {
      ...base,
      fetch: async (input) => {
        const url = new URL(String(input));
        assert.equal(url.searchParams.get("club_id"), "eq." + club);
        if (url.pathname.endsWith("/products")) return Response.json([{ id }]);
        assert.equal(url.searchParams.get("product_id"), "eq." + id);
        assert.equal(url.searchParams.get("select"), "id,delta,reason,created_at");
        return Response.json([
          {
            id,
            delta: "1.25",
            reason: "administrative_adjustment",
            created_at: "2026-11-24T12:00:00Z",
            notes: "PRIVATE",
            created_by: actor,
          },
        ]);
      },
    },
    { kind: "stock_history", id, page: 0 },
  );
  assert.deepEqual(result.summary, {
    hasMore: false,
    records: [{ delta: "1.25", reason: "administrative_adjustment", at: "2026-11-24T12:00:00Z" }],
  });
  assert(!JSON.stringify(result).includes("PRIVATE"));
  assert(!JSON.stringify(result).includes(actor));
  assert(!JSON.stringify(result).includes(id));
});

test("cash session inspector preserves the existing overnight reconciliation across the Madrid DST change", async () => {
  const sessionId = "00000000-0000-4000-8000-000000001001";
  const session = {
    id: sessionId,
    user_id: actor,
    opened_at: "2026-10-24T20:00:00Z",
    closed_at: "2026-10-25T02:30:00Z",
    opening_cash_cents: 5000,
    closing_cash_cents: 6000,
    closed_by: actor,
    status: "closed",
    notes: "PRIVATE NOTE",
  };
  const result = await voiceInspect(
    {
      ...base,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic");
        if (url.pathname.endsWith("/is_current_user_club_admin")) return Response.json(true);
        if (url.pathname.endsWith("/cash_sessions")) return Response.json([session]);
        if (url.pathname.endsWith("/orders"))
          return Response.json([
            {
              id: "00000000-0000-4000-8000-000000001002",
              club_id: club,
              total_cents: 2000,
              status: "completed",
              created_at: "2026-10-24T21:00:00Z",
              created_by: actor,
              cash_session_id: sessionId,
              payment_method: "card",
            },
          ]);
        if (url.pathname.endsWith("/membership_receipts"))
          return Response.json([
            {
              id: "00000000-0000-4000-8000-000000001003",
              club_id: club,
              member_id: id,
              amount_cents: 1000,
              recorded_at: "2026-10-25T01:30:00Z",
              recorded_by: actor,
              payment_method: "cash",
            },
          ]);
        if (url.pathname.endsWith("/profiles"))
          return Response.json([{ id: actor, full_name: "PRIVATE OPERATOR" }]);
        if (url.pathname.endsWith("/socio_wallet_cash_evidence"))
          return Response.json({ walletOrders: [], topups: [] });
        if (url.pathname.includes("/financial_order_")) return Response.json([]);
        throw Error("Unexpected query: " + url.pathname);
      },
    },
    { kind: "cash_session", id: sessionId },
  );
  const summary = result.summary as {
    recordedCents: number;
    openingCents: number;
    expected: number;
    difference: number;
  };
  assert.equal(summary.recordedCents, 3000);
  assert.equal(summary.openingCents, 5000);
  assert.equal(summary.expected, 6000);
  assert.equal(summary.difference, 0);
  assert(!JSON.stringify(result).includes("PRIVATE"));
});
test("member-history inspector calls the existing authorized history source and keeps personal names and notes out of the model DTO", async () => {
  const result = await voiceInspect(
    {
      ...base,
      fetch: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/snoop_access_context")) return Response.json(access);
        if (url.pathname.endsWith("/members")) return Response.json([{ id }]);
        if (url.pathname.endsWith("/orders"))
          return Response.json([
            {
              id: "00000000-0000-4000-8000-000000001004",
              club_id: club,
              member_id: id,
              total_cents: 1200,
              status: "cancelled",
              created_at: "2026-11-24T12:00:00Z",
              created_by: actor,
              cancelled_by: actor,
              cancelled_at: "2026-11-24T12:15:00Z",
              cancellation_reason: "PRIVATE REASON",
            },
          ]);
        if (url.pathname.includes("/financial_order_")) return Response.json([]);
        if (url.pathname.endsWith("/profiles"))
          return Response.json([{ id: actor, full_name: "PRIVATE NAME" }]);
        throw Error("Unexpected query: " + url.pathname);
      },
    },
    { kind: "member_history", id },
  );
  const summary = result.summary as {
    count: number;
    records: Array<{ status: string; cents: number }>;
  };
  assert.equal(summary.count, 1);
  assert.equal(summary.records[0].status, "cancelled");
  assert.equal(summary.records[0].cents, 1200);
  assert(!JSON.stringify(result.summary).includes("PRIVATE"));
  assert(!JSON.stringify(result.summary).includes(actor));
});
