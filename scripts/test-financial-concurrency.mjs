import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  separationBootstrapSql,
  separationInitializationSql,
  uid,
} from "../tests/helpers/separation-db.mjs";
const image = "postgres:17-alpine",
  name = `snoop-accounting-synthetic-${randomUUID().slice(0, 8)}`;
// Never follow a saved context or inherited endpoint to a different daemon.
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function docker(args, input = "", onData) {
  const child = spawn("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const done = new Promise((resolve, reject) => {
    let out = "",
      err = "";
    child.stdout.on("data", (d) => {
      out += d;
      onData?.(String(d));
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`Docker test command failed (${code}): ${err.slice(-1500)}`)),
    );
  });
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  return done;
}
let container;
try {
  await docker(["version", "--format", "{{.Server.Version}}"]);
  container = (
    await docker([
      "run",
      "--detach",
      "--rm",
      "--name",
      name,
      "--network",
      "none",
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=snoop_fixture",
      image,
    ])
  ).trim();
  assert.match(container, /^[a-f0-9]{64}$/);
  const psql = (sql, onData) =>
    docker(
      [
        "exec",
        "-i",
        container,
        "psql",
        "-X",
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
      onData,
    );
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      await docker(["exec", container, "pg_isready", "-U", "postgres", "-d", "snoop_fixture"]);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(ready, "isolated PostgreSQL must become ready");
  // Docker's PostgreSQL entrypoint briefly starts a temporary server and then
  // shuts it down before the final server starts. pg_isready can observe that
  // temporary server, so retry only this specific startup race.
  let initialized = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await psql(separationBootstrapSql + "\n" + (await separationInitializationSql()));
      initialized = true;
      break;
    } catch (error) {
      if (!/database system is shutting down|connection refused|no such file or directory|the database system is starting up/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(initialized, "isolated PostgreSQL initialization must complete");
  await psql(
    await readFile("supabase/migrations/20261106150000_platform_club_separation.sql", "utf8"),
  );
  await psql(`INSERT INTO auth.users(id,email)VALUES('${uid(1)}','admin@example.test'),('${uid(3)}','owner@example.test');
 INSERT INTO clubs(id,name,slug)VALUES('${uid(101)}','Synthetic accounting','synthetic-accounting');
 INSERT INTO user_roles(user_id,club_id,role,permissions)VALUES('${uid(1)}','${uid(101)}','admin','{}'),('${uid(3)}','${uid(101)}','collaborator','{manage_members,use_cash}');
 INSERT INTO members(id,club_id,first_name,last_name,birth_date,dni_number,expires_at)VALUES('${uid(501)}','${uid(101)}','Persona','Sintética','1990-01-01','TEST-CONCURRENCY','2099-12-31');
 INSERT INTO product_categories(id,club_id,name,unit_type,is_smokeable)VALUES('${uid(201)}','${uid(101)}','Material','unit',false);
 INSERT INTO products(id,club_id,category_id,name,stock)VALUES('${uid(301)}','${uid(101)}','${uid(201)}','Cuaderno',20);
 INSERT INTO orders(id,club_id,member_id,created_by,total_cents,created_at)VALUES('${uid(701)}','${uid(101)}','${uid(501)}','${uid(3)}',1500,'2026-11-01T12:00:00Z');
 INSERT INTO order_items(order_id,club_id,product_id,product_name,unit_type,quantity,unit_price_cents,line_total_cents)VALUES('${uid(701)}','${uid(101)}','${uid(301)}','Cuaderno','unit',1,1500,1500);`);
  await psql(await readFile("docs/sql/SNOOP_FINANCIAL_REVERSALS_PROPOSED.sql", "utf8"));
  const prefix = `BEGIN;SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${uid(3)}',true);`;
  const cases = [];
  for (const [operation, call] of [
    [
      "annul",
      `SELECT annul_financial_order('${uid(501)}','${uid(701)}','Revisión contable sintética');`,
    ],
    ["refund", `SELECT record_financial_refund('${uid(701)}','cash','Devolución ya realizada');`],
  ]) {
    let mark;
    const locked = new Promise((r) => (mark = r));
    const first = psql(
      prefix +
        `SELECT id FROM orders WHERE id='${uid(701)}' FOR UPDATE;\n\\echo SNOOP_TEST_ROW_LOCKED\nSELECT pg_sleep(2);\n` +
        call +
        "COMMIT;",
      (d) => {
        if (d.includes("SNOOP_TEST_ROW_LOCKED")) mark();
      },
    );
    // Fail promptly if holder fails, rather than waiting forever for a marker.
    await Promise.race([
      locked,
      first.then(() => {
        throw new Error("holder ended without lock marker");
      }),
    ]);
    const followers = Array.from({ length: 6 }, () => psql(prefix + call + "COMMIT;"));
    let waiters = 0;
    for (let n = 0; n < 8; n++) {
      const sql = `SELECT count(*) FROM pg_stat_activity WHERE datname='snoop_fixture' AND wait_event_type='Lock' AND query LIKE '%${operation === "annul" ? "annul_financial_order" : "record_financial_refund"}%';`;
      waiters = Number((await psql(sql)).trim());
      if (waiters > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const responses = await Promise.all([first, ...followers]);
    assert.ok(waiters > 0, "actual separate backends must contend for row locks");
    const ids = responses.map((text) =>
      text
        .split(/\r?\n/)
        .filter((line) => /^[a-f0-9-]{36}$/.test(line))
        .at(-1),
    );
    assert.ok(ids.every((id) => id === ids[0]));
    const table = operation === "annul" ? "financial_order_reversals" : "financial_order_refunds";
    const count = Number((await psql(`SELECT count(*) FROM ${table};`)).trim());
    assert.equal(count, 1);
    cases.push({
      operation,
      sessions: 7,
      lockWaitersObserved: waiters,
      uniqueEntries: count,
      status: "PASS",
    });
  }
  assert.equal((await psql("SELECT total_cents FROM orders;")).trim(), "1500");
  assert.equal((await psql("SELECT delta_cents FROM financial_order_reversals;")).trim(), "-1500");
  assert.equal((await psql("SELECT cents FROM financial_order_refunds;")).trim(), "1500");
  assert.equal(Number((await psql("SELECT stock FROM products;")).trim()), 20);
  const version = (await psql("SHOW server_version;")).trim();
  const result = {
    engine: `PostgreSQL ${version}`,
    image,
    synthetic: true,
    remoteDatabase: false,
    network: "none",
    publicPorts: false,
    cases,
    stockUnchanged: true,
    paymentExecuted: false,
  };
  await writeFile(
    "docs/FINANCIAL_CONCURRENCY_RESULTS.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  if (container) await docker(["rm", "--force", "--volumes", container]);
}
