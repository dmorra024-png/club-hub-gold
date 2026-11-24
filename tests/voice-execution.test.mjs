import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
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
  db = await separationDatabase();
  await db.exec(
    await readFile("supabase/migrations/20261106150000_platform_club_separation.sql", "utf8"),
  );
  for (let n = 1; n < 4; n++)
    await db.query("insert into auth.users(id,email)values($1,$2)", [
      uid(n),
      `voice-${n}@example.test`,
    ]);
  await db.exec(
    `insert into public.clubs(id,name,slug)values('${club}','Voice A','voice-a'),('${other}','Voice B','voice-b');insert into public.user_roles(user_id,role,club_id,permissions)values('${uid(1)}','admin','${club}','{}'),('${uid(2)}','admin','${other}','{}'),('${uid(3)}','collaborator','${club}','{}');`,
  );
  for (const name of [
    "20261107120000_catalog_lifecycle.sql",
    "20261107123000_membership_payment_flow.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  const membership = await readFile("docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql", "utf8");
  await db.exec(
    membership.slice(
      membership.indexOf("CREATE FUNCTION public.confirm_membership_with_receipt("),
      membership.indexOf("ALTER TABLE public.orders ADD"),
    ),
  );
  await db.exec(await readFile("tests/fixtures/voice-current-membership-rpc.sql", "utf8"));
  await db.exec(
    `INSERT INTO public.product_categories(id,club_id,name)VALUES('${uid(201)}','${club}','Office'),('${uid(202)}','${other}','Other');INSERT INTO public.products(id,club_id,category_id,name,stock,buy_price,sell_price)VALUES('${uid(301)}','${club}','${uid(201)}','Synthetic Notebook',10,100,200);INSERT INTO public.membership_plans(id,club_id,name,duration_days,price_cents)VALUES('${uid(401)}','${club}','Synthetic fee',30,1000);INSERT INTO public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)VALUES('${uid(501)}','${club}','Ana','Synthetic','1990-01-01','SYNTHETIC-VOICE','2030-01-01');`,
  );
  const existing = await readFile("docs/sql/SNOOP_CLUB_MERMA_POLICY_REVIEW.sql", "utf8");
  await db.exec(
    existing.slice(
      existing.indexOf("ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS access_control_enabled"),
      existing.indexOf("-- Restrictive RLS combines"),
    ),
  );
  await db.exec(await readFile("docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql", "utf8"));
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
const command = async (user, id, operation, action = null, args = null, token = null) =>
  (
    await actor(user, "select public.snoop_voice_command($1,$2,$3,$4,$5) value", [
      id,
      operation,
      action,
      args,
      token,
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
test("fractional legacy prices block metadata writes without rounding or changing stored amounts", async () => {
  await db.query("update public.products set buy_price=4.20 where id=$1", [uid(301)]);
  await assert.rejects(
    () =>
      command(1, uid(820), "prepare", "product.description", {
        id: uid(301),
        description: "No mutation",
      }),
    /LEGACY_PRICE_UNSUPPORTED/,
  );
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
