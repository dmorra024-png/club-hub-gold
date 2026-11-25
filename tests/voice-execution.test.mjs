import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { uid } from "./helpers/separation-db.mjs";
import { voiceExecutionDatabase } from "./helpers/voice-execution-db.mjs";
import { InventoryCostReportData } from "../src/lib/inventory-report.ts";
import {
  voiceAccessOperation,
  voiceCommandOperation,
  voiceAccessRead,
  ExecutionConfirmation,
} from "../src/lib/voice/execution.server.ts";
let db;
const club = uid(101),
  other = uid(102);
const actor = (user, sql, args = []) =>
  db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid(user)]);
    return tx.query(sql, args);
  });
before(async () => {
  db = await voiceExecutionDatabase();
});

after(async () => {
  await db?.close();
});
const rpc = async (user, id, op, value = null, token = null) =>
  (await actor(user, "select public.snoop_voice_access($1,$2,$3,$4) value", [id, op, value, token]))
    .rows[0].value;
test("real dispatcher adapter persists existing RPC result only after confirmation; durable duplicate returns same result", async () => {
  const id = uid(801);
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    enabled: true,
    fetch: async (_url, request) => {
      const p = JSON.parse(request.body);
      return Response.json(await rpc(1, p.p_request, p.p_operation, p.p_enabled, p.p_token));
    },
  };
  const read = await voiceAccessRead({
    ...options,
    fetch: async () =>
      Response.json(
        (await actor(1, "select public.snoop_get_club_access_control() value")).rows[0].value,
      ),
  });
  assert.equal(read.enabled, true);
  const prepared = await voiceAccessOperation(options, { id, operation: "prepare", value: false });
  assert.equal(
    (await actor(1, "select public.snoop_get_club_access_control() value")).rows[0].value.enabled,
    true,
  );
  await assert.rejects(() => rpc(1, id, "confirm", null, uid(999)), /CONFIRMATION_REQUIRED/);
  const completed = await voiceAccessOperation(options, {
    id,
    operation: "confirm",
    token: prepared.token,
  });
  assert.equal(completed.status, "completed");
  assert.equal(
    (await actor(1, "select public.snoop_get_club_access_control() value")).rows[0].value.enabled,
    false,
  );
  const replay = await voiceAccessOperation(options, {
    id,
    operation: "confirm",
    token: prepared.token,
  });
  assert.deepEqual(replay, completed);
  assert.equal((await rpc(1, id, "status")).status, "completed");
  const records = (
    await db.query(
      "select actor,club,result,completed_at from public.snoop_voice_executions where id=$1",
      [id],
    )
  ).rows;
  assert.equal(records.length, 1);
  assert.equal(records[0].actor, uid(1));
  assert.equal(records[0].club, club);
  assert(records[0].completed_at);
  assert.equal(records[0].result.enabled, false);
});
test("cross-club, collaborator, direct audit mutation, stale confirmation and reused key are rejected", async () => {
  const id = uid(802);
  const p = await rpc(1, id, "prepare", true);
  await assert.rejects(() => rpc(2, id, "status"), /ACCESS_DENIED/);
  await assert.rejects(() => rpc(3, id, "prepare", true), /ACCESS_DENIED/);
  await assert.rejects(() => rpc(1, id, "prepare", false), /KEY_REUSED/);
  await assert.rejects(
    () => actor(1, "delete from public.snoop_voice_executions"),
    /permission denied/,
  );
  await actor(1, "select public.snoop_set_club_access_control(true)");
  await assert.rejects(() => rpc(1, id, "confirm", null, p.token), /STATE_CHANGED/);
  assert.equal((await rpc(1, id, "status")).status, "confirmation_required");
});
test("remote error after commit is reconciled by status, never interpreted as a failed save", async () => {
  const id = uid(803);
  const p = await rpc(1, id, "prepare", false);
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    enabled: true,
    fetch: async (_u, r) => {
      const b = JSON.parse(r.body);
      await rpc(1, b.p_request, b.p_operation, b.p_enabled, b.p_token);
      throw Error("synthetic lost response");
    },
  };
  await assert.rejects(
    () => voiceAccessOperation(options, { id, operation: "confirm", token: p.token }),
    /lost response/,
  );
  assert.equal((await rpc(1, id, "status")).status, "completed");
  assert.equal(
    (await db.query("select count(*)::int n from public.snoop_voice_executions where id=$1", [id]))
      .rows[0].n,
    1,
  );
});
test("expiry and disabled pilot cannot execute; browser cannot forge completed confirmation", async () => {
  const id = uid(804);
  const p = await rpc(1, id, "prepare", true);
  await db.query(
    "update public.snoop_voice_executions set prepared_at=now()-interval '11 minutes' where id=$1",
    [id],
  );
  await assert.rejects(() => rpc(1, id, "confirm", null, p.token), /EXPIRED/);
  await assert.rejects(
    () =>
      voiceAccessOperation(
        {
          url: "https://bnwanxbmprbymbutoths.supabase.co",
          key: "synthetic",
          jwt: "synthetic",
          enabled: false,
        },
        { id, operation: "confirm", token: p.token },
      ),
    /DISABLED/,
  );
  assert(
    !ExecutionConfirmation.safeParse({
      type: "AppExecutionConfirm",
      id,
      token: p.token,
      confirmed: false,
    }).success,
  );
  assert(
    !ExecutionConfirmation.safeParse({
      type: "AppExecutionConfirm",
      id,
      token: p.token,
      confirmed: true,
      status: "completed",
    }).success,
  );
});
test("downstream transaction failure rolls back both the real setting and completion audit", async () => {
  const id = uid(805);
  const p = await rpc(1, id, "prepare", true);
  await db.exec(
    `create function public.voice_test_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic storage failure';end$$;create trigger voice_test_fail before update on public.clubs for each row execute function public.voice_test_fail();`,
  );
  try {
    await assert.rejects(() => rpc(1, id, "confirm", null, p.token), /storage failure/);
  } finally {
    await db.exec(
      "drop trigger voice_test_fail on public.clubs;drop function public.voice_test_fail()",
    );
  }
  assert.equal((await rpc(1, id, "status")).status, "confirmation_required");
  assert.equal(
    (await actor(1, "select public.snoop_get_club_access_control() value")).rows[0].value.enabled,
    false,
  );
});
test("adapter rejects redirects, wrong receipts and unverifiable completion instead of announcing success", async () => {
  const id = uid(806),
    base = {
      url: "https://bnwanxbmprbymbutoths.supabase.co",
      key: "synthetic",
      jwt: "synthetic",
      enabled: true,
    };
  for (const value of [
    { id: uid(999), status: "completed", enabled: true, result: { enabled: true }, token: null },
    { id, status: "completed", enabled: true, result: { enabled: false }, token: null },
  ]) {
    await assert.rejects(
      () =>
        voiceAccessOperation(
          { ...base, fetch: async () => Response.json(value) },
          { id, operation: "status" },
        ),
      /UNVERIFIED/,
    );
  }
  await assert.rejects(
    () =>
      voiceAccessOperation(
        {
          ...base,
          fetch: async (_u, r) => {
            assert.equal(r.redirect, "manual");
            return new Response(null, {
              status: 302,
              headers: { location: "https://example.invalid" },
            });
          },
        },
        { id, operation: "status" },
      ),
    /REJECTED/,
  );
});
const command = async (
  user,
  id,
  operation,
  action = null,
  args = null,
  token = null,
  receiptConfirmed = false,
) =>
  (
    await actor(user, "select public.snoop_voice_command($1,$2,$3,$4,$5,$6) value", [
      id,
      operation,
      action,
      args,
      token,
      receiptConfirmed,
    ])
  ).rows[0].value;
test("one registry persists category rename/archive and restore through the original RPC", async () => {
  for (const [request, name, archived] of [
    [uid(811), "Renamed", true],
    [uid(812), "Restored", false],
  ]) {
    const p = await command(1, request, "prepare", "category.update", {
      id: uid(201),
      name,
      archived,
    });
    const done = await command(1, request, "confirm", null, null, p.token);
    assert.equal(done.result.name, name);
    assert.equal(done.result.archived, archived);
    assert.deepEqual(await command(1, request, "confirm", null, null, p.token), done);
  }
  assert.equal(
    Number(
      (await db.query("select stock from public.products where id=$1", [uid(301)])).rows[0].stock,
    ),
    10,
  );
  await assert.rejects(
    () =>
      command(1, uid(813), "prepare", "category.update", {
        id: uid(202),
        name: "Foreign",
        archived: true,
      }),
    /NOT_FOUND/,
  );
});
test("informational product update preserves original price, stock and movement history", async () => {
  const before = (
    await db.query("select stock,buy_price,sell_price from public.products where id=$1", [uid(301)])
  ).rows[0];
  const count = (await db.query("select count(*)::int n from public.stock_movements")).rows[0].n;
  const p = await command(1, uid(814), "prepare", "product.description", {
    id: uid(301),
    description: "Synthetic administrative description",
  });
  const result = await command(1, uid(814), "confirm", null, null, p.token);
  assert.equal(result.result.description, "Synthetic administrative description");
  assert.deepEqual(
    (
      await db.query("select stock,buy_price,sell_price from public.products where id=$1", [
        uid(301),
      ])
    ).rows[0],
    before,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.stock_movements")).rows[0].n,
    count,
  );
  await assert.rejects(
    () =>
      command(1, uid(815), "prepare", "product.description", {
        id: uid(301),
        description: "Invalid",
        stock: 99,
      }),
    /INVALID_ARGUMENTS/,
  );
});
test("confirmed member renewal uses authoritative fee and existing receipt idempotence", async () => {
  const p = await command(1, uid(816), "prepare", "member.renew", {
    member_id: uid(501),
    plan_id: uid(401),
    method: "cash",
  });
  assert.equal(p.summary.amount_cents, 1000);
  assert.equal(
    (await db.query("select expires_at::text value from public.members where id=$1", [uid(501)]))
      .rows[0].value,
    "2030-01-01",
  );
  const done = await command(1, uid(816), "confirm", null, null, p.token);
  assert.equal(done.result.expires_at, "2030-01-31");
  assert.deepEqual(await command(1, uid(816), "confirm", null, null, p.token), done);
  const receipts = (
    await db.query("select amount_cents from public.membership_receipts where request_id=$1", [
      uid(816),
    ])
  ).rows;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].amount_cents, 1000);
  const pending = await command(1, uid(817), "prepare", "member.renew", {
    member_id: uid(501),
    plan_id: uid(401),
    method: "card",
  });
  await db.query("update public.membership_plans set price_cents=1100 where id=$1", [uid(401)]);
  await assert.rejects(
    () => command(1, uid(817), "confirm", null, null, pending.token),
    /STATE_CHANGED/,
  );
  assert.equal(
    (
      await db.query("select count(*)::int n from public.membership_receipts where request_id=$1", [
        uid(817),
      ])
    ).rows[0].n,
    0,
  );
});
test("shared HTTP execution validates registered actions and refuses unregistered RPC names", async () => {
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    enabled: true,
    fetch: async (_u, req) => {
      const b = JSON.parse(req.body);
      return Response.json(
        await command(1, b.p_request, b.p_operation, b.p_action, b.p_arguments, b.p_token),
      );
    },
  };
  const p = await voiceCommandOperation(options, {
    id: uid(818),
    operation: "prepare",
    action: "category.update",
    arguments: { id: uid(201), name: "Shared", archived: false },
  });
  const result = await voiceCommandOperation(options, {
    id: uid(818),
    operation: "confirm",
    token: p.token,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.result.name, "Shared");
  await assert.rejects(() =>
    voiceCommandOperation(options, {
      id: uid(819),
      operation: "prepare",
      action: "arbitrary_sql",
      arguments: {},
    }),
  );
});
test("authorized records adapter reads real synthetic SQL rows and RLS hides another club", async () => {
  const { voiceRecordsRead } = await import("../src/lib/voice/records-read.server.ts");
  const access = {
    role: "admin",
    status: "active",
    clubId: club,
    clubName: "Synthetic",
    clubLogo: null,
    permissions: ["manage_members", "manage_products"],
  };
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    access,
    fetch: async (u, request) => {
      const url = new URL(u),
        table = url.pathname.split("/").at(-1),
        cols = url.searchParams.get("select");
      if (table === "snoop_voice_find_members") {
        const body = JSON.parse(request.body);
        try {
          return Response.json(
            (
              await actor(1, "select * from public.snoop_voice_find_members($1,$2,$3)", [
                body.p_query,
                body.p_club,
                body.p_limit,
              ])
            ).rows,
          );
        } catch {
          return new Response(null, { status: 403 });
        }
      }
      assert(["members", "products", "product_categories", "membership_plans"].includes(table));
      assert(/^[a-z_,]+$/.test(cols));
      const rows = (
        await actor(1, `select ${cols} from public.${table} where club_id=$1 order by id limit 7`, [
          url.searchParams.get("club_id").slice(3),
        ])
      ).rows;
      return Response.json(rows);
    },
  };
  for (const kind of ["members", "products", "stock", "categories", "membership_plans"]) {
    const found = await voiceRecordsRead(options, { kind, query: "" });
    assert(found.rows.length > 0);
    if (kind === "members")
      await assert.rejects(
        () =>
          voiceRecordsRead(
            { ...options, access: { ...access, clubId: other } },
            { kind, query: "" },
          ),
        /UNAVAILABLE/,
      );
    else {
      const hidden = await voiceRecordsRead(
        { ...options, access: { ...access, clubId: other } },
        { kind, query: "" },
      );
      assert.equal(hidden.rows.length, 0);
    }
  }
});
test("decimal-EUR catalog metadata preserves exact prices and refuses obsolete integer-only RPCs", async () => {
  await db.query("update public.products set buy_price=4.20 where id=$1", [uid(301)]);
  const oldSource = await readFile(
    "supabase/migrations/20261105200000_administrative_catalog_scope.sql",
    "utf8",
  );
  const begin = oldSource.indexOf("CREATE FUNCTION public.save_administrative_product(");
  const end = oldSource.indexOf("REVOKE ALL ON FUNCTION public.save_administrative_product", begin);
  await db.exec(
    oldSource.slice(begin, end).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
  );
  try {
    await assert.rejects(
      () =>
        command(1, uid(820), "prepare", "product.description", {
          id: uid(301),
          description: "No mutation",
        }),
      /LEGACY_PRICE_UNSUPPORTED/,
    );
  } finally {
    await db.exec(
      await readFile("supabase/migrations/20261107180000_catalog_decimal_prices.sql", "utf8"),
    );
  }
  const prepared = await command(1, uid(820), "prepare", "product.description", {
    id: uid(301),
    description: "Decimal price preserved",
  });
  await command(1, uid(820), "confirm", null, null, prepared.token);
  assert.equal(
    Number(
      (await db.query("select buy_price from public.products where id=$1", [uid(301)])).rows[0]
        .buy_price,
    ),
    4.2,
  );
});
test("shared engine honors catalog collaborator permission while admin can inspect its audit", async () => {
  await db.query("update public.user_roles set permissions='{manage_products}' where user_id=$1", [
    uid(3),
  ]);
  const p = await command(3, uid(821), "prepare", "category.update", {
    id: uid(201),
    name: "Staff authorized",
    archived: false,
  });
  const done = await command(3, uid(821), "confirm", null, null, p.token);
  assert.equal(done.status, "completed");
  assert.equal((await command(1, uid(821), "status")).status, "completed");
  await assert.rejects(
    () =>
      command(3, uid(822), "prepare", "member.renew", {
        member_id: uid(501),
        plan_id: uid(401),
        method: "cash",
      }),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    () => command(3, uid(823), "prepare", "access_control.set", { enabled: true }),
    /ACCESS_DENIED/,
  );
});
test("each registered record operation rejects a foreign club reference before creating a proposal", async () => {
  await db.exec(
    `insert into public.products(id,club_id,category_id,name,stock,buy_price,sell_price)values('${uid(302)}','${other}','${uid(202)}','Other notebook',3,0,0);insert into public.membership_plans(id,club_id,name,duration_days,price_cents)values('${uid(402)}','${other}','Other fee',30,2000);insert into public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)values('${uid(502)}','${other}','Other','Synthetic','1990-01-01','SYNTHETIC-OTHER','2030-01-01');`,
  );
  for (const [n, action, args] of [
    [831, "category.update", { id: uid(202), name: "Forbidden", archived: true }],
    [832, "product.description", { id: uid(302), description: "Forbidden" }],
    [833, "member.renew", { member_id: uid(502), plan_id: uid(401), method: "cash" }],
    [834, "member.renew", { member_id: uid(501), plan_id: uid(402), method: "cash" }],
  ]) {
    await assert.rejects(() => command(1, uid(n), "prepare", action, args), /NOT_FOUND/);
    assert.equal(
      (
        await db.query("select count(*)::int n from public.snoop_voice_executions where id=$1", [
          uid(n),
        ])
      ).rows[0].n,
      0,
    );
  }
});
test("cancelling a prepared command is permanent, audited and never reverses completed work", async () => {
  const before = (
    await db.query("select name from public.product_categories where id=$1", [uid(201)])
  ).rows[0].name;
  const p = await command(1, uid(841), "prepare", "category.update", {
    id: uid(201),
    name: "Never applied",
    archived: true,
  });
  const cancelled = await command(1, uid(841), "cancel", null, null, p.token);
  assert.equal(cancelled.status, "cancelled");
  await assert.rejects(() => command(1, uid(841), "confirm", null, null, p.token), /CANCELLED/);
  assert.equal((await command(1, uid(841), "status")).status, "cancelled");
  assert.equal(
    (await db.query("select name from public.product_categories where id=$1", [uid(201)])).rows[0]
      .name,
    before,
  );
  assert(
    (
      await db.query("select cancelled_at from public.snoop_voice_executions where id=$1", [
        uid(841),
      ])
    ).rows[0].cancelled_at,
  );
  const completed = await command(1, uid(842), "prepare", "category.update", {
    id: uid(201),
    name: "Completed",
    archived: false,
  });
  await command(1, uid(842), "confirm", null, null, completed.token);
  await assert.rejects(
    () => command(1, uid(842), "cancel", null, null, completed.token),
    /ALREADY_COMPLETED/,
  );
});
test("changed fee duration invalidates confirmation without silently changing membership terms", async () => {
  const p = await command(1, uid(843), "prepare", "member.renew", {
    member_id: uid(501),
    plan_id: uid(401),
    method: "cash",
  });
  assert.equal(p.summary.duration_days, 30);
  await db.query("update public.membership_plans set duration_days=180 where id=$1", [uid(401)]);
  await assert.rejects(() => command(1, uid(843), "confirm", null, null, p.token), /STATE_CHANGED/);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.membership_operations where request_id=$1",
        [uid(843)],
      )
    ).rows[0].n,
    0,
  );
});

const routedCommand = (user, request) =>
  voiceCommandOperation(
    {
      url: "https://bnwanxbmprbymbutoths.supabase.co",
      key: "synthetic",
      jwt: "synthetic-user-" + user,
      enabled: true,
      fetch: async (url, options) => {
        assert.equal(new URL(String(url)).pathname, "/rest/v1/rpc/snoop_voice_command");
        assert.equal(
          new Headers(options.headers).get("Authorization"),
          "Bearer synthetic-user-" + user,
        );
        const body = JSON.parse(options.body);
        return Response.json(
          await command(
            user,
            body.p_request,
            body.p_operation,
            body.p_action,
            body.p_arguments,
            body.p_token,
            body.p_receipt_confirmed === true,
          ),
        );
      },
    },
    request,
  );
const confirmCommand = async (user, id, action, args) => {
  const p = await routedCommand(user, { id, operation: "prepare", action, arguments: args });
  assert.equal(p.status, "confirmation_required");
  const result = await routedCommand(user, {
    id,
    operation: "confirm",
    token: p.token,
    receiptConfirmed: action === "wallet.topup",
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(
    await routedCommand(user, {
      id,
      operation: "confirm",
      token: p.token,
      receiptConfirmed: action === "wallet.topup",
    }),
    result,
  );
  return result;
};

test("category creation uses a durable operation ID and preserves the original catalog on replay", async () => {
  const r = await confirmCommand(1, uid(1001), "category.create", {
    name: "Synthetic administration",
    unit_type: "unit",
    is_smokeable: false,
  });
  assert.equal(r.result.name, "Synthetic administration");
  assert.equal(
    (
      await db.query("select count(*)::int n from public.product_categories where id=$1", [
        uid(1001),
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () =>
      command(1, uid(1002), "prepare", "category.create", {
        name: "Synthetic administration",
        unit_type: "unit",
        is_smokeable: false,
      }),
    /DUPLICATE_NAME/,
  );
});
test("member changes preserve all unrelated membership/document fields and reject underage or unknown values", async () => {
  const before = (
    await db.query("select to_jsonb(m) value from public.members m where id=$1", [uid(501)])
  ).rows[0].value;
  const r = await confirmCommand(1, uid(1003), "member.update", {
    id: uid(501),
    last_name: "Synthetic Corrected",
    city: "Palma",
    phone: "666123456",
    email: "synthetic@example.test",
  });
  assert.equal(r.result.last_name, "Synthetic Corrected");
  const after = (
    await db.query("select to_jsonb(m) value from public.members m where id=$1", [uid(501)])
  ).rows[0].value;
  for (const key of [
    "id",
    "club_id",
    "first_name",
    "birth_date",
    "dni_number",
    "dni_photo_path",
    "signature_path",
    "plan_id",
    "expires_at",
    "created_by",
  ])
    assert.deepEqual(after[key], before[key]);
  await assert.rejects(
    () =>
      command(1, uid(1004), "prepare", "member.update", { id: uid(501), birth_date: "2020-01-01" }),
    /INVALID_MEMBER/,
  );
  await assert.rejects(
    () => command(1, uid(1004), "prepare", "member.update", { id: uid(501), role: "admin" }),
    /INVALID_ARGUMENTS/,
  );
  await assert.rejects(
    () =>
      command(1, uid(1004), "prepare", "member.update", { id: uid(501), email: "not-an-email" }),
    /INVALID_MEMBER/,
  );
  const p = await command(1, uid(1005), "prepare", "member.update", {
    id: uid(501),
    city: "Barcelona",
  });
  await db.query("update public.members set phone='666000000' where id=$1", [uid(501)]);
  await assert.rejects(
    () => command(1, uid(1005), "confirm", null, null, p.token),
    /STATE_CHANGED/,
  );
  assert.equal(
    (await db.query("select city from public.members where id=$1", [uid(501)])).rows[0].city,
    "Palma",
  );
});
test("membership plan create/update uses cents and never rewrites receipts or prior expirations", async () => {
  const history = await db.query(
    "select id,amount_cents from public.membership_receipts order by id",
  );
  const member = (await db.query("select expires_at from public.members where id=$1", [uid(501)]))
    .rows[0];
  await confirmCommand(1, uid(1006), "fee.create", {
    name: "Synthetic future fee",
    duration_days: 180,
    price_cents: 3250,
    active: true,
  });
  await confirmCommand(1, uid(1007), "fee.update", {
    id: uid(1006),
    name: "Synthetic future fee corrected",
    duration_days: 365,
    price_cents: 5000,
    active: false,
  });
  assert.deepEqual(
    await db.query("select id,amount_cents from public.membership_receipts order by id"),
    history,
  );
  assert.deepEqual(
    (await db.query("select expires_at from public.members where id=$1", [uid(501)])).rows[0],
    member,
  );
  assert.deepEqual(
    (
      await db.query(
        "select price_cents,active,duration_days from public.membership_plans where id=$1",
        [uid(1006)],
      )
    ).rows[0],
    { price_cents: 5000, active: false, duration_days: 365 },
  );
  await assert.rejects(
    () =>
      command(3, uid(1008), "prepare", "fee.create", {
        name: "Not authorized",
        duration_days: 30,
        price_cents: 100,
        active: true,
      }),
    /ACCESS_DENIED/,
  );
});
test("discount lifecycle and assignment use current club policies and retain original financial records", async () => {
  const original = await db.query(
    "select id,amount_cents from public.membership_receipts order by id",
  );
  const values = {
    name: "Synthetic discount",
    percentage_basis_points: 1250,
    active: true,
    valid_from: null,
    valid_until: null,
  };
  await confirmCommand(1, uid(1010), "discount.create", values);
  await confirmCommand(1, uid(1011), "member.discount.set", {
    member_id: uid(501),
    discount_id: uid(1010),
  });
  assert.equal(
    (
      await db.query(
        "select discount_id from public.member_discount_assignments where member_id=$1",
        [uid(501)],
      )
    ).rows[0].discount_id,
    uid(1010),
  );
  await confirmCommand(1, uid(1012), "discount.update", {
    id: uid(1010),
    ...values,
    name: "Synthetic discount changed",
    active: false,
  });
  await assert.rejects(
    () =>
      command(1, uid(1013), "prepare", "member.discount.set", {
        member_id: uid(501),
        discount_id: uid(1010),
      }),
    /DISCOUNT_UNAVAILABLE/,
  );
  await confirmCommand(1, uid(1014), "member.discount.clear", { member_id: uid(501) });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.member_discount_assignments where member_id=$1",
        [uid(501)],
      )
    ).rows[0].n,
    0,
  );
  assert.deepEqual(
    await db.query("select id,amount_cents from public.membership_receipts order by id"),
    original,
  );
  await assert.rejects(
    () =>
      command(1, uid(1015), "prepare", "discount.create", {
        ...values,
        name: "Invalid interval",
        valid_from: "2030-02-01",
        valid_until: "2030-01-01",
      }),
    /INVALID_ARGUMENTS/,
  );
});
test("cash open/close uses existing audit trigger, server time and responsible operator without treating float as income", async () => {
  const receipts = await db.query(
    "select id,amount_cents from public.membership_receipts order by id",
  );
  const opened = await confirmCommand(1, uid(1020), "cash.open", { opening_cash_cents: 5000 });
  assert.equal(opened.result.status, "open");
  const row = (await db.query("select * from public.cash_sessions where id=$1", [uid(1020)]))
    .rows[0];
  assert.equal(row.user_id, uid(1));
  assert.equal(row.club_id, club);
  assert(row.opened_at);
  assert.equal(row.closed_by, null);
  await assert.rejects(
    () => command(1, uid(1021), "prepare", "cash.open", { opening_cash_cents: 1000 }),
    /ALREADY_OPEN/,
  );
  const closed = await confirmCommand(1, uid(1022), "cash.close", {
    id: uid(1020),
    closing_cash_cents: 4950,
    notes: "Synthetic count only",
  });
  assert.equal(closed.result.closed_by, uid(1));
  assert.equal(closed.result.closing_cash_cents, 4950);
  const final = (await db.query("select * from public.cash_sessions where id=$1", [uid(1020)]))
    .rows[0];
  assert.equal(final.notes, "Synthetic count only");
  assert(final.closed_at);
  assert.equal(final.opened_at.toISOString(), row.opened_at.toISOString());
  assert.deepEqual(
    await db.query("select id,amount_cents from public.membership_receipts order by id"),
    receipts,
  );
  await assert.rejects(
    () =>
      command(1, uid(1023), "prepare", "cash.close", {
        id: uid(1020),
        closing_cash_cents: 5000,
        notes: "Again",
      }),
    /REFERENCE_NOT_FOUND/,
  );
  await assert.rejects(
    () => command(3, uid(1024), "prepare", "cash.open", { opening_cash_cents: 100 }),
    /ACCESS_DENIED/,
  );
});
test("every new action rejects a foreign-club record and leaves no prepared ledger row", async () => {
  for (const [n, action, args] of [
    [1030, "member.update", { id: uid(501), city: "Other club" }],
    [
      1031,
      "fee.update",
      { id: uid(401), name: "Foreign", duration_days: 30, price_cents: 100, active: true },
    ],
    [
      1032,
      "discount.update",
      {
        id: uid(1010),
        name: "Foreign",
        percentage_basis_points: 1000,
        active: true,
        valid_from: null,
        valid_until: null,
      },
    ],
    [1033, "member.discount.set", { member_id: uid(501), discount_id: uid(1010) }],
    [1034, "member.discount.clear", { member_id: uid(501) }],
    [1035, "cash.close", { id: uid(1020), closing_cash_cents: 100, notes: "Foreign" }],
  ]) {
    await assert.rejects(() => command(2, uid(n), "prepare", action, args));
    assert.equal(
      (
        await db.query("select count(*)::int n from public.snoop_voice_executions where id=$1", [
          uid(n),
        ])
      ).rows[0].n,
      0,
    );
  }
});

test("registration refuses missing human evidence and server field configuration cannot be bypassed", async () => {
  const args = {
    first_name: "Synthetic",
    last_name: "New Member",
    avalador_id: null,
    birth_date: "1995-03-12",
    city: "Palma",
    phone: "666123456",
    email: "",
    address: "",
    postal_code: "",
    plan_id: uid(401),
    method: "cash",
  };
  await assert.rejects(
    () => command(1, uid(1040), "prepare", "member.create", args),
    /HUMAN_DOCUMENTS_REQUIRED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.members where id=$1", [uid(1040)])).rows[0]
      .n,
    0,
  );
  await assert.rejects(
    () =>
      command(3, uid(1041), "prepare", "member_field.set", {
        field_key: "signature",
        visible: false,
        required: false,
      }),
    /ACCESS_DENIED/,
  );
  for (const [i, key] of ["dni_number", "dni_photo", "signature"].entries())
    await confirmCommand(1, uid(1042 + i), "member_field.set", {
      field_key: key,
      visible: false,
      required: false,
    });
  await assert.rejects(
    () => command(1, uid(1045), "prepare", "member.create", { ...args, phone: "" }),
    /REQUIRED_FIELD/,
  );
  const p = await command(1, uid(1046), "prepare", "member.create", args);
  await confirmCommand(1, uid(1047), "member_field.set", {
    field_key: "signature",
    visible: true,
    required: true,
  });
  await assert.rejects(
    () => command(1, uid(1046), "confirm", null, null, p.token),
    /HUMAN_DOCUMENTS_REQUIRED|STATE_CHANGED/,
  );
  await confirmCommand(1, uid(1048), "member_field.set", {
    field_key: "signature",
    visible: false,
    required: false,
  });
  const receipts = (await db.query("select count(*)::int n from public.membership_receipts"))
    .rows[0].n;
  const created = await confirmCommand(1, uid(1049), "member.create", args);
  assert.equal(created.result.id, uid(1049));
  const member = (
    await db.query(
      "select first_name,last_name,birth_date,city,created_by,club_id,dni_photo_path,signature_path from public.members where id=$1",
      [uid(1049)],
    )
  ).rows[0];
  assert.equal(member.first_name, "Synthetic");
  assert.equal(member.city, "Palma");
  assert.equal(member.created_by, uid(1));
  assert.equal(member.club_id, club);
  assert.equal(member.dni_photo_path, "");
  assert.equal(member.signature_path, "");
  assert.equal(
    (await db.query("select count(*)::int n from public.membership_receipts")).rows[0].n,
    receipts + 1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.membership_operations where request_id=$1",
        [uid(1049)],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () => command(1, uid(1050), "prepare", "member.create", { ...args, first_name: null }),
    /INVALID_ARGUMENTS/,
  );
  await assert.rejects(
    () => command(1, uid(1050), "prepare", "member.create", { ...args, birth_date: "2020-03-12" }),
    /INVALID_MEMBER/,
  );
});

test("wallet configuration and recharge delegate to original RPCs; confirmations cannot duplicate credit or cash evidence", async () => {
  await confirmCommand(1, uid(1060), "wallet.configure", { enabled: true });
  await confirmCommand(1, uid(1061), "cash.open", { opening_cash_cents: 5000 });
  const before = await db.query(
    "select id,amount_cents from public.membership_receipts order by id",
  );
  const p = await command(1, uid(1062), "prepare", "wallet.topup", {
    member_id: uid(501),
    cash_session_id: uid(1061),
    amount_cents: 1250,
    method: "card",
  });
  assert.equal(
    (
      await db.query("select balance_cents from public.socio_wallet_accounts where member_id=$1", [
        uid(501),
      ])
    ).rows[0].balance_cents,
    0,
  );
  await assert.rejects(
    () => command(1, uid(1062), "confirm", null, null, p.token),
    /RECEIPT_CONFIRMATION_REQUIRED/,
  );
  const done = await command(1, uid(1062), "confirm", null, null, p.token, true);
  assert.equal(done.result.balanceCents, 1250);
  assert(
    (
      await db.query("select receipt_confirmed_at from public.snoop_voice_executions where id=$1", [
        uid(1062),
      ])
    ).rows[0].receipt_confirmed_at,
  );
  assert.deepEqual(await command(1, uid(1062), "confirm", null, null, p.token, true), done);
  assert.deepEqual(
    (
      await db.query(
        "select delta_cents,payment_method,actor_id,cash_session_id from public.socio_wallet_ledger where operation_id=$1",
        [uid(1062)],
      )
    ).rows,
    [{ delta_cents: 1250, payment_method: "card", actor_id: uid(1), cash_session_id: uid(1061) }],
  );
  assert.equal(
    (
      await db.query("select balance_cents from public.socio_wallet_accounts where member_id=$1", [
        uid(501),
      ])
    ).rows[0].balance_cents,
    1250,
  );
  assert.deepEqual(
    await db.query("select id,amount_cents from public.membership_receipts order by id"),
    before,
  );
  const pending = await command(1, uid(1063), "prepare", "wallet.topup", {
    member_id: uid(501),
    cash_session_id: uid(1061),
    amount_cents: 100,
    method: "cash",
  });
  await confirmCommand(1, uid(1064), "wallet.configure", { enabled: false });
  await assert.rejects(
    () => command(1, uid(1063), "confirm", null, null, pending.token, true),
    /WALLET_UNAVAILABLE/,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.socio_wallet_ledger where operation_id=$1",
        [uid(1063)],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    () =>
      command(2, uid(1065), "prepare", "wallet.topup", {
        member_id: uid(501),
        cash_session_id: uid(1061),
        amount_cents: 100,
        method: "cash",
      }),
    /REFERENCE_NOT_FOUND|ACCESS_DENIED/,
  );
  await assert.rejects(
    () => command(3, uid(1066), "prepare", "wallet.configure", { enabled: true }),
    /ACCESS_DENIED/,
  );
  await confirmCommand(1, uid(1067), "cash.close", {
    id: uid(1061),
    closing_cash_cents: 5000,
    notes: "Card topup does not increase physical cash",
  });
});

test("product card creation and edits use original catalog RPCs without an implicit stock movement or historical price rewrite", async () => {
  const history = await db.query("select * from public.stock_movements order by id");
  const created = await confirmCommand(1, uid(1070), "product.create", {
    name: "Synthetic Binder",
    destination: "almacen",
    category_id: uid(1001),
    buy_price_cents: 420,
    sell_price_cents: 1250,
    strain: null,
    notes: "Synthetic office inventory",
    description: "Informational description",
  });
  const product = created.result.id;
  assert.equal(created.result.stock, 0);
  assert.deepEqual(await db.query("select * from public.stock_movements order by id"), history);
  const updated = await confirmCommand(1, uid(1071), "product.update", {
    id: product,
    sell_price_cents: 1350,
    description: "Corrected only",
    active: false,
  });
  assert.equal(updated.result.sell_price, 13.5);
  assert.equal(updated.result.buy_price, 4.2);
  assert.equal(updated.result.price_unit, "EUR");
  const stored = (
    await db.query("select buy_price,sell_price from public.products where id=$1", [product])
  ).rows[0];
  assert.equal(Number(stored.buy_price), 4.2);
  assert.equal(Number(stored.sell_price), 13.5);
  assert.equal(updated.result.name, "Synthetic Binder");
  assert.equal(updated.result.stock, 0);
  assert.equal(updated.result.active, false);
  assert.deepEqual(await db.query("select * from public.stock_movements order by id"), history);
  await assert.rejects(
    () => command(1, uid(1072), "prepare", "product.update", { id: product, stock: 20 }),
    /INVALID_ARGUMENTS/,
  );
  await assert.rejects(
    () => command(2, uid(1072), "prepare", "product.update", { id: product, name: "Foreign" }),
    /REFERENCE_NOT_FOUND/,
  );
});
test("physical inventory correction persists exactly once with original expected-stock checks and audit", async () => {
  const product = (await db.query("select id from public.products where name='Synthetic Binder'"))
    .rows[0].id;
  await confirmCommand(1, uid(1073), "stock.adjust", {
    id: product,
    delta: "10",
    notes: "Verified synthetic physical count",
  });
  assert.equal(
    Number(
      (await db.query("select stock from public.products where id=$1", [product])).rows[0].stock,
    ),
    10,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.stock_movements where product_id=$1 and reason='administrative_adjustment'",
        [product],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    () =>
      command(1, uid(1074), "prepare", "stock.adjust", {
        id: product,
        delta: "0.50",
        notes: "Half a unit is invalid",
      }),
    /WHOLE_UNITS_REQUIRED/,
  );
  await assert.rejects(
    () =>
      command(1, uid(1074), "prepare", "stock.adjust", {
        id: product,
        delta: "-11",
        notes: "Would go negative",
      }),
    /INSUFFICIENT_STOCK/,
  );
  const pending = await command(1, uid(1075), "prepare", "stock.adjust", {
    id: product,
    delta: "-2",
    notes: "Verified synthetic recount",
  });
  await actor(1, "select public.adjust_administrative_stock($1,1,10,$2)", [
    product,
    "Independent manual correction",
  ]);
  await assert.rejects(
    () => command(1, uid(1075), "confirm", null, null, pending.token),
    /STATE_CHANGED/,
  );
  assert.equal(
    Number(
      (await db.query("select stock from public.products where id=$1", [product])).rows[0].stock,
    ),
    11,
  );
  await assert.rejects(
    () =>
      command(2, uid(1076), "prepare", "stock.adjust", {
        id: product,
        delta: "1",
        notes: "Foreign product",
      }),
    /REFERENCE_NOT_FOUND/,
  );
});

test("current avalador registration RPC is preserved and a required endorser must be a verified member of the same club", async () => {
  await confirmCommand(1, uid(1080), "member_field.set", {
    field_key: "avalador",
    visible: true,
    required: true,
  });
  const args = {
    first_name: "Synthetic",
    last_name: "Endorsed",
    birth_date: "1995-03-12",
    city: "Palma",
    phone: "666123456",
    email: "",
    address: "",
    postal_code: "",
    plan_id: uid(401),
    method: "cash",
    avalador_id: null,
  };
  await assert.rejects(
    () => command(1, uid(1081), "prepare", "member.create", args),
    /AVALADOR_REQUIRED/,
  );
  await assert.rejects(
    () => command(1, uid(1081), "prepare", "member.create", { ...args, avalador_id: uid(9999) }),
    /REFERENCE_NOT_FOUND/,
  );
  await confirmCommand(1, uid(1082), "member.create", { ...args, avalador_id: uid(501) });
  const m = (
    await db.query(
      "select avalador_member_id,avalador_member_number from public.members where id=$1",
      [uid(1082)],
    )
  ).rows[0];
  assert.equal(m.avalador_member_id, uid(501));
  assert.equal(
    m.avalador_member_number,
    (await db.query("select member_number from public.members where id=$1", [uid(501)])).rows[0]
      .member_number,
  );
  await confirmCommand(1, uid(1083), "member_field.set", {
    field_key: "avalador",
    visible: true,
    required: false,
  });
});
test("current located-product creation records the requested destination while dual-stock legacy corrections fail closed", async () => {
  assert.deepEqual(
    (
      await db.query(
        "select destination,product_id from public.snoop_located_product_requests where request_id=$1",
        [uid(1070)],
      )
    ).rows[0],
    {
      destination: "almacen",
      product_id: (await db.query("select id from public.products where name='Synthetic Binder'"))
        .rows[0].id,
    },
  );
  // Use the owner's actual published location schema and triggers, only locally.
  await db.exec(await readFile("docs/sql/SNOOP_ALMACEN_DISPENSARIO_REVIEW_ONLY.sql", "utf8"));
  await db.exec(await readFile("docs/sql/SNOOP_ALMACEN_PRECISION_FIX.sql", "utf8"));
  await assert.rejects(
    () =>
      command(1, uid(1084), "prepare", "stock.adjust", {
        id: uid(301),
        delta: "1",
        notes: "Do not bypass current dual-stock flow",
      }),
    /DUAL_STOCK_REVIEW_REQUIRED/,
  );
  assert.equal(
    (
      await db.query("select count(*)::int n from public.snoop_voice_executions where id=$1", [
        uid(1084),
      ])
    ).rows[0].n,
    0,
  );
});

test("current Finanzas supplier, expense, planned-purchase and cancellation actions preserve Caja, inventory and original amounts", async () => {
  const cash = await db.query(
    "select id,opening_cash_cents,closing_cash_cents from public.cash_sessions order by id",
  );
  const stock = await db.query("select id,stock from public.products order by id");
  await confirmCommand(1, uid(1090), "finance.supplier.create", {
    name: "Synthetic Office Supplier",
    contact: "synthetic@example.test",
    notes: "Synthetic test only",
  });
  await confirmCommand(1, uid(1091), "finance.expense.create", {
    supplier_id: uid(1090),
    category: "alquiler",
    description: "Synthetic office rent",
    amount_cents: 50000,
    payment_method: "banco",
  });
  await confirmCommand(1, uid(1092), "finance.purchase.record", {
    supplier_id: uid(1090),
    reference: "SYNTHETIC-2026",
    description: "Planned office chairs",
    amount_cents: 12500,
  });
  const old = (await db.query("select * from public.snoop_expenses where id=$1", [uid(1091)]))
    .rows[0];
  await confirmCommand(1, uid(1093), "finance.expense.cancel", {
    id: uid(1091),
    reason: "Synthetic entry duplicated in source document",
  });
  const cancelled = (await db.query("select * from public.snoop_expenses where id=$1", [uid(1091)]))
    .rows[0];
  for (const key of [
    "amount_cents",
    "description",
    "created_by",
    "created_at",
    "request_id",
    "payment_method",
  ])
    assert.deepEqual(cancelled[key], old[key]);
  assert.equal(cancelled.cancelled_by, uid(1));
  assert(cancelled.cancelled_at);
  assert.equal(
    (await db.query("select count(*)::int n from public.snoop_expenses where id=$1", [uid(1091)]))
      .rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("select status from public.snoop_purchases where id=$1", [uid(1092)])).rows[0]
      .status,
    "pendiente",
  );
  assert.deepEqual(
    await db.query(
      "select id,opening_cash_cents,closing_cash_cents from public.cash_sessions order by id",
    ),
    cash,
  );
  assert.deepEqual(await db.query("select id,stock from public.products order by id"), stock);
  await assert.rejects(
    () =>
      command(1, uid(1094), "prepare", "finance.expense.cancel", {
        id: uid(1091),
        reason: "Another cancellation",
      }),
    /REFERENCE_NOT_FOUND/,
  );
  await assert.rejects(
    () =>
      command(3, uid(1094), "prepare", "finance.supplier.create", {
        name: "Foreign",
        contact: "",
        notes: "",
      }),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    () =>
      command(2, uid(1094), "prepare", "finance.expense.create", {
        supplier_id: uid(1090),
        category: "otros",
        description: "Foreign supplier",
        amount_cents: 100,
        payment_method: "pendiente",
      }),
    /REFERENCE_NOT_FOUND/,
  );
});
test("finance lookup is POST-only in the adapter and the real invoker RPC preserves admin and club RLS", async () => {
  const rows = (
    await actor(1, "select public.snoop_voice_finance_search('expenses','Synthetic',$1,7) rows", [
      club,
    ])
  ).rows[0].rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount_cents, 50000);
  await assert.rejects(
    () => actor(2, "select public.snoop_voice_finance_search('expenses','Synthetic',$1,7)", [club]),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    () => actor(3, "select public.snoop_voice_finance_search('expenses','Synthetic',$1,7)", [club]),
    /ACCESS_DENIED/,
  );
});

test("pending recovery needs the original authenticated actor and a new explicit confirmation; completed recovery cannot write again", async () => {
  const id = uid(1101);
  const p = await command(1, id, "prepare", "category.create", {
    name: "Recovered synthetic category",
    unit_type: "unit",
    is_smokeable: false,
  });
  const before = await db.query("select id,name from public.product_categories order by id");
  const recovered = await command(1, id, "recover");
  assert.equal(recovered.status, "confirmation_required");
  assert.equal(recovered.token, p.token);
  assert.deepEqual(
    await db.query("select id,name from public.product_categories order by id"),
    before,
  );
  for (const user of [2, 3])
    await assert.rejects(() => command(user, id, "recover"), /ACCESS_DENIED/);
  await assert.rejects(
    () => command(1, id, "confirm", null, null, uid(1199)),
    /CONFIRMATION_REQUIRED/,
  );
  const complete = await command(1, id, "confirm", null, null, recovered.token);
  assert.equal(complete.status, "completed");
  const after = await db.query("select id,name from public.product_categories order by id");
  assert.equal(after.rows.length, before.rows.length + 1);
  assert.equal((await command(1, id, "recover")).token, null);
  assert.equal((await command(1, id, "recover")).status, "completed");
  assert.deepEqual(
    await db.query("select id,name from public.product_categories order by id"),
    after,
  );
});

test("expired recovery cancels only the unexecuted proposal and a rollback may still read verified status with writes disabled", async () => {
  const id = uid(1102);
  await command(1, id, "prepare", "category.create", {
    name: "Expired synthetic",
    unit_type: "unit",
    is_smokeable: false,
  });
  await db.query(
    "update public.snoop_voice_executions set prepared_at=now()-interval '11 minutes' where id=$1",
    [id],
  );
  const recovered = await command(1, id, "recover");
  assert.equal(recovered.status, "cancelled");
  assert.equal(recovered.token, null);
  assert.equal(
    (await db.query("select id from public.product_categories where id=$1", [id])).rows.length,
    0,
  );
  const options = {
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "synthetic",
    jwt: "synthetic",
    enabled: false,
    fetch: async (_url, req) => {
      const p = JSON.parse(req.body);
      return Response.json(await command(1, p.p_request, p.p_operation));
    },
  };
  assert.equal(
    (await voiceCommandOperation(options, { id, operation: "status" })).status,
    "cancelled",
  );
  for (const operation of ["prepare", "confirm", "recover"])
    await assert.rejects(() => voiceCommandOperation(options, { id, operation }), /DISABLED/);
});

test("wallet recharge reversal uses the unchanged refund RPC, requires actual-refund attestation and preserves the original receipt", async () => {
  await confirmCommand(1, uid(1110), "wallet.configure", { enabled: true });
  await confirmCommand(1, uid(1111), "cash.open", { opening_cash_cents: 0 });
  const original = (
    await db.query("select * from public.socio_wallet_ledger where operation_id=$1", [uid(1062)])
  ).rows[0];
  const args = {
    topup_id: original.id,
    cash_session_id: uid(1111),
    reason: "Synthetic refund already made",
    method: "card",
  };
  const prepared = await command(1, uid(1112), "prepare", "wallet.topup.reverse", args);
  assert.equal(prepared.summary.amount_cents, 1250);
  assert.match(prepared.summary.attestation, /ya he devuelto/);
  await assert.rejects(
    () => command(1, uid(1112), "confirm", null, null, prepared.token),
    /RECEIPT_CONFIRMATION_REQUIRED/,
  );
  await assert.rejects(
    () => command(2, uid(1113), "prepare", "wallet.topup.reverse", args),
    /ACCESS_DENIED|REFERENCE_NOT_FOUND/,
  );
  await assert.rejects(
    () => command(3, uid(1113), "prepare", "wallet.topup.reverse", args),
    /ACCESS_DENIED|REFERENCE_NOT_FOUND/,
  );
  const done = await command(1, uid(1112), "confirm", null, null, prepared.token, true);
  assert.equal(done.result.refundCents, 1250);
  assert.equal(done.result.balanceCents, 0);
  assert.deepEqual(await command(1, uid(1112), "confirm", null, null, prepared.token, true), done);
  assert.deepEqual(
    (await db.query("select * from public.socio_wallet_ledger where id=$1", [original.id])).rows[0],
    original,
  );
  const reversals = (
    await db.query(
      "select delta_cents,payment_method,reversal_of from public.socio_wallet_ledger where kind='topup_reversal' and reversal_of=$1",
      [original.operation_id],
    )
  ).rows;
  assert.deepEqual(reversals, [
    { delta_cents: -1250, payment_method: "card", reversal_of: original.operation_id },
  ]);
  assert.equal(Number(original.delta_cents) + Number(reversals[0].delta_cents), 0);
  assert(
    (
      await db.query("select receipt_confirmed_at from public.snoop_voice_executions where id=$1", [
        uid(1112),
      ])
    ).rows[0].receipt_confirmed_at,
  );
  await assert.rejects(
    () => command(1, uid(1114), "prepare", "wallet.topup.reverse", args),
    /REFERENCE_NOT_FOUND/,
  );
});

test("collaborator lookup preserves existing row policies and rejects staff or foreign club requests", async () => {
  await db.query("update public.profiles set full_name='Synthetic operator' where id=$1", [uid(3)]);
  const query = "select * from public.snoop_voice_collaborators('Synthetic operator',$1,7)";
  assert.deepEqual((await actor(1, query, [club])).rows, [
    { id: uid(3), name: "Synthetic operator" },
  ]);
  await assert.rejects(() => actor(2, query, [club]), /ACCESS_DENIED/);
  await assert.rejects(() => actor(3, query, [club]), /ACCESS_DENIED/);
});

test("shared collaborator commands change only the existing club role with explicit confirmation, never Auth identities or admin roles", async () => {
  await db.query(
    "insert into auth.users(id,email)values($1,'synthetic-collaborator@example.test')",
    [uid(6)],
  );
  await db.query(
    "insert into public.user_roles(user_id,role,club_id,permissions)values($1,'collaborator',$2,'{manage_members,use_cash}')",
    [uid(6), club],
  );
  const changed = await command(1, uid(1120), "prepare", "collaborator.permissions.set", {
    id: uid(6),
    permissions: ["manage_members", "view_reports"],
  });
  assert.deepEqual(
    (
      await db.query(
        "select to_jsonb(permissions) permissions from public.user_roles where user_id=$1",
        [uid(6)],
      )
    ).rows[0].permissions,
    ["manage_members", "use_cash"],
  );
  for (const user of [2, 3])
    await assert.rejects(
      () =>
        command(user, uid(1121), "prepare", "collaborator.permissions.set", {
          id: uid(6),
          permissions: ["use_cash"],
        }),
      /ACCESS_DENIED|REFERENCE_NOT_FOUND/,
    );
  for (const id of [uid(1), uid(2)])
    await assert.rejects(
      () => command(1, uid(1121), "prepare", "collaborator.revoke", { id }),
      /REFERENCE_NOT_FOUND/,
    );
  await assert.rejects(
    () =>
      command(1, uid(1121), "prepare", "collaborator.permissions.set", {
        id: uid(6),
        permissions: ["super_admin"],
      }),
    /INVALID_ARGUMENTS/,
  );
  const done = await command(1, uid(1120), "confirm", null, null, changed.token);
  assert.deepEqual(done.result.permissions, ["manage_members", "view_reports"]);
  assert.deepEqual(await command(1, uid(1120), "confirm", null, null, changed.token), done);
  const pending = await command(1, uid(1122), "prepare", "collaborator.revoke", { id: uid(6) });
  await db.query("update public.user_roles set permissions='{use_cash}' where user_id=$1", [
    uid(6),
  ]);
  await assert.rejects(
    () => command(1, uid(1122), "confirm", null, null, pending.token),
    /STATE_CHANGED/,
  );
  const rev = await confirmCommand(1, uid(1123), "collaborator.revoke", { id: uid(6) });
  assert.equal(rev.result.revoked, true);
  assert.equal(
    (await db.query("select id from public.user_roles where user_id=$1", [uid(6)])).rows.length,
    0,
  );
  assert.equal((await db.query("select id from auth.users where id=$1", [uid(6)])).rows.length, 1);
  assert.deepEqual(await command(1, uid(1123), "recover"), JSON.parse(JSON.stringify(rev)));
});

test("theme execution reuses the existing seven palettes and the owner's RLS keeps two clubs independent", async () => {
  await confirmCommand(2, uid(1130), "theme.set", { theme_id: "ruby-gold" });
  const prepared = await command(1, uid(1131), "prepare", "theme.set", {
    theme_id: "emerald-gold",
  });
  assert.equal((await actor(1, "select theme_id from public.snoop_club_themes")).rows.length, 0);
  const done = await command(1, uid(1131), "confirm", null, null, prepared.token);
  assert.equal(done.result.theme_id, "emerald-gold");
  assert.deepEqual((await actor(1, "select club_id,theme_id from public.snoop_club_themes")).rows, [
    { club_id: club, theme_id: "emerald-gold" },
  ]);
  assert.deepEqual((await actor(2, "select club_id,theme_id from public.snoop_club_themes")).rows, [
    { club_id: other, theme_id: "ruby-gold" },
  ]);
  await assert.rejects(
    () =>
      actor(
        1,
        "insert into public.snoop_club_themes(club_id,theme_id) values($1,'navy-gold') on conflict(club_id) do update set theme_id=excluded.theme_id",
        [other],
      ),
    /row-level security/,
  );
  await assert.rejects(
    () => command(3, uid(1132), "prepare", "theme.set", { theme_id: "navy-gold" }),
    /ACCESS_DENIED/,
  );
  await assert.rejects(
    () => command(1, uid(1132), "prepare", "theme.set", { theme_id: "url(javascript:invalid)" }),
    /INVALID_ARGUMENTS/,
  );
  assert.deepEqual(await command(1, uid(1131), "confirm", null, null, prepared.token), done);
});

test("the original inventory report RPC satisfies the defensive UI contract without recalculating amounts", async () => {
  await db.exec(await readFile("docs/sql/SNOOP_INVENTORY_COST_REPORT_PILOT.sql", "utf8"));
  const actual = (
    await actor(
      1,
      "select public.snoop_inventory_cost_report((now() at time zone 'Europe/Madrid')::date) value",
    )
  ).rows[0].value;
  assert.deepEqual(InventoryCostReportData.parse(actual), actual);
  assert(actual.lines.length > 0);
});
