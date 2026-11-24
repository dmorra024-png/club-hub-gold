import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import {
  separationBootstrapSql,
  separationInitializationSql,
  uid,
} from "../tests/helpers/separation-db.mjs";
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
const docker = (args, input = "") =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", ["--host=unix:///var/run/docker.sock", ...args], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(Error("Isolated PostgreSQL command failed: " + err.slice(-1200))),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
let container;
try {
  container = (
    await docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      "snoop-voice-synthetic-" + randomUUID().slice(0, 8),
      "--network",
      "none",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=snoop_fixture",
      "postgres:17-alpine",
    ])
  ).trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  const psql = (sql) =>
    docker(
      [
        "exec",
        "-i",
        container,
        "psql",
        "-h",
        "127.0.0.1",
        "-X",
        "-q",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "snoop_fixture",
      ],
      sql,
    );
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      await psql("select 1");
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(ready);
  await psql(separationBootstrapSql + "\n" + (await separationInitializationSql()));
  for (const file of [
    "20261106150000_platform_club_separation.sql",
    "20261107120000_catalog_lifecycle.sql",
    "20261107123000_membership_payment_flow.sql",
  ])
    await psql(await readFile("supabase/migrations/" + file, "utf8"));
  const records = await readFile("docs/sql/SNOOP_ADMINISTRATIVE_RECORDS_PROPOSED.sql", "utf8");
  await psql(
    records.slice(
      records.indexOf("CREATE FUNCTION public.confirm_membership_with_receipt("),
      records.indexOf("ALTER TABLE public.orders ADD"),
    ),
  );
  await psql(await readFile("tests/fixtures/voice-current-membership-rpc.sql", "utf8"));
  const access = await readFile("docs/sql/SNOOP_CLUB_MERMA_POLICY_REVIEW.sql", "utf8");
  await psql(
    access.slice(
      access.indexOf("ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS access_control_enabled"),
      access.indexOf("-- Restrictive RLS combines"),
    ),
  );
  await psql(await readFile("docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql", "utf8"));
  await psql(
    `insert into auth.users(id,email)values('${uid(1)}','synthetic@example.test');insert into public.clubs(id,name,slug)values('${uid(101)}','Voice concurrency','voice-concurrency');insert into public.user_roles(user_id,role,club_id,permissions)values('${uid(1)}','admin','${uid(101)}','{}');insert into public.membership_plans(id,club_id,name,duration_days,price_cents)values('${uid(401)}','${uid(101)}','Synthetic fee',30,1000);insert into public.members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)values('${uid(501)}','${uid(101)}','Ana','Synthetic','1990-01-01','SYNTHETIC','2030-01-01');`,
  );
  const prefix = `BEGIN;SET LOCAL ROLE authenticated;SET LOCAL application_name='voice-confirm';SELECT set_config('request.jwt.claim.sub','${uid(1)}',true);`;
  const prepare = await psql(
    prefix +
      `SELECT public.snoop_voice_command('${uid(901)}','prepare','member.renew','{"member_id":"${uid(501)}","plan_id":"${uid(401)}","method":"cash"}'::jsonb,NULL);COMMIT;`,
  );
  const token = JSON.parse(prepare.split("\n").find((l) => l.startsWith("{"))).token;
  const requests = Array.from({ length: 7 }, () =>
    psql(
      prefix +
        `SELECT public.snoop_voice_command('${uid(901)}','confirm',NULL,NULL,'${token}');SELECT pg_sleep(0.5);COMMIT;`,
    ),
  );
  const allReplies = Promise.all(requests);
  void allReplies.catch(() => {});
  let waiters = 0;
  for (let n = 0; n < 50; n++) {
    const count = Number(
      (
        await psql(
          "select count(*) from pg_stat_activity where application_name='voice-confirm' and wait_event_type='Lock'",
        )
      ).trim(),
    );
    waiters = Math.max(waiters, count);
    if (waiters > 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const replies = await allReplies;
  assert(waiters > 0, "Real competing sessions must wait on locks");
  for (const reply of replies)
    assert.equal(JSON.parse(reply.split("\n").find((l) => l.startsWith("{"))).status, "completed");
  const check = JSON.parse(
    (
      await psql(
        `select jsonb_build_object('receipts',(select count(*) from public.membership_receipts where request_id='${uid(901)}'),'operations',(select count(*) from public.membership_operations where request_id='${uid(901)}'),'audit',(select count(*) from public.snoop_voice_executions where id='${uid(901)}' and completed_at is not null),'amount',(select sum(amount_cents) from public.membership_receipts where request_id='${uid(901)}'),'expires',(select expires_at from public.members where id='${uid(501)}'));`,
      )
    ).trim(),
  );
  assert.deepEqual(check, {
    receipts: 1,
    operations: 1,
    audit: 1,
    amount: 1000,
    expires: "2030-01-31",
  });
  const result = {
    engine: "PostgreSQL " + (await psql("show server_version")).trim(),
    sessions: 7,
    lockWaitersObserved: waiters,
    synthetic: true,
    network: "none",
    productionDatabase: false,
    liveDeepgram: false,
    result: "PASS",
    ...check,
  };
  await writeFile(
    "docs/JARVIS_EXECUTION_CONCURRENCY_RESULTS.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  if (container) await docker(["rm", "--force", "--volumes", container]);
}
