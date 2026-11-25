import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  executionSchemas,
  executionResults,
  executionCapabilities,
  ExecutionRequest,
} from "../src/lib/voice/execution-registry.ts";
import { MEMBER_FIELDS } from "../src/lib/member-fields.ts";
import { agentSettings } from "../src/lib/voice/agent-settings.server.ts";
test("one bounded registry and advertised provider tool agree; unapproved writes stay unadvertised", async () => {
  assert.deepEqual(Object.keys(executionSchemas).sort(), Object.keys(executionCapabilities).sort());
  assert.deepEqual(Object.keys(executionSchemas).sort(), Object.keys(executionResults).sort());
  assert(
    !executionResults["wallet.topup"].safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      balanceCents: -1,
    }).success,
  );
  assert(
    !executionResults["cash.close"].safeParse({ id: "00000000-0000-4000-8000-000000000001" })
      .success,
  );
  const disabled = agentSettings("it", 48000);
  assert(!disabled.agent.think.functions.some((f) => f.name === "snoop_execute"));
  const enabled = agentSettings("it", 48000, undefined, true, true, true);
  const tool = enabled.agent.think.functions.find((f) => f.name === "snoop_execute");
  assert(tool);
  const schema = JSON.parse(JSON.stringify(tool)).parameters;
  assert.deepEqual(schema.properties.action.enum.sort(), Object.keys(executionSchemas).sort());
  const sql = await readFile("docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql", "utf8");
  for (const field of MEMBER_FIELDS)
    assert(
      sql.includes(`('${field.key}',${field.defaultVisible},${field.defaultRequired})`),
      "Voice registration must honor current default: " + field.key,
    );
  for (const name of Object.keys(executionSchemas)) assert(sql.includes("'" + name + "'"));
  for (const capability of Object.values(executionCapabilities)) {
    assert(capability.confirmation);
    assert(sql.includes("public." + capability.rpc + "("));
  }
});
test("typed actions normalize fields and reject arbitrary RPCs, invented stock/price and unresolved references", () => {
  const id = "00000000-0000-4000-8000-000000000201";
  assert.equal(
    (
      ExecutionRequest.parse({
        action: "category.update",
        arguments: { id, name: " New name ", archived: false },
      }).arguments as { name: string }
    ).name,
    "New name",
  );
  for (const input of [
    { action: "arbitrary_sql", arguments: {} },
    { action: "category.update", arguments: { id: "record-1", name: "X", archived: false } },
    { action: "product.description", arguments: { id, description: "X", stock: 25 } },
    {
      action: "member.renew",
      arguments: { member_id: id, plan_id: id, method: "cash", amount_cents: 1 },
    },
  ])
    assert(!ExecutionRequest.safeParse(input).success);
});

test("registered references and disabled wallet capability cannot be guessed or silently advertised", () => {
  const disabled = agentSettings("es", 48000, undefined, true, false).agent.think.functions.find(
    (f) => f.name === "snoop_execute",
  );
  assert(disabled);
  assert(!JSON.stringify(disabled).includes("wallet.topup"));
  assert(!JSON.stringify(disabled).includes("member.mail.request"));
  for (const input of [
    {
      action: "stock.adjust",
      arguments: {
        id: "00000000-0000-4000-8000-000000000201",
        delta: "1.001",
        notes: "Invalid precision",
      },
    },
    { action: "cash.open", arguments: { opening_cash_cents: 125.5 } },
    {
      action: "member.update",
      arguments: { id: "00000000-0000-4000-8000-000000000201", permissions: ["admin"] },
    },
    {
      action: "wallet.topup",
      arguments: {
        member_id: "00000000-0000-4000-8000-000000000201",
        cash_session_id: "00000000-0000-4000-8000-000000000201",
        amount_cents: 100,
        method: "cash",
        confirmed: true,
      },
    },
  ])
    assert(!ExecutionRequest.safeParse(input).success);
});

test("Caja tools use opening/closing sessions, never a night register or fixed shifts", () => {
  const settings = agentSettings("it", 48000, undefined, true, true);
  const inspect = settings.agent.think.functions.find((f) => f.name === "snoop_inspect");
  assert(inspect);
  assert.match(inspect.description, /actual opening\/closing sessions/);
  assert.match(inspect.description, /never fixed shifts or a separate night cash register/);
  assert(executionSchemas["cash.open"].safeParse({ opening_cash_cents: 5000 }).success);
  assert(
    executionSchemas["cash.close"].safeParse({
      id: "00000000-0000-4000-8000-000000000201",
      closing_cash_cents: 4950,
      notes: "Conteo verificado",
    }).success,
  );
  for (const invented of ["night_register", "shift", "turno", "start_time", "end_time"])
    assert(
      !executionSchemas["cash.open"].safeParse({
        opening_cash_cents: 5000,
        [invented]: "night",
      }).success,
    );
});
