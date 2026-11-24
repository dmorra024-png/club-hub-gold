import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  executionSchemas,
  executionCapabilities,
  ExecutionRequest,
} from "../src/lib/voice/execution-registry.ts";
import { agentSettings } from "../src/lib/voice/agent-settings.server.ts";
test("one bounded registry and advertised provider tool agree; unapproved writes stay unadvertised", async () => {
  assert.deepEqual(Object.keys(executionSchemas).sort(), Object.keys(executionCapabilities).sort());
  const disabled = agentSettings("it", 48000);
  assert(!disabled.agent.think.functions.some((f) => f.name === "snoop_execute"));
  const enabled = agentSettings("it", 48000, undefined, true);
  const tool = enabled.agent.think.functions.find((f) => f.name === "snoop_execute");
  assert(tool);
  const schema = JSON.parse(JSON.stringify(tool)).parameters;
  assert.deepEqual(schema.properties.action.enum.sort(), Object.keys(executionSchemas).sort());
  const sql = await readFile("docs/sql/SNOOP_VOICE_EXECUTION_REVIEW_ONLY.sql", "utf8");
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
