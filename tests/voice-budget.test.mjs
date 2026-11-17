import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
let db;
const club = uid(501),
  other = uid(502),
  session = uid(601);
before(async () => {
  db = await separationDatabase();
  for (const name of [
    "20261106150000_platform_club_separation.sql",
    "20261117190000_voice_usage_budget.sql",
  ])
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"),
    );
  await db.exec(
    `INSERT INTO auth.users(id,email,email_confirmed_at)VALUES('${uid(1)}','a@example.test',now()),('${uid(2)}','b@example.test',now()),('${uid(3)}','c@example.test',now());INSERT INTO public.clubs(id,name,slug)VALUES('${club}','Synthetic A','voice-test-a'),('${other}','Synthetic B','voice-test-b');INSERT INTO public.user_roles(user_id,role,club_id,permissions)VALUES('${uid(1)}','admin','${club}','{}'),('${uid(2)}','admin','${other}','{}'),('${uid(3)}','collaborator','${club}','{manage_members}');`,
  );
});
after(async () => await db?.close());
async function lease(id, op, seq = 0, ms = 0, actor = uid(1), c = club) {
  return db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE service_role");
    await tx.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
    return (
      await tx.query("SELECT public.snoop_voice_usage($1,$2,$3,$4,$5,$6) AS v", [
        id,
        actor,
        c,
        op,
        seq,
        ms,
      ])
    ).rows[0].v;
  });
}
test("voice budget is atomic, idempotent, private and never modifies business data", async () => {
  const original = (await db.query("SELECT count(*)::int n FROM public.cash_sessions")).rows[0].n;
  const first = await lease(session, "start");
  assert.equal(first.reservedSeconds, 30);
  assert.equal(first.estimatedMicrousd, null);
  assert.equal(first.billedCostVerified, false);
  assert.equal((await lease(session, "start")).remainingSeconds, first.remainingSeconds);
  await assert.rejects(lease(uid(602), "start"), /already active/);
  await assert.rejects(lease(session, "extend", 1, 0, uid(2), other), /Foreign voice session/);
  await assert.rejects(lease(uid(603), "start", 0, 0, uid(3)), /Voice access revoked/);
  const extended = await lease(session, "extend", 1);
  assert.equal(extended.reservedSeconds, 60);
  assert.equal((await lease(session, "extend", 1)).reservedSeconds, 60);
  await assert.rejects(lease(session, "close", 1, 61000), /Unreserved voice duration/);
  assert.equal(
    (await db.query("SELECT state FROM public.snoop_voice_session WHERE id=$1", [session])).rows[0]
      .state,
    "active",
  );
  const closed = await lease(session, "close", 1, 1234);
  assert.equal(closed.reservedSeconds, 2);
  assert.equal(closed.connectedMs, 1234);
  assert.equal((await lease(session, "close", 1, 1234)).connectedMs, 1234);
  await db.query("UPDATE public.snoop_voice_budget SET monthly_seconds=2 WHERE club_id=$1", [club]);
  await assert.rejects(lease(uid(604), "start"), /VOICE_BUDGET_EXHAUSTED/);
  await db.query(
    "UPDATE public.snoop_voice_budget SET monthly_seconds=3600,rate_microusd_per_minute=100000,budget_microusd=10000 WHERE club_id=$1",
    [club],
  );
  const monetary = await lease(uid(606), "start");
  assert.equal(monetary.monthlySeconds, 6);
  assert.equal(monetary.reservedSeconds, 4);
  assert.equal(monetary.remainingSeconds, 0);
  await lease(uid(606), "close", 0, 0);
  await db.query(
    "UPDATE public.snoop_voice_budget SET rate_microusd_per_minute=1,budget_microusd=1000000000 WHERE club_id=$1",
    [club],
  );
  assert.equal((await lease(uid(607), "start")).monthlySeconds, 3600);
  await lease(uid(607), "close", 0, 0);
  await db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid(2)]);
    assert.equal((await tx.query("SELECT * FROM public.snoop_voice_session")).rows.length, 0);
  });
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT public.snoop_voice_usage($1,$2,$3,'start',0,0)", [
        uid(605),
        uid(1),
        club,
      ]);
    }),
    /permission denied/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM public.cash_sessions")).rows[0].n,
    original,
  );
});
