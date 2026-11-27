import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSettings } from "../src/lib/voice/agent-settings.server.ts";
import { gervisAvailableCapabilities, gervisBrainPrompt } from "../src/lib/gervis-snoop/brain.ts";
import { voiceDestinationNames } from "../src/lib/voice/destinations.ts";
import { executionCapabilities } from "../src/lib/voice/execution-registry.ts";
import { RecordsQuery } from "../src/lib/voice/records-read.server.ts";

test("Gervis capability vocabulary derives from existing registry, not made-up tools", () => {
  assert.deepEqual(gervisAvailableCapabilities.navigate, voiceDestinationNames);
  assert.deepEqual(gervisAvailableCapabilities.read, [...RecordsQuery.shape.kind.options]);
  assert.deepEqual(gervisAvailableCapabilities.execute, Object.keys(executionCapabilities));
});

test("Gervis is opt-in; existing Deepgram speech settings and exact tools are unchanged", () => {
  const base = agentSettings("es", 16000);
  const gervis = agentSettings("es", 16000, undefined, false, false, true);
  assert.deepEqual(gervis.agent.listen, base.agent.listen);
  assert.deepEqual(gervis.agent.speak, base.agent.speak);
  assert.deepEqual(gervis.audio, base.audio);
  assert.deepEqual(gervis.agent.think.functions, base.agent.think.functions);
  assert.equal(gervis.agent.think.provider.model, base.agent.think.provider.model);
  assert.notEqual(gervis.agent.think.prompt, base.agent.think.prompt);
  assert.match(gervis.agent.think.prompt, /one intelligent coworker/);
  assert.match(gervis.agent.think.prompt, /DISABLED\. Never call it/);
  assert.match(gervis.agent.think.prompt, /human confirmation/);
  assert.match(gervis.agent.think.prompt, /member_create/);
});

test("Gervis never enables mutations merely by rewriting the prompt", () => {
  const noExec = agentSettings("it", 16000, undefined, false, false, true);
  const exec = agentSettings("it", 16000, undefined, true, true, true);
  const functionNames = (x: typeof noExec) =>
    x.agent.think.functions.map((v) => v.name);
  assert.equal(functionNames(noExec).includes("snoop_execute"), false);
  assert.equal(functionNames(exec).includes("snoop_execute"), true);
  assert.match(noExec.agent.think.prompt, /DISABLED/);
  assert.match(exec.agent.think.prompt, /registered server actions/);
  assert.match(noExec.agent.think.prompt, /snoop_propose/);
  assert.match(noExec.agent.think.prompt, /No previous execution ID|previous execution ID/i);
});

test("Gervis natural coworker policy distinguishes error types and multi-step tasks", () => {
  const p = gervisBrainPrompt({ language: "es", executionEnabled: false, walletEnabled: false, today: "2026-11-27" });
  for (const phrase of [
    "Quiero crear un socio", "Muéstrame los ingresos y el inventario",
    "¿Quién abrió la caja hoy?", "Busca a Fátima",
    "transient service failure", "unauthorized account",
    "human confirmation", "2026-11-27",
  ]) assert.ok(p.includes(phrase), phrase);
  assert.equal(p.includes("gpt-4o-mini"), false, "Brain policy is model-agnostic");
});
