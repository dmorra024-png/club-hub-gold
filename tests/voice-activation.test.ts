import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  transcribeAdministrativeAudio,
  administrativeAiStatus,
  administrativeModel,
} from "../src/lib/administrative-ai.server.ts";
import { privateVoiceCommand, privateCatalogCommand } from "../src/lib/private-voice.ts";
import { FREE_AUDIO_MODEL } from "../src/lib/workers-ai.server.ts";
import { parseAdministrativeDictation } from "../src/lib/member-administration.ts";
const names = [
  "AI_PROVIDER",
  "AI_EXTERNAL_PROCESSING_ENABLED",
  "AI_VOICE_PROCESSING_ENABLED",
  "AI_VOICE_ONLY",
  "AI_PERSONAL_DATA_PROCESSING_ENABLED",
  "AI_DOCUMENT_PROCESSING_ENABLED",
  "AI_BROWSER_SPEECH_ENABLED",
  "AI_API_KEY",
];
const initial = new Map(names.map((n) => [n, process.env[n]]));
const g = globalThis as typeof globalThis & { __env__?: any };
const initialBinding = g.__env__;
afterEach(() => {
  for (const [k, v] of initial) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  g.__env__ = initialBinding;
});
function configure(run: (model: string, input: Record<string, unknown>) => Promise<unknown>) {
  Object.assign(process.env, {
    AI_PROVIDER: "cloudflare",
    AI_EXTERNAL_PROCESSING_ENABLED: "true",
    AI_VOICE_PROCESSING_ENABLED: "true",
    AI_VOICE_ONLY: "true",
    AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
    AI_DOCUMENT_PROCESSING_ENABLED: "false",
    AI_BROWSER_SPEECH_ENABLED: "false",
  });
  g.__env__ = { SNOOP_RESOURCE_NAMESPACE: "snoop-pilot", SNOOP_AI: { run } };
}
test("authorized voice is available without enabling personal-field models, documents or browser speech", () => {
  configure(async () => ({ text: "Synthetic" }));
  assert.deepEqual(administrativeAiStatus(), {
    available: true,
    documents: false,
    browserSpeech: false,
  });
  for (const purpose of ["administrative", "catalog", "documents"] as const)
    assert.throws(() => administrativeModel(purpose), /Perfil de voz/);
  delete process.env.AI_VOICE_PROCESSING_ENABLED;
  assert.equal(administrativeAiStatus().available, false);
});
test("IT/ES audio uses only the authorized binding model and then fills fields locally", async () => {
  for (const [language, text, name, surname] of [
    [
      "it",
      "nome Persona cognome Sintetica data di nascita 2000-01-02 città Demo telefono 000000000 quota Mensile",
      "Persona",
      "Sintetica",
    ],
    [
      "es",
      "nombre Persona apellido Sintética fecha de nacimiento 2000-01-02 ciudad Demo teléfono 000000000 cuota Mensual",
      "Persona",
      "Sintética",
    ],
  ] as const) {
    let calls = 0;
    configure(async (model, input) => {
      calls++;
      assert.equal(model, FREE_AUDIO_MODEL);
      assert.deepEqual(Object.keys(input).sort(), ["audio", "language", "task", "vad_filter"]);
      assert.equal(input.language, language);
      return { text };
    });
    const result = await transcribeAdministrativeAudio({
      audioBase64: "U1lOVEhFVElDLUFVRElP",
      mimeType: "audio/webm;codecs=opus",
      language,
    });
    const fields = parseAdministrativeDictation(result.text, ["Mensual"]);
    assert.equal(fields.first_name, name);
    assert.equal(fields.last_name, surname);
    assert.equal(fields.birth_date, "2000-01-02");
    assert.equal(fields.plan_name, "Mensual");
    assert.equal(calls, 1);
  }
});
test("free-quota failure is not retried and never falls back to another provider", async () => {
  let calls = 0;
  configure(async () => {
    calls++;
    throw new Error("Synthetic free allocation exhausted");
  });
  process.env.AI_API_KEY = "synthetic-unused-fallback";
  await assert.rejects(
    transcribeAdministrativeAudio({ audioBase64: "YQ==", mimeType: "audio/ogg", language: "it" }),
    /transcripción no disponible/,
  );
  assert.equal(calls, 1);
});
test("invalid audio never reaches the model", async () => {
  let calls = 0;
  configure(async () => {
    calls++;
    return { text: "Synthetic" };
  });
  await assert.rejects(
    transcribeAdministrativeAudio({
      audioBase64: "not base64!",
      mimeType: "audio/webm",
      language: "es",
    }),
  );
  await assert.rejects(
    transcribeAdministrativeAudio({ audioBase64: "YQ==", mimeType: "image/png", language: "es" }),
  );
  assert.equal(calls, 0);
});
test("private administrative commands and field drafts understand Italian and Spanish without writes", () => {
  for (const text of [
    "crea nuovo socio nome Persona cognome Sintetica",
    "crear nuevo socio nombre Persona apellido Sintética",
  ]) {
    const result = privateVoiceCommand(text);
    assert.equal(result.navigateTo, "/soci/nuovo");
    assert.equal(result.permission, "manage_members");
    assert.equal(result.memberDraft?.first_name, "Persona");
    assert.ok(!("save" in result));
  }
  for (const [text, path] of [
    ["apri inventario", "/productos"],
    ["abrir productos", "/productos"],
    ["apri report", "/ajustes/informes"],
    ["abrir informes", "/ajustes/informes"],
    ["apri quote", "/cuotas"],
    ["abrir cuotas", "/cuotas"],
  ])
    assert.equal(privateVoiceCommand(text).navigateTo, path);
});
test("catalog dictation fills only drafts and does not send stored catalog fields to a text model", () => {
  const categories = [
    { id: "synthetic-category", name: "Cancelleria", unit_type: "unit", is_smokeable: false },
  ];
  for (const text of [
    "crea prodotto Registro in categoria Cancelleria stock 3 costo 2 prezzo 4",
    "crear producto Registro en categoria Cancelleria stock 3 compra 2 precio 4",
  ]) {
    const parsed = privateCatalogCommand(text, categories);
    assert.equal(parsed.action, "create_product");
    assert.equal(parsed.product_name, "Registro");
    assert.equal(parsed.category_id, "synthetic-category");
    assert.equal(parsed.stock, 3);
    assert.equal(parsed.buy_price, 2);
    assert.equal(parsed.sell_price, 4);
  }
});

test("voice-only configuration refuses another provider even when an old API key exists", async () => {
  configure(async () => ({ text: "Synthetic" }));
  process.env.AI_PROVIDER = "openai-compatible";
  process.env.AI_API_KEY = "synthetic-unused-old-key";
  await assert.rejects(
    transcribeAdministrativeAudio({ audioBase64: "YQ==", mimeType: "audio/webm", language: "es" }),
    /no se permite un proveedor alternativo/,
  );
});
