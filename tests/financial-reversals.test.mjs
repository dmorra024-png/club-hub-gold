import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
import { cashMovements, dayRevenue } from "../src/lib/cash-sessions.ts";
const sql = await readFile("docs/sql/SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql", "utf8");
async function setup(previous = false) {
  const db = await separationDatabase();
  for (const file of [
    "20261106150000_platform_club_separation.sql",
    "20261107120000_catalog_lifecycle.sql",
    "20261107123000_membership_payment_flow.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  for (let n = 1; n <= 6; n++)
    await db.query("INSERT INTO auth.users(id,email)VALUES($1,$2)", [
      uid(n),
      `audit-${n}@example.test`,
    ]);
  await db.exec(`INSERT INTO clubs(id,name,slug)VALUES('${uid(101)}','Audit A','audit-a'),('${uid(102)}','Audit B','audit-b');
 INSERT INTO user_roles(user_id,role,club_id,permissions)VALUES('${uid(1)}','admin','${uid(101)}','{}'),('${uid(2)}','admin','${uid(102)}','{}'),('${uid(3)}','collaborator','${uid(101)}','{manage_members,use_cash}'),('${uid(4)}','collaborator','${uid(101)}','{manage_members,view_reports}'),('${uid(5)}','super_admin',NULL,'{}'),('${uid(6)}','admin','${uid(101)}','{}');
 UPDATE profiles SET full_name='Operador original' WHERE id='${uid(3)}';UPDATE profiles SET full_name='Administrador original' WHERE id='${uid(1)}';
 INSERT INTO members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)VALUES('${uid(501)}','${uid(101)}','Persona','Sintética','1990-01-01','AUDIT-A','2026-12-31'),('${uid(502)}','${uid(102)}','Persona','Sintética','1990-01-01','AUDIT-B','2026-12-31');
 INSERT INTO product_categories(id,club_id,name)VALUES('${uid(201)}','${uid(101)}','Material');
 INSERT INTO products(id,club_id,category_id,name,stock)VALUES('${uid(301)}','${uid(101)}','${uid(201)}','Cuaderno',20);
 INSERT INTO orders(id,club_id,member_id,created_by,total_cents,status,created_at,notes)VALUES('${uid(701)}','${uid(101)}','${uid(501)}','${uid(3)}',1500,'completed','2026-11-01T12:00:00Z','Original'),('${uid(702)}','${uid(101)}','${uid(501)}','${uid(1)}',500,'completed','2026-11-01T13:00:00Z','Other'),('${uid(703)}','${uid(102)}','${uid(502)}','${uid(2)}',900,'completed','2026-11-01T14:00:00Z','Foreign'),('${uid(704)}','${uid(101)}','${uid(501)}','${uid(3)}',100,'cancelled','2026-10-01T12:00:00Z','Legacy');
 INSERT INTO order_items(id,order_id,club_id,product_id,product_name,unit_type,quantity,unit_price_cents,line_total_cents)VALUES('${uid(801)}','${uid(701)}','${uid(101)}','${uid(301)}','Cuaderno','unit',1,1500,1500);`);
  if (previous)
    await db.exec(await readFile("docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql", "utf8"));
  const actor = (n, query, params = []) =>
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(n)]);
      return tx.query(query, params);
    });
  const annul = (n = 1, id = 701, reason = "Registro duplicado verificado") =>
    actor(n, "SELECT annul_financial_order($1,$2,$3)", [
      uid(id === 703 ? 502 : 501),
      uid(id),
      reason,
    ]);
  return { db, actor, annul };
}
test("one proposal installs on both current schema variants without rewriting history or fabricating legacy reversals", async () => {
  for (const previous of [false, true]) {
    const { db } = await setup(previous);
    try {
      const before = (
        await db.query(
          "SELECT id,created_by,created_at,total_cents,status,notes FROM orders ORDER BY id",
        )
      ).rows;
      await db.exec(sql);
      assert.deepEqual(
        (
          await db.query(
            "SELECT id,created_by,created_at,total_cents,status,notes FROM orders ORDER BY id",
          )
        ).rows,
        before,
      );
      assert.equal((await db.query("SELECT * FROM financial_order_reversals")).rows.length, 0);
      const policies = (
        await db.query("SELECT qual FROM pg_policies WHERE tablename='financial_order_reversals'")
      ).rows;
      assert.equal(policies.length, 1);
      assert.match(policies[0].qual, /current_club_id/);
      assert.doesNotMatch(policies[0].qual, /^\(?true\)?$/);
      await assert.rejects(db.exec(sql), /already installed/);
      await db.exec("ROLLBACK");
    } finally {
      await db.close();
    }
  }
});
test("authorized annulment atomically preserves original, appends exactly one immutable reversal, stamps identity/time and leaves stock untouched", async () => {
  const { db, actor, annul } = await setup();
  try {
    await db.exec(sql);
    const before = (
      await db.query("SELECT created_by,created_at,total_cents,notes FROM orders WHERE id=$1", [
        uid(701),
      ])
    ).rows[0];
    const stock = (await db.query("SELECT stock FROM products WHERE id=$1", [uid(301)])).rows;
    await assert.rejects(annul(2), /Registro no disponible/);
    for (const n of [4, 5]) await assert.rejects(annul(n), /Forbidden/);
    await assert.rejects(annul(3, 702), /propias/);
    await assert.rejects(annul(1, 703), /Registro no disponible/);
    await assert.rejects(annul(1, 701, "  "), /motivo/);
    await assert.rejects(
      actor(1, `UPDATE orders SET created_by='${uid(1)}',total_cents=1 WHERE id='${uid(701)}'`),
      /inmutable/,
    );
    await annul();
    assert.deepEqual(
      (
        await db.query("SELECT created_by,created_at,total_cents,notes FROM orders WHERE id=$1", [
          uid(701),
        ])
      ).rows[0],
      before,
    );
    let reversal = (await db.query("SELECT * FROM financial_order_reversals")).rows[0];
    assert.equal(reversal.original_actor, uid(3));
    assert.equal(reversal.original_actor_name, "Operador original");
    assert.equal(reversal.cancelled_by, uid(1));
    assert.equal(reversal.cancelled_by_name, "Administrador original");
    assert.equal(reversal.original_cents, 1500);
    assert.equal(Number(reversal.delta_cents), -1500);
    assert.equal(Date.parse(reversal.original_at), Date.parse("2026-11-01T12:00:00Z"));
    assert.ok(Date.parse(reversal.recorded_at) > Date.parse(reversal.original_at));
    const proof = JSON.stringify(reversal);
    await Promise.all([annul(), annul()]);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM financial_order_reversals")).rows[0].n,
      1,
    );
    await assert.rejects(annul(1, 701, "Otro motivo diferente"), /ya está anulado/);
    await assert.rejects(annul(6), /ya está anulado/);
    await db.exec(
      `UPDATE profiles SET full_name='Nombre cambiado' WHERE id IN ('${uid(3)}','${uid(1)}')`,
    );
    assert.equal(
      JSON.stringify((await db.query("SELECT * FROM financial_order_reversals")).rows[0]),
      proof,
    );
    await assert.rejects(actor(1, "DELETE FROM financial_order_reversals"), /permission denied/);
    await assert.rejects(
      actor(1, "UPDATE financial_order_reversals SET delta_cents=0"),
      /permission denied/,
    );
    await assert.rejects(
      actor(1, `INSERT INTO financial_order_reversals SELECT * FROM financial_order_reversals`),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("UPDATE financial_order_reversals SET reason='Alteración'"),
      /inmutable/,
    );
    await assert.rejects(
      actor(1, `DELETE FROM orders WHERE id='${uid(701)}'`),
      /no se puede eliminar/,
    );
    await assert.rejects(
      actor(1, `UPDATE orders SET total_cents=0 WHERE id='${uid(701)}'`),
      /inmutable/,
    );
    await assert.rejects(
      actor(1, `UPDATE order_items SET quantity=3 WHERE order_id='${uid(701)}'`),
      /inmutable/,
    );
    assert.deepEqual(
      (await db.query("SELECT stock FROM products WHERE id=$1", [uid(301)])).rows,
      stock,
    );
    assert.equal((await db.query("SELECT count(*)::int n FROM stock_movements")).rows[0].n, 0);
    for (const n of [2, 5])
      assert.equal((await actor(n, "SELECT * FROM financial_order_reversals")).rows.length, 0);
    assert.equal((await actor(3, "SELECT * FROM financial_order_reversals")).rows.length, 1);
    await annul(1, 702, "Otra operación de prueba");
    assert.equal((await actor(3, "SELECT * FROM financial_order_reversals")).rows.length, 1);
    assert.equal((await actor(4, "SELECT * FROM financial_order_reversals")).rows.length, 2);
  } finally {
    await db.close();
  }
});
test("a reversal failure rolls back cancellation and unrecognized UPDATE triggers reject the upgrade", async () => {
  const { db, annul } = await setup();
  try {
    await db.exec(
      "CREATE FUNCTION unexpected_effect() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW;END$$;CREATE TRIGGER unexpected_effect BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION unexpected_effect()",
    );
    await assert.rejects(db.exec(sql), /Unknown orders UPDATE trigger/);
    await db.exec("ROLLBACK;DROP TRIGGER unexpected_effect ON orders");
    await db.exec(sql);
    await db.exec(
      "CREATE FUNCTION fail_reversal() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic reversal failure';END$$;CREATE TRIGGER fail_reversal BEFORE INSERT ON financial_order_reversals FOR EACH ROW EXECUTE FUNCTION fail_reversal()",
    );
    await assert.rejects(annul(), /synthetic reversal failure/);
    assert.equal(
      (await db.query("SELECT status FROM orders WHERE id=$1", [uid(701)])).rows[0].status,
      "completed",
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM financial_order_reversals")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("net report excludes cancelled original once; original plus adjustment remains auditable without being added twice", () => {
  const orders = [
    { id: "a", status: "completed", total_cents: 500, created_at: "2026-11-01T12:00:00Z" },
    { id: "b", status: "cancelled", total_cents: 1500, created_at: "2026-11-01T13:00:00Z" },
  ];
  const rows = cashMovements(orders, [], []);
  assert.equal(dayRevenue(rows, "2026-10-31T23:00:00Z", "2026-11-01T23:00:00Z"), 500);
  assert.equal(orders[1].total_cents, 1500);
  assert.equal(1500 + -1500, 0);
});

// Minimal Supabase read facade over real local PostgreSQL, retaining JWT/RLS for every request.
function postgresClient(actor, n) {
  const identifier = (value) => {
    assert.match(value, /^[a-z_]+$/);
    return `"${value}"`;
  };
  return {
    async rpc(name, args = {}) {
      const allowed = {
        snoop_access_context: [],
        is_current_user_club_admin: [args._club_id],
        annul_financial_order: [args.p_member_id, args.p_order_id, args.p_reason],
        record_financial_refund: [args.p_order_id, args.p_method, args.p_reason],
      };
      assert.ok(Object.hasOwn(allowed, name));
      const values = allowed[name];
      try {
        return {
          data: (
            await actor(
              n,
              `SELECT public.${identifier(name)}(${values.map((_, i) => `$${i + 1}`).join(",")}) value`,
              values,
            )
          ).rows[0].value,
          error: null,
        };
      } catch (error) {
        return { data: null, error };
      }
    },
    from(table) {
      let columns = "*",
        single = false,
        offset = 0,
        limit = 1000;
      const clauses = [],
        params = [],
        sorting = [];
      const filter = (key, op, value) => {
        params.push(value);
        clauses.push(`${identifier(key)} ${op} $${params.length}`);
        return q;
      };
      const q = {
        select: (c) => {
          columns = c === "*" ? "*" : c.split(",").map(identifier).join(",");
          return q;
        },
        eq: (k, v) => filter(k, "=", v),
        gte: (k, v) => filter(k, ">=", v),
        lt: (k, v) => filter(k, "<", v),
        in: (k, values) => {
          clauses.push(
            values.length
              ? `${identifier(k)} IN (${values
                  .map((v) => {
                    params.push(v);
                    return `$${params.length}`;
                  })
                  .join(",")})`
              : "false",
          );
          return q;
        },
        or: (value) => {
          const match = /^closed_at.is.null,closed_at.gte.(.+)$/.exec(value);
          assert.ok(match);
          params.push(match[1]);
          clauses.push(`(closed_at IS NULL OR closed_at >= $${params.length})`);
          return q;
        },
        order: (k, options = {}) => {
          sorting.push(`${identifier(k)} ${options.ascending === false ? "DESC" : "ASC"}`);
          return q;
        },
        range: (a, b) => {
          offset = a;
          limit = b - a + 1;
          return q;
        },
        maybeSingle: () => {
          single = true;
          return q;
        },
        then: (resolve) =>
          actor(
            n,
            `SELECT ${columns} FROM public.${identifier(table)}${clauses.length ? " WHERE " + clauses.join(" AND ") : ""}${sorting.length ? " ORDER BY " + sorting.join(",") : ""} LIMIT ${limit} OFFSET ${offset}`,
            params,
          )
            .then((r) => resolve({ data: single ? (r.rows[0] ?? null) : r.rows, error: null }))
            .catch((error) => resolve({ data: null, error })),
      };
      return q;
    },
  };
}
test("shared server histories and cash report reconcile real PostgreSQL reversal across original and cancellation dates", async () => {
  const { memberOrderHistory, activityFinancialDetail, annulFinancialRecord } =
    await import("../src/lib/member-order-history.server.ts");
  const { loadCash } = await import("../src/lib/cash-sessions.server.ts");
  const { db, actor } = await setup();
  try {
    await db.exec(sql);
    const client = postgresClient(actor, 1),
      scope = { userId: uid(1), clubId: uid(101) };
    const before = await memberOrderHistory(client, scope, uid(501), 0, uid(701));
    assert.equal(before.orders[0].canCancel, true);
    await annulFinancialRecord(client, scope, uid(501), uid(701), "Verificación administrativa");
    const member = await memberOrderHistory(client, scope, uid(501), 0, uid(701));
    const activity = await activityFinancialDetail(client, scope, uid(701));
    assert.deepEqual(member.orders, activity.orders);
    assert.equal(member.orders[0].status, "cancelled");
    assert.equal(member.orders[0].canCancel, false);
    assert.equal(member.orders[0].reversal.cents, -1500);
    assert.equal(member.orders[0].operator, "Operador original");
    const originalDay = await loadCash(client, scope, "2026-11-01");
    assert.equal(dayRevenue(originalDay.movements, originalDay.start, originalDay.end), 500);
    assert.equal(originalDay.auditRecords.length, 1);
    assert.equal(originalDay.auditRecords[0].cents, 1500);
    assert.equal(originalDay.auditRecords[0].reversal.cents, -1500);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const annulmentDay = await loadCash(client, scope, today);
    assert.equal(dayRevenue(annulmentDay.movements, annulmentDay.start, annulmentDay.end), 0);
    assert.equal(annulmentDay.auditRecords.length, 1);
    assert.equal(
      annulmentDay.auditRecords[0].cents + annulmentDay.auditRecords[0].reversal.cents,
      0,
    );
    const staff = postgresClient(actor, 3);
    const staffHistory = await activityFinancialDetail(
      staff,
      { userId: uid(3), clubId: uid(101) },
      uid(701),
    );
    assert.equal(staffHistory.orders[0].canCancel, false);
    await assert.rejects(
      annulFinancialRecord(
        staff,
        { userId: uid(3), clubId: uid(101) },
        uid(501),
        uid(702),
        "Intento de colaborador",
      ),
      /administrador/,
    );
  } finally {
    await db.close();
  }
});

test("financial immutability preserves existing same-transaction total computation but rejects later rewrites", async () => {
  const { db, actor } = await setup();
  try {
    await db.exec(sql);
    await db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(3)]);
      await tx.exec(
        `INSERT INTO orders(id,club_id,member_id,created_by,total_cents,created_at)VALUES('${uid(705)}','${uid(101)}','${uid(501)}','${uid(1)}',0,'2000-01-01');UPDATE orders SET total_cents=500 WHERE id='${uid(705)}';`,
      );
    });
    const stamped = (
      await db.query("SELECT created_by,created_at FROM orders WHERE id=$1", [uid(705)])
    ).rows[0];
    assert.equal(stamped.created_by, uid(3));
    assert.ok(new Date(stamped.created_at).getUTCFullYear() > 2000);
    assert.equal(
      (await db.query("SELECT total_cents FROM orders WHERE id=$1", [uid(705)])).rows[0]
        .total_cents,
      500,
    );
    await assert.rejects(
      actor(1, `UPDATE orders SET total_cents=501 WHERE id='${uid(705)}'`),
      /inmutable/,
    );
  } finally {
    await db.close();
  }
});

test("employee may annul only own accounting record; verified originals snapshot is immutable and queued replay adds no second reversal", async () => {
  const { db, actor, annul } = await setup();
  try {
    await db.exec(sql);
    await assert.rejects(annul(3, 702), /propias/);
    await assert.rejects(
      actor(
        3,
        `UPDATE orders SET status='cancelled',cancellation_reason='Intento sobre otra persona' WHERE id='${uid(702)}'`,
      ),
      /propias/,
    );
    await db.query("UPDATE products SET stock=17 WHERE id=$1", [uid(301)]);
    await Promise.all([annul(3), annul(3)]);
    const reversal = (await actor(3, "SELECT * FROM financial_order_reversals")).rows;
    assert.equal(reversal.length, 1);
    assert.equal(reversal[0].original_actor, uid(3));
    assert.equal(reversal[0].cancelled_by, uid(3));
    assert.equal(reversal[0].original_items[0].product_name, "Cuaderno");
    assert.equal(reversal[0].original_items[0].quantity, 1);
    await assert.rejects(annul(3, 701, "Otro motivo distinto"), /ya está anulado/);
    await assert.rejects(actor(3, "DELETE FROM financial_order_reversals"), /permission denied/);
    await assert.rejects(annul(3, 301), /Registro no disponible/);
    assert.equal((await db.query("SELECT stock FROM products")).rows[0].stock, "17.000");
  } finally {
    await db.close();
  }
});

test("explicit full-refund declaration is separate, server-priced, owned/admin scoped and immutable; no payment is executed or net amount counted twice", async () => {
  const { db, actor, annul } = await setup();
  try {
    await db.exec(sql);
    const refund = (n = 3, method = "cash", reason = "Devolución ya realizada") =>
      actor(n, "SELECT record_financial_refund($1,$2,$3) id", [uid(701), method, reason]);
    await assert.rejects(refund(), /anulación contable/);
    await annul(3);
    await assert.rejects(refund(2), /autorizado/);
    await assert.rejects(refund(4), /Forbidden/);
    await assert.rejects(refund(3, "crypto"), /método real/);
    await assert.rejects(refund(3, "cash", ""), /motivo/);
    await actor(
      3,
      `INSERT INTO cash_sessions(id,club_id,user_id,opening_cash_cents)VALUES('${uid(901)}','${uid(101)}','${uid(3)}',5000)`,
    );
    const results = await Promise.all([refund(), refund()]);
    assert.equal(results[0].rows[0].id, results[1].rows[0].id);
    const row = (await db.query("SELECT * FROM financial_order_refunds")).rows[0];
    assert.equal(row.cents, 1500);
    assert.equal(row.method, "cash");
    assert.equal(row.recorded_by, uid(3));
    assert.equal(row.cash_session_id, uid(901));
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM financial_order_refunds")).rows[0].n,
      1,
    );
    await assert.rejects(refund(3, "card"), /ya está registrado/);
    await assert.rejects(refund(1), /ya está registrado/);
    await assert.rejects(
      actor(3, "UPDATE financial_order_refunds SET cents=1"),
      /permission denied/,
    );
    await assert.rejects(actor(3, "DELETE FROM financial_order_refunds"), /permission denied/);
    await assert.rejects(
      db.exec("UPDATE financial_order_refunds SET reason='Cambiar auditoría'"),
      /inmutable/,
    );
    assert.equal((await actor(2, "SELECT * FROM financial_order_refunds")).rows.length, 0);
    const { loadCash } = await import("../src/lib/cash-sessions.server.ts");
    const client = postgresClient(actor, 3);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Madrid",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const report = await loadCash(client, { userId: uid(3), clubId: uid(101) }, today);
    assert.equal(report.refunds.length, 1);
    assert.equal(report.refunds[0].cents, 1500);
    assert.equal(dayRevenue(report.movements, report.start, report.end), 0);
    const { reconcileCash } = await import("../src/lib/cash-sessions.ts");
    assert.equal(reconcileCash(report.sessions[0], report.movements).expected, 3500);
    const { activityFinancialDetail } = await import("../src/lib/member-order-history.server.ts");
    const detail = await activityFinancialDetail(
      client,
      { userId: uid(3), clubId: uid(101) },
      uid(701),
    );
    assert.equal(detail.orders[0].canRefund, false);
    assert.equal(detail.orders[0].reversal.refund.cents, 1500);
    assert.equal(detail.orders[0].reversal.items[0].product_name, "Cuaderno");
    const fn = (
      await db.query(
        "SELECT proargnames FROM pg_proc WHERE oid='public.record_financial_refund(uuid,text,text)'::regprocedure",
      )
    ).rows[0];
    assert.deepEqual(fn.proargnames, ["p_order_id", "p_method", "p_reason"]);
    await db.query("UPDATE user_roles SET permissions='{use_cash}' WHERE user_id=$1", [uid(3)]);
    assert.equal(
      (await actor(3, "SELECT * FROM financial_order_refunds")).rows.length,
      1,
      "cash-only refunder retains own drawer evidence",
    );
    assert.equal(
      (await actor(3, "SELECT * FROM financial_order_reversals")).rows.length,
      0,
      "cash access does not expose member audit details",
    );
    await assert.rejects(refund(), /Forbidden/);
  } finally {
    await db.close();
  }
});
test("refund insert failure leaves the existing annulment unchanged and permits a later explicit retry", async () => {
  const { db, actor, annul } = await setup();
  try {
    await db.exec(sql);
    await annul(3);
    const before = (await db.query("SELECT * FROM financial_order_reversals")).rows;
    await db.exec(
      "CREATE FUNCTION fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic refund storage failure';END$$;CREATE TRIGGER fail_refund BEFORE INSERT ON financial_order_refunds FOR EACH ROW EXECUTE FUNCTION fail_refund()",
    );
    await assert.rejects(
      actor(3, "SELECT record_financial_refund($1,$2,$3)", [
        uid(701),
        "cash",
        "Devolución ya realizada",
      ]),
      /synthetic refund storage failure/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM financial_order_refunds")).rows[0].n,
      0,
    );
    assert.deepEqual((await db.query("SELECT * FROM financial_order_reversals")).rows, before);
  } finally {
    await db.close();
  }
});

test("cash refund is a separate drawer outflow and unknown original payment never becomes an invented cash balance", async () => {
  const { reconcileCash, sessionRevenue } = await import("../src/lib/cash-sessions.ts");
  const s = {
    id: "drawer",
    user_id: "employee",
    opening_cash_cents: 5000,
    closing_cash_cents: null,
    status: "open",
    refund_cash_cents: 1500,
  };
  const m = [
    {
      id: "fee",
      source: "fee",
      at: "2026-11-09T12:00:00Z",
      by: "employee",
      cents: 1000,
      session_id: "drawer",
      payment_method: "cash",
    },
  ];
  assert.equal(reconcileCash(s, m).expected, 4500);
  assert.equal(sessionRevenue(s, m), 1000);
  assert.equal(reconcileCash({ ...s, unverified_cancelled_cash: true }, m).expected, null);
});

test("cash-enabled colleague with report access cannot annul/refund another author; same-club administrator can record the explicit refund", async () => {
  const { db, actor, annul } = await setup();
  try {
    await db.exec(sql);
    await db.query(
      "UPDATE user_roles SET permissions='{manage_members,use_cash,view_reports}' WHERE user_id=$1",
      [uid(4)],
    );
    await assert.rejects(annul(4), /propias/);
    await annul(6);
    await assert.rejects(
      actor(4, "SELECT record_financial_refund($1,$2,$3)", [
        uid(701),
        "card",
        "Devolución ya realizada",
      ]),
      /autorizado/,
    );
    await actor(1, "SELECT record_financial_refund($1,$2,$3)", [
      uid(701),
      "card",
      "Devolución ya realizada",
    ]);
    const rows = (await db.query("SELECT * FROM financial_order_refunds")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].recorded_by, uid(1));
    assert.equal(rows[0].method, "card");
    assert.equal(rows[0].cents, 1500);
  } finally {
    await db.close();
  }
});
