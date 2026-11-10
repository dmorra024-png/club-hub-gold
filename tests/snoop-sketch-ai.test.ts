import test from "node:test";
import assert from "node:assert/strict";
import { projectSnoopTurn } from "../src/lib/snoop-orchestrator.ts";
import { proposeSnoopSketch } from "../src/lib/voice-command-ai.server.ts";
test("GLM receives enums only and its output cannot cross the projected domain", async () => {
  const keys = [
    "AI_VOICE_INTENTS_ENABLED",
    "AI_PROVIDER",
    "SNOOP_AI_FREE_TIER_CONFIRMED",
    "AI_EXTERNAL_PROCESSING_ENABLED",
    "AI_VOICE_PROCESSING_ENABLED",
    "SNOOP_AI_ASSISTANT_MODEL",
  ];
  const saved = keys.map((k) => process.env[k]);
  const root = globalThis as typeof globalThis & { __env__?: any };
  const previous = root.__env__;
  let calls = 0,
    command = "Crear socio";
  root.__env__ = {
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: {
      run: async (_: string, payload: any) => {
        calls++;
        const wire = JSON.stringify(payload);
        assert.doesNotMatch(wire, /Marco|Rossi|666123456/);
        assert.deepEqual(JSON.parse(payload.messages[1].content).symbols, [
          "request",
          "create",
          "member",
        ]);
        return { response: JSON.stringify({ command }) };
      },
    },
  };
  try {
    Object.assign(process.env, {
      AI_VOICE_INTENTS_ENABLED: "true",
      AI_PROVIDER: "cloudflare",
      SNOOP_AI_FREE_TIER_CONFIRMED: "true",
      AI_EXTERNAL_PROCESSING_ENABLED: "true",
      AI_VOICE_PROCESSING_ENABLED: "true",
      SNOOP_AI_ASSISTANT_MODEL: "@cf/zai-org/glm-4.7-flash",
    });
    const sketch = projectSnoopTurn("Vorrei creare socio Marco Rossi 666123456", "/").sketch;
    assert.equal(await proposeSnoopSketch(sketch, "test:sketch"), "Crear socio");
    command = "Abrir caja";
    assert.equal(await proposeSnoopSketch(sketch, "test:sketch"), null);
    assert.equal(await proposeSnoopSketch({ ...sketch, text: "Marco" }, "test:sketch"), null);
    assert.equal(calls, 2);
  } finally {
    root.__env__ = previous;
    keys.forEach((k, i) =>
      saved[i] === undefined ? delete process.env[k] : (process.env[k] = saved[i]),
    );
  }
});
