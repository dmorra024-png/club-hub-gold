import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cashMovements, sessionRevenue, dayRevenue } from "../src/lib/cash-sessions.ts";
import { closeSession, openSession, loadCash } from "../src/lib/cash-sessions.server.ts";
import { administrativeIntent } from "../src/lib/administrative-voice.ts";
import { productFormVoice } from "../src/lib/product-form-voice.ts";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
test("sessions and 24-hour totals count completed orders/fees once, outside sessions included, no fixed shifts or opening money", () => {
  const sessions = [
    {
      id: "s1",
      user_id: "a",
      opened_at: "2026-01-10T09:00:00Z",
      closed_at: "2026-01-10T16:00:00Z",
      opening_cash_cents: 999999,
    },
    {
      id: "s2",
      user_id: "b",
      opened_at: "2026-01-10T16:00:00Z",
      closed_at: "2026-01-10T20:00:00Z",
      opening_cash_cents: 888888,
    },
  ];
  const order = {
    id: "o1",
    created_by: "a",
    created_at: "2026-01-10T10:00:00Z",
    cash_session_id: "s1",
    status: "completed",
    total_cents: 1000,
  };
  const movements = cashMovements(
    [
      order,
      order,
      { ...order, id: "cancelled", status: "cancelled", total_cents: 99999 },
      {
        ...order,
        id: "outside",
        cash_session_id: null,
        created_at: "2026-01-10T21:00:00Z",
        total_cents: 300,
      },
    ],
    [
      {
        id: "r1",
        recorded_by: "b",
        recorded_at: "2026-01-10T16:00:00Z",
        payment_method: "cash",
        amount_cents: 500,
      },
    ],
    sessions,
  );
  assert.equal(sessionRevenue(sessions[0], movements), 1000);
  assert.equal(sessionRevenue(sessions[1], movements), 500);
  assert.equal(dayRevenue(movements, "2026-01-09T23:00:00Z", "2026-01-10T23:00:00Z"), 1800);
  assert.equal(movements.filter((m) => !m.session_id).length, 1);
  const edge = { ...movements[0], at: "2026-01-09T23:00:00+00:00" };
  assert.equal(dayRevenue([edge], "2026-01-09T23:00:00.000Z", "2026-01-10T23:00:00Z"), edge.cents);
});
test("server close/open uses verified owner/club, server timestamp, status guard and no caller actor fields", async () => {
  const calls = [];
  const client = {
    from: (t) => {
      const q = {
        insert: (v) => (calls.push(["insert", v]), q),
        update: (v) => (calls.push(["update", v]), q),
        eq: (...v) => (calls.push(["eq", ...v]), q),
        select: () => q,
        single: async () => ({ data: { id: "s" } }),
        maybeSingle: async () => ({ data: { id: "s" } }),
      };
      return q;
    },
  };
  await openSession(client, { userId: "verified", clubId: "club" }, 100);
  await closeSession(
    client,
    { userId: "verified", clubId: "club" },
    "s",
    200,
    "nota",
    () => new Date("2026-01-10T12:34:00Z"),
  );
  assert.deepEqual(calls[0], [
    "insert",
    { user_id: "verified", club_id: "club", opening_cash_cents: 100 },
  ]);
  assert.ok(calls.some((c) => c[0] === "eq" && c[1] === "user_id" && c[2] === "verified"));
  assert.ok(calls.some((c) => c[1] === "status" && c[2] === "open"));
  assert.equal(calls.find((c) => c[0] === "update")[1].closed_at, "2026-01-10T12:34:00.000Z");
});
test("local product dictation separates name/category/quantity and conversational correction touches only one field", () => {
  assert.equal(administrativeIntent("informe de caja", "/").to, "/caja");
  assert.equal(administrativeIntent("report quote", "/").to, "/caja");
  const cats = [{ id: "c", name: "Material", unit_type: "unit", is_smokeable: false }];
  const r = productFormVoice(
    "Crea un prodotto Libreta, categoria Material, quantità venticinque",
    cats,
  );
  assert.equal(r.name, "Libreta");
  assert.equal(r.category_id, "c");
  assert.equal(r.stock, 25);
  assert.deepEqual(productFormVoice("No, la cantidad es cero", cats), { stock: 0 });
  assert.deepEqual(productFormVoice("No, il nome è Libreta Blu", cats), { name: "Libreta Blu" });
});
test("proposed closer audit preserves history, stamps server identity and rejects cross-club writes in PostgreSQL", async () => {
  const db = await separationDatabase();
  try {
    await db.exec(
      await readFile("supabase/migrations/20261106150000_platform_club_separation.sql", "utf8"),
    );
    for (let n = 1; n <= 3; n++)
      await db.exec(
        `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('${uid(n)}','test-${n}@example.test',now());`,
      );
    await db.exec(`INSERT INTO public.clubs(id,name,slug) VALUES('${uid(101)}','A','a'),('${uid(102)}','B','b');INSERT INTO public.user_roles(user_id,club_id,role,permissions) VALUES('${uid(1)}','${uid(101)}','admin','{}'),('${uid(2)}','${uid(101)}','collaborator','{use_cash}'),('${uid(3)}','${uid(102)}','collaborator','{use_cash}');
 INSERT INTO public.cash_sessions(id,club_id,user_id,status,closed_at) VALUES('${uid(201)}','${uid(101)}','${uid(1)}','closed',now());`);
    const before = (
      await db.query(
        "SELECT id,user_id,opened_at,closed_at,opening_cash_cents,closing_cash_cents FROM public.cash_sessions",
      )
    ).rows;
    await db.exec(await readFile("docs/sql/SNOOP_CASH_SESSION_AUDIT_PROPOSED.sql", "utf8"));
    assert.deepEqual(
      (
        await db.query(
          "SELECT id,user_id,opened_at,closed_at,opening_cash_cents,closing_cash_cents FROM public.cash_sessions",
        )
      ).rows,
      before,
    );
    async function actor(n, sql) {
      return db.transaction(async (tx) => {
        await tx.exec("SET LOCAL ROLE authenticated");
        await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
        return tx.query(sql);
      });
    }
    await actor(
      2,
      `INSERT INTO public.cash_sessions(id,club_id,user_id,opened_at) VALUES('${uid(202)}','${uid(101)}','${uid(2)}','2000-01-01');`,
    );
    let s = (await db.query(`SELECT * FROM public.cash_sessions WHERE id='${uid(202)}'`)).rows[0];
    assert.ok(new Date(s.opened_at).getUTCFullYear() > 2000);
    await actor(
      2,
      `UPDATE public.cash_sessions SET status='closed',closing_cash_cents=200,closed_by='${uid(3)}',closed_at='2000-01-01' WHERE id='${uid(202)}';`,
    );
    s = (await db.query(`SELECT * FROM public.cash_sessions WHERE id='${uid(202)}'`)).rows[0];
    assert.equal(s.closed_by, uid(2));
    assert.ok(new Date(s.closed_at).getUTCFullYear() > 2000);
    assert.equal(
      (await actor(3, `SELECT * FROM public.cash_sessions WHERE id='${uid(202)}'`)).rows.length,
      0,
    );
    await assert.rejects(
      actor(2, `UPDATE public.cash_sessions SET status='open' WHERE id='${uid(202)}'`),
      /immutable/,
    );
    await actor(
      2,
      `INSERT INTO public.cash_sessions(club_id,user_id) VALUES('${uid(101)}','${uid(2)}')`,
    );
  } finally {
    await db.close();
  }
});

test("server report reads every page, applies verified club/employee filters, and never writes or calls the fixed-shift RPC", async () => {
  const scope = { userId: "employee-a", clubId: "club-a" },
    calls = [];
  const records = {
    cash_sessions: [],
    orders: [
      ...Array.from({ length: 1001 }, (_, n) => ({
        id: `o${n}`,
        club_id: "club-a",
        created_by: "employee-a",
        created_at: "2026-01-10T12:00:00Z",
        status: "completed",
        total_cents: 1,
        cash_session_id: null,
      })),
      {
        id: "other",
        club_id: "club-a",
        created_by: "employee-b",
        status: "completed",
        total_cents: 9999,
      },
      {
        id: "foreign",
        club_id: "club-b",
        created_by: "employee-a",
        status: "completed",
        total_cents: 99999,
      },
    ],
    membership_receipts: [],
    financial_order_reversals: [],
    financial_order_refunds: [],
    profiles: [{ id: "employee-a", full_name: "Synthetic employee" }],
  };
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, "is_current_user_club_admin");
      assert.deepEqual(args, { _club_id: "club-a" });
      return { data: false };
    },
    from: (table) => {
      let values = records[table],
        from = 0,
        to = 999;
      const q = {
        select: () => q,
        eq: (key, v) => {
          calls.push([table, key, v]);
          values = values.filter((r) => r[key] === v);
          return q;
        },
        lt: () => q,
        gte: () => q,
        or: () => q,
        order: () => q,
        in: (key, v) => {
          values = values.filter((r) => v.includes(r[key]));
          return q;
        },
        range: (a, b) => {
          from = a;
          to = b;
          return q;
        },
        then: (resolve) => Promise.resolve(resolve({ data: values.slice(from, to + 1) })),
      };
      return q;
    },
  };
  const report = await loadCash(client, scope, "2026-01-10");
  assert.equal(report.movements.length, 1001);
  assert.equal(dayRevenue(report.movements, report.start, report.end), 1001);
  assert.ok(report.movements.every((m) => m.by === "employee-a"));
  assert.ok(calls.some((c) => c[0] === "orders" && c[1] === "club_id" && c[2] === "club-a"));
  assert.ok(calls.some((c) => c[0] === "orders" && c[1] === "created_by" && c[2] === "employee-a"));
});
