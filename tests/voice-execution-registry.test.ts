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
  const enabled = agentSettings("it", 48000, undefined, true, true);
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
    { action: "product.update", arguments: { id, buy_price: 420 } },
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


test("informational catalog classification matches the existing database enum",()=>{
 const id="00000000-0000-4000-8000-000000000301";
 assert(executionSchemas["product.update"].safeParse({id,strain:"hibrida"}).success);
 assert(!executionSchemas["product.update"].safeParse({id,strain:"hybrid"}).success);
 const tool=agentSettings("it",48000,undefined,true,true).agent.think.functions.find(f=>f.name==="snoop_execute");
 assert.deepEqual(JSON.parse(JSON.stringify(tool)).parameters.properties.arguments.properties.strain.enum,["sativa","indica","hibrida",null]);
});

test("JARVIS enabled pilot can propose new member and product without misreading previous-operation status as missing club session", () => {
  const enabled = agentSettings("es", 48000, undefined, true, true);
  const prompt = enabled.agent.think.prompt;
  assert.match(prompt, /CREATE a member or product/);
  assert.match(prompt, /does not need a pre-existing record reference/);
  assert.match(prompt, /A missing prior operation is not missing authentication/);
  assert.doesNotMatch(prompt, /You cannot save, pay, cancel, mutate stock or access a database directly/);
  assert(enabled.agent.think.functions.some((f) => f.name === "snoop_execute"));
  assert(enabled.agent.think.functions.some((f) => f.name === "snoop_member_requirements"));
  assert(enabled.agent.think.functions.some((f) => f.name === "snoop_genetics_information"));
});
test("JARVIS prompts retain decimal units and scoped live research without inventing web access", () => {
  const prompt = agentSettings("it", 48000, undefined, true, true).agent.think.prompt;
  for (const fragment of ["0.75 from 75", "22.50 EUR = 2250 cents", "Grams and stock deltas are NOT monetary cents", "snoop_genetics_information", "unrestricted browsing are not supported"]) {
    assert(prompt.includes(fragment), fragment);
  }
  const disabled = agentSettings("it", 48000, undefined, false, false);
  assert(!disabled.agent.think.functions.some((f) => f.name === "snoop_execute"));
});

test("Spanish and Italian abre ficha instructions route to existing member form, not voice execution status", () => {
  for (const language of ["es", "it"] as const) {
    const settings = agentSettings(language, 48000, undefined, true, true);
    const prompt = settings.agent.think.prompt;
    for (const phrase of ["abre ficha", "apri ficha", "member_create", "snoop_propose", "snoop_execution_status"]) {
      assert(prompt.includes(phrase), phrase);
    }
    for (const phrase of ["crear producto", "product_create", "Opening the form never requires a prior voice execution ID"]) assert(prompt.includes(phrase), phrase);
    assert(prompt.includes("Do not call snoop_execution_status unless the user specifically asks"));
    assert(settings.agent.think.functions.some((f) => f.name === "snoop_propose"));
  }
});

test("Spanish and Italian read-only product, stock and Caja opener commands have authorized tools", () => {
  for (const language of ["es", "it"] as const) {
    const settings = agentSettings(language, 48000, undefined, true, true);
    for (const phrase of ["quiero ver los productos", "abre stock", "quién abrió la caja hoy", "snoop_cash_openers_today"]) {
      assert(settings.agent.think.prompt.includes(phrase), phrase);
    }
    const tool = settings.agent.think.functions.find((f) => f.name === "snoop_cash_openers_today");
    assert(tool);
    assert.deepEqual(tool.parameters.required, []);
    assert.deepEqual(Object.keys(tool.parameters.properties), []);
  }
});

test("pilot speech and transcription consistently use the chosen language, never Italian fallback for Spanish", () => {
  for (const [language, expectedVoice] of [
    ["es", "flux-carmen-es"],
    ["it", "flux-paola-it"],
    ["en", "flux-kit-en"],
  ] as const) {
    const settings = agentSettings(language, 48000, undefined, true, true);
    assert.deepEqual(settings.agent.listen.provider.language_hints, [language]);
    assert.equal(settings.agent.speak.provider.model, expectedVoice);
    assert(settings.agent.think.prompt.includes("Strictly keep all spoken replies in the SELECTED language"));
    assert(settings.agent.think.prompt.includes("birth_date as unambiguous ISO YYYY-MM-DD"));
  }
});
