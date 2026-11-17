import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { separationDatabase, uid } from "./helpers/separation-db.mjs";
import { VoiceUsageLease } from "../src/lib/voice/usage.server.ts";

// SDK -> synthetic HTTP adapter -> real isolated PostgreSQL/PGlite function.
// No Cloudflare/Deepgram/Supabase network, real identities, credentials or billing.
let db;
const events = [];
before(async () => {
  db = await separationDatabase();
  for (const name of [
    "20261106150000_platform_club_separation.sql",
    "20261117190000_voice_usage_budget.sql",
  ])
    await db.exec(
      await readFile(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"),
    );
  for (let n = 1; n <= 8; n++) {
    await db.query("INSERT INTO auth.users(id,email,email_confirmed_at)VALUES($1,$2,now())", [
      uid(n),
      `synthetic-${n}@example.test`,
    ]);
  }
  for (let n = 0; n < 4; n++) {
    await db.query("INSERT INTO clubs(id,name,slug)VALUES($1,$2,$3)", [
      uid(501 + n),
      `Synthetic voice ${n}`,
      `voice-integration-${n}`,
    ]);
    for (const actor of [n * 2 + 1, n * 2 + 2])
      await db.query(
        "INSERT INTO user_roles(user_id,role,club_id,permissions)VALUES($1,'admin',$2,'{}')",
        [uid(actor), uid(501 + n)],
      );
  }
});
after(async () => await db?.close());
function lease(actor, club, clock, loseFirstCloseReply = false) {
  let lost = false;
  return new VoiceUsageLease({
    url: "https://bnwanxbmprbymbutoths.supabase.co",
    key: "sb_secret_SYNTHETIC_TEST_ONLY",
    actor: uid(actor),
    club: uid(club),
    now: () => clock.now,
    fetch: async (url, init) => {
      assert.equal(url, "https://bnwanxbmprbymbutoths.supabase.co/rest/v1/rpc/snoop_voice_usage");
      assert.equal(init.method, "POST");
      const p = JSON.parse(init.body);
      assert.equal(p.p_actor, uid(actor));
      assert.equal(p.p_club, uid(club));
      events.push({ id: p.p_id, operation: p.p_operation, elapsed: p.p_connected_ms });
      let result;
      try {
        result = await db.transaction(async (tx) => {
          await tx.exec("SET LOCAL ROLE service_role");
          await tx.query("SELECT set_config('request.jwt.claim.role','service_role',true)");
          return (
            await tx.query("SELECT snoop_voice_usage($1,$2,$3,$4,$5,$6) AS value", [
              p.p_id,
              p.p_actor,
              p.p_club,
              p.p_operation,
              p.p_sequence,
              p.p_connected_ms,
            ])
          ).rows[0].value;
        });
      } catch (e) {
        return Response.json({ message: e.message }, { status: 400 });
      }
      if (loseFirstCloseReply && p.p_operation === "close" && !lost) {
        lost = true;
        clock.now += 5000;
        throw new TypeError("synthetic response lost after database commit");
      }
      return Response.json(result);
    },
  });
}
const month = async (club) =>
  (
    await db.query("SELECT reserved_seconds,connected_ms FROM snoop_voice_month WHERE club_id=$1", [
      uid(club),
    ])
  ).rows[0];

test("meter client and actual SQL reconcile open, duplicate start, two renewals and one close", async () => {
  const clock = { now: Date.now() };
  const v = lease(1, 501, clock);
  const first = await v.start();
  assert.equal(first.reservedSeconds, 30);
  assert.equal(first.monthlySeconds, 3600);
  assert.equal(first.estimatedMicrousd, null);
  assert.equal(first.billedCostVerified, false);
  await v.start();
  assert.equal((await month(501)).reserved_seconds, 30);
  v.markConnected();
  assert(v.valid());
  assert.equal((await v.extend()).reservedSeconds, 60);
  assert.equal((await v.extend()).reservedSeconds, 90);
  clock.now += 12500;
  await v.close();
  await v.close();
  assert(!v.valid());
  const actual = await month(501);
  assert.equal(actual.reserved_seconds, 13);
  assert.equal(Number(actual.connected_ms), 12500);
  assert.equal(events.filter((e) => e.id === v.id && e.operation === "close").length, 1);
});

test("monthly cap is shared by authorized actors and unused reservation is released exactly once", async () => {
  await db.query("INSERT INTO snoop_voice_budget(club_id,monthly_seconds)VALUES($1,60)", [
    uid(502),
  ]);
  const clock = { now: Date.now() };
  const first = lease(3, 502, clock),
    second = lease(4, 502, clock);
  await first.start();
  first.markConnected();
  clock.now += 29000;
  await first.close();
  assert.equal((await month(502)).reserved_seconds, 29);
  clock.now = Date.now();
  const opened = await second.start();
  second.markConnected();
  assert.equal(opened.remainingSeconds, 1);
  const renewed = await second.extend();
  assert.equal(renewed.reservedSeconds, 31);
  assert.equal(renewed.remainingSeconds, 0);
  const denied = lease(3, 502, clock);
  await assert.rejects(denied.start(), /VOICE_BUDGET_EXHAUSTED/);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM snoop_voice_session WHERE id=$1", [denied.id]))
      .rows[0].n,
    0,
  );
  clock.now += 1000;
  await second.close();
  await second.close();
  assert.equal((await month(502)).reserved_seconds, 30);
  assert.equal(Number((await month(502)).connected_ms), 30000);
  clock.now = Date.now();
  const reopened = lease(3, 502, clock);
  assert.equal((await reopened.start()).reservedSeconds, 30);
  await reopened.close();
  assert.equal((await month(502)).reserved_seconds, 30);
});

test("known-rate monetary cap constrains reservations; suspended club cannot renew", async () => {
  await db.query(
    "INSERT INTO snoop_voice_budget(club_id,monthly_seconds,rate_microusd_per_minute,budget_microusd)VALUES($1,3600,100000,100000)",
    [uid(503)],
  );
  const clock = { now: Date.now() };
  const v = lease(5, 503, clock);
  assert.equal((await v.start()).monthlySeconds, 60);
  v.markConnected();
  await v.extend();
  await assert.rejects(v.extend(), /VOICE_BUDGET_EXHAUSTED/);
  assert.equal((await month(503)).reserved_seconds, 60);
  clock.now += 60000;
  await v.close();
  assert.equal((await month(503)).reserved_seconds, 60);
  assert.equal(Number((await month(503)).connected_ms), 60000);
  await assert.rejects(lease(6, 503, clock).start(), /VOICE_BUDGET_EXHAUSTED/);
  await db.query("UPDATE snoop_voice_budget SET budget_microusd=200000 WHERE club_id=$1", [
    uid(503),
  ]);
  clock.now = Date.now();
  const limited = lease(6, 503, clock);
  await limited.start();
  await db.query("UPDATE clubs SET active=false WHERE id=$1", [uid(503)]);
  await assert.rejects(limited.extend(), /VOICE_USAGE_UNAVAILABLE/);
  assert.equal((await month(503)).reserved_seconds, 90);
});

test("lost acknowledgement after SQL commit can be retried without duplicate consumption", async () => {
  const clock = { now: Date.now() };
  const v = lease(7, 504, clock, true);
  await v.start();
  v.markConnected();
  clock.now += 1200;
  await assert.rejects(v.close(), /response lost after database commit/);
  assert.equal(Number((await month(504)).connected_ms), 1200);
  await v.close();
  await v.close();
  assert(!v.valid());
  assert.equal(Number((await month(504)).connected_ms), 1200);
  assert.equal((await month(504)).reserved_seconds, 2);
  assert.deepEqual(
    events.filter((e) => e.id === v.id && e.operation === "close").map((e) => e.elapsed),
    [1200, 1200],
  );
  assert.equal(
    (await db.query("SELECT state FROM snoop_voice_session WHERE id=$1", [v.id])).rows[0].state,
    "closed",
  );
});
