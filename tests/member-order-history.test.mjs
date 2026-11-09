import test from "node:test";
import assert from "node:assert/strict";
import {
  memberOrderHistory,
  annulFinancialRecord,
  activityFinancialDetail,
} from "../src/lib/member-order-history.server.ts";
const scope = { userId: "staff", clubId: "a" };
function fixture(
  role = "collaborator",
  permissions = ["manage_members", "use_cash"],
  clubId = "a",
) {
  const calls = [];
  const records = {
    members: [{ id: "m", club_id: "a" }],
    orders: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        club_id: "a",
        member_id: "m",
        created_by: "staff",
        created_at: "2026-11-08T11:00:00Z",
        total_cents: 1000,
        status: "completed",
        notes: "private unused data",
        cancelled_at: null,
      },
      {
        id: "other-actor",
        club_id: "a",
        member_id: "m",
        created_by: "other",
        created_at: "2026-11-08T11:00:00Z",
        total_cents: 999,
        status: "completed",
      },
      {
        id: "foreign",
        club_id: "b",
        member_id: "foreign-member",
        created_by: "foreign",
        total_cents: 99999,
        status: "completed",
      },
    ],
    financial_order_reversals: [],
    profiles: [{ id: "staff", full_name: "Personal de prueba" }],
    order_items: [],
  };
  const client = {
    rpc: async (name, args) => {
      calls.push({ rpc: name, args });
      return {
        data:
          name === "snoop_access_context"
            ? { role, status: role === "super_admin" ? "platform" : "active", clubId, permissions }
            : args.p_order_id,
      };
    },
    from(table) {
      let rows = records[table],
        single = false,
        start = 0,
        end = 999;
      const q = {
        select: () => q,
        eq: (k, v) => {
          calls.push({ table, key: k, value: v });
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        in: (k, v) => {
          rows = rows.filter((r) => v.includes(r[k]));
          return q;
        },
        order: () => q,
        range: (a, b) => {
          start = a;
          end = b;
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        then: (resolve) =>
          Promise.resolve(
            resolve({ data: single ? (rows[0] ?? null) : rows.slice(start, end + 1), error: null }),
          ),
      };
      return q;
    },
  };
  return { client, calls };
}
test("member-history requires member plus financial permission and matching verified club", async () => {
  for (const f of [
    fixture("collaborator", ["manage_members"]),
    fixture("super_admin"),
    fixture("admin", ["manage_members", "use_cash"], "b"),
  ])
    await assert.rejects(memberOrderHistory(f.client, scope, "m"), /permiso/);
  const f = fixture();
  await assert.rejects(
    memberOrderHistory(f.client, scope, "foreign-member"),
    /Socio no disponible/,
  );
});
test("staff sees only own financial records; DTO never returns raw member/club/notes", async () => {
  const f = fixture();
  const result = await memberOrderHistory(f.client, scope, "m");
  assert.equal(result.orders.length, 1);
  assert.equal(result.ownOnly, true);
  assert.equal(result.orders[0].operator, "Personal de prueba");
  assert.equal(result.orders[0].canCancel, false);
  assert.ok(
    f.calls.some((c) => c.table === "orders" && c.key === "created_by" && c.value === "staff"),
  );
  assert.doesNotMatch(JSON.stringify(result), /private unused data|club_id|member_id|99999/);
  await assert.rejects(
    memberOrderHistory(f.client, scope, "m", 0, "other-actor"),
    /Registro no disponible/,
  );
});
test("only verified club admin can annul; caller supplies no actor or club fields", async () => {
  await assert.rejects(
    annulFinancialRecord(fixture().client, scope, "m", "order", "Valid reason"),
    /administrador/,
  );
  const f = fixture("admin");
  await annulFinancialRecord(f.client, scope, "m", "order", "Valid reason");
  assert.deepEqual(f.calls.at(-1), {
    rpc: "annul_financial_order",
    args: { p_member_id: "m", p_order_id: "order", p_reason: "Valid reason" },
  });
  const history = await memberOrderHistory(f.client, scope, "m");
  assert.equal(history.orders.length, 2);
  assert.equal(history.orders[0].canCancel, true);
  assert.equal(
    history.orders[1].canCancel,
    false,
    "pre-migration records hide unavailable cancellation",
  );
});

test("activity and member profile use the same scoped detail and reject other employees' records", async () => {
  const f = fixture();
  const detail = await activityFinancialDetail(
    f.client,
    scope,
    "00000000-0000-4000-8000-000000000001",
  );
  const profile = await memberOrderHistory(
    f.client,
    scope,
    "m",
    0,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.deepEqual(detail.orders, profile.orders);
  assert.equal(detail.memberId, "m");
  await assert.rejects(
    activityFinancialDetail(f.client, scope, "other-actor"),
    /Registro no disponible/,
  );
  await assert.rejects(
    activityFinancialDetail(fixture("super_admin").client, scope, "foreign"),
    /permiso/,
  );
});
test("missing reversal migration disables cancellation and never invokes the legacy mutation", async () => {
  const f = fixture("admin"),
    from = f.client.from;
  f.client.from = (table) => {
    if (table !== "financial_order_reversals") return from(table);
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      then: (resolve) => Promise.resolve(resolve({ data: null, error: { code: "PGRST205" } })),
    };
    return q;
  };
  const history = await memberOrderHistory(f.client, scope, "m");
  assert.equal(history.orders[0].canCancel, false);
  await assert.rejects(
    annulFinancialRecord(f.client, scope, "m", "order", "Valid reason"),
    /no está activada/,
  );
  assert.ok(!f.calls.some((c) => c.rpc === "annul_financial_order"));
});
