import test from "node:test";
import assert from "node:assert/strict";
import { memberConversation } from "../src/lib/voice-conversation.ts";
import { resolveVoiceUtterance } from "../src/lib/voice-intents.ts";
import { proposeVoiceCommand, reserveSnoopRequest } from "../src/lib/voice-command-ai.server.ts";
test("SNOOP understands combined dates, city, contextual phone and correction without other fields", () => {
  const first = memberConversation(
    { awaiting: "birth" },
    "12 marzo 1995, vive a Palma",
    { first_name: "Marco", last_name: "Rossi" },
    [],
    true,
  );
  assert.deepEqual(first.patch, { city: "Palma", birth_date: "1995-03-12" });
  assert.equal(first.state.awaiting, "phone");
  const next = memberConversation(
    first.state,
    "Sì, 666123456. Anzi, cambia il cognome in Bianchi",
    { first_name: "Marco", last_name: "Rossi", birth_date: "1995-03-12", city: "Palma" },
    [],
    true,
  );
  assert.deepEqual(next.patch, { phone: "666123456", last_name: "Bianchi" });
  const compound = memberConversation(
    { awaiting: "name" },
    "Nombre Juan Carlos, apellidos García López",
    {},
    [],
  );
  assert.deepEqual(compound.patch, { first_name: "Juan Carlos", last_name: "García López" });
  assert.deepEqual(
    memberConversation({ awaiting: "birth" }, "12 de marzo de 1995, vive en Palma", {}, []).patch,
    { city: "Palma", birth_date: "1995-03-12" },
  );
  assert.deepEqual(resolveVoiceUtterance("Snoop, fermati", "/soci/nuovo"), { kind: "stop" });
});
test("SNOOP quotas isolate club/user scopes and expire without keeping text", () => {
  for (let i = 0; i < 30; i++) assert.equal(reserveSnoopRequest("budget:club1:user1", 0), true);
  assert.equal(reserveSnoopRequest("budget:club1:user1", 0), false);
  assert.equal(reserveSnoopRequest("budget:club2:user1", 0), true);
  assert.equal(reserveSnoopRequest("budget:club1:user2", 0), true);
  assert.equal(reserveSnoopRequest("budget:club1:user1", 3600001), true);
});
test("GLM quota rejection makes one request, never retries or switches models", async () => {
  const keys = [
    "AI_VOICE_INTENTS_ENABLED",
    "AI_PROVIDER",
    "AI_EXTERNAL_PROCESSING_ENABLED",
    "AI_VOICE_ONLY",
    "AI_PERSONAL_DATA_PROCESSING_ENABLED",
    "SNOOP_AI_FREE_TIER_CONFIRMED",
    "SNOOP_AI_ASSISTANT_MODEL",
    "AI_CF_TEXT_MODEL",
    "AI_VOICE_PROCESSING_ENABLED",
  ];
  const saved = keys.map((k) => process.env[k]);
  const root = globalThis as any;
  const old = root.__env__;
  let calls = 0;
  try {
    Object.assign(process.env, {
      AI_VOICE_INTENTS_ENABLED: "true",
      AI_PROVIDER: "cloudflare",
      AI_EXTERNAL_PROCESSING_ENABLED: "true",
      AI_VOICE_ONLY: "false",
      AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
      AI_VOICE_PROCESSING_ENABLED: "true",
      SNOOP_AI_FREE_TIER_CONFIRMED: "true",
    });
    delete process.env.SNOOP_AI_ASSISTANT_MODEL;
    delete process.env.AI_CF_TEXT_MODEL;
    root.__env__ = {
      SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
      SNOOP_AI: {
        run: async (model: string) => {
          calls++;
          assert.equal(model, "@cf/zai-org/glm-4.7-flash");
          throw Object.assign(new Error("quota exceeded"), { status: 429 });
        },
      },
    };
    await assert.rejects(
      proposeVoiceCommand("quisiera crear un socio", "quota:club:user"),
      /quota exceeded/,
    );
    assert.equal(calls, 1);
    process.env.SNOOP_AI_FREE_TIER_CONFIRMED = "false";
    assert.equal(await proposeVoiceCommand("quisiera crear un socio"), null);
    assert.equal(calls, 1);
  } finally {
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
    root.__env__ = old;
  }
});

test("compound full names are clarified conversationally without guessing their boundaries", () => {
  for (const awaiting of ["name", "first", "last"] as const)
    assert.deepEqual(memberConversation({ awaiting }, "Un momento", {}, []).patch, {});
  const ambiguous = memberConversation({ awaiting: "name" }, "Juan Carlos García López", {}, []);
  assert.deepEqual(ambiguous.patch, {});
  assert.equal(ambiguous.state.awaiting, "first");
  const first = memberConversation(ambiguous.state, "Juan Carlos", {}, []);
  assert.deepEqual(first.patch, { first_name: "Juan Carlos" });
  assert.equal(first.state.awaiting, "last");
  const last = memberConversation(first.state, "García López", first.patch, []);
  assert.deepEqual(last.patch, { last_name: "García López" });
  assert.equal(last.state.awaiting, "birth");
});

test("validated AI navigation must match the explicit input domain; decimals stay in local drafts", async () => {
  const { proposalMatchesInput } = await import("../src/lib/voice-command-ai.ts");
  const { contextualProductDictation } = await import("../src/lib/product-form-voice.ts");
  assert.equal(
    proposalMatchesInput("Crear socio", "quisiera ir a la pantalla para dar de alta un miembro"),
    true,
  );
  assert.equal(proposalMatchesInput("Crear producto", "quisiera crear un socio"), false);
  assert.equal(proposalMatchesInput("Crear socio", "ver socios"), false);
  assert.equal(proposalMatchesInput("Abrir caja", "abrir caja producto"), false);
  assert.equal(proposalMatchesInput("borrar socios", "crear socio"), false);
  assert.deepEqual(
    contextualProductDictation("Stock veinte coma cinco, precio diez euros con cincuenta", []),
    { stock: 20.5, sell_price: 10.5 },
  );
});
test("GLM wait expires after five seconds without another provider or request", async (t) => {
  const keys = [
    "AI_VOICE_INTENTS_ENABLED",
    "AI_PROVIDER",
    "AI_EXTERNAL_PROCESSING_ENABLED",
    "AI_VOICE_PROCESSING_ENABLED",
    "SNOOP_AI_FREE_TIER_CONFIRMED",
    "SNOOP_AI_ASSISTANT_MODEL",
  ];
  const saved = keys.map((k) => process.env[k]);
  const root = globalThis as any;
  const old = root.__env__;
  let calls = 0;
  try {
    Object.assign(process.env, {
      AI_VOICE_INTENTS_ENABLED: "true",
      AI_PROVIDER: "cloudflare",
      AI_EXTERNAL_PROCESSING_ENABLED: "true",
      AI_VOICE_PROCESSING_ENABLED: "true",
      SNOOP_AI_FREE_TIER_CONFIRMED: "true",
    });
    delete process.env.SNOOP_AI_ASSISTANT_MODEL;
    root.__env__ = {
      SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
      SNOOP_AI: {
        run: () => {
          calls++;
          return new Promise(() => {});
        },
      },
    };
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const request = proposeVoiceCommand("quisiera crear un socio", "timeout:club:user");
    t.mock.timers.tick(5001);
    await assert.rejects(request, /tarda demasiado/);
    assert.equal(calls, 1);
  } finally {
    t.mock.timers.reset();
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
    root.__env__ = old;
  }
});
