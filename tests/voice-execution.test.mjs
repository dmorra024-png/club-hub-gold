import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
import {
  voiceAccessOperation,
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
