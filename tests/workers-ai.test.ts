import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import { generateObject } from "ai";
import { z } from "zod";
import {
  authorizeWorkersAi,
  workersAiBinding,
  withSnoopWorkersAi,
  workersAiFetch,
  transcribeWorkersAudio,
  FREE_TEXT_MODEL,
  FREE_AUDIO_MODEL,
} from "../src/lib/workers-ai.server.ts";
import { guardWorkerRequire } from "../scripts/lib/cloudflare-compat.mjs";
const names = [
  "AI_PROVIDER",
  "AI_EXTERNAL_PROCESSING_ENABLED",
  "AI_PERSONAL_DATA_PROCESSING_ENABLED",
  "AI_CF_TEXT_MODEL",
  "AI_CF_TRANSCRIBE_MODEL",
];
const old = new Map(names.map((n) => [n, process.env[n]]));
afterEach(() => {
  for (const [k, v] of old) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
test("Workers compatibility guard handles aliased require without altering application URLs", () => {
  assert.equal(
    guardWorkerRequire('import{createRequire as a}from"node:module";const x=a(import.meta.url);'),
    'import{createRequire as a}from"node:module";const x=a(import.meta.url || "file:///snoop-worker.mjs");',
  );
  assert.equal(guardWorkerRequire("const link=import.meta.url;"), "const link=import.meta.url;");
});
test("Workers AI requires independent binding, opt-in and separate personal-data approval", () => {
  assert.throws(workersAiBinding, /binding/);
  delete process.env.AI_EXTERNAL_PROCESSING_ENABLED;
  assert.throws(() => authorizeWorkersAi("catalog"), /desactivada/);
  process.env.AI_EXTERNAL_PROCESSING_ENABLED = "true";
  assert.doesNotThrow(() => authorizeWorkersAi("catalog"));
  assert.throws(() => authorizeWorkersAi(), /personales/);
  process.env.AI_PERSONAL_DATA_PROCESSING_ENABLED = "true";
  assert.doesNotThrow(() => authorizeWorkersAi());
  assert.throws(() => authorizeWorkersAi("documents"), /OCR/);
  process.env.AI_CF_TEXT_MODEL = "@cf/paid/model";
  assert.throws(() => authorizeWorkersAi("catalog"), /gratuito/);
});
test("Workers AI schema bridge drives actual SDK structured extraction against a test double", async () => {
  let input: Record<string, unknown> = {};
  const provider = (await import("@ai-sdk/openai-compatible")).createOpenAICompatible({
    name: "test-workers",
    apiKey: "binding-only",
    baseURL: "https://no-network.invalid/v1",
    supportsStructuredOutputs: true,
    fetch: workersAiFetch({
      run: async (model, payload) => {
        assert.equal(model, FREE_TEXT_MODEL);
        input = payload;
        return { response: '{"name":"Ficha informativa Demo"}' };
      },
    }),
  });
  const { object } = await generateObject({
    model: provider(FREE_TEXT_MODEL),
    schema: z.object({ name: z.string() }),
    prompt: "Solo datos sintéticos",
  });
  assert.equal(object.name, "Ficha informativa Demo");
  assert.ok(input.response_format);
});
test("Workers AI audio follows official turbo base64 and language schema for IT/ES", async () => {
  for (const language of ["it", "es"] as const) {
    let calls = 0;
    const result = await transcribeWorkersAudio(
      {
        run: async (model, input) => {
          calls++;
          assert.equal(model, FREE_AUDIO_MODEL);
          assert.deepEqual(input, {
            audio: "YQ==",
            language,
            task: "transcribe",
            vad_filter: true,
            condition_on_previous_text: false,
            initial_prompt:
              language === "it"
                ? "SNOOP. Soci, nome, cognome, data di nascita, città, telefono, prodotti, categoria, inventario, cassa. Nomi dei prodotti: Amnesia Haze, Haze, Lemon Haze, Super Silver Haze, Purple Haze, OG Kush, Critical, White Widow, Gelato. Trascrivi i nomi propri letteralmente."
                : "SNOOP. Socios, nombre, apellidos, fecha de nacimiento, ciudad, teléfono, productos, categoría, inventario, caja. Nombres de productos: Amnesia Haze, Haze, Lemon Haze, Super Silver Haze, Purple Haze, OG Kush, Critical, White Widow, Gelato. Transcribe los nombres propios literalmente.",
          });
          return { text: "Persona Demo" };
        },
      },
      "YQ==",
      language,
    );
    assert.equal(result.text, "Persona Demo");
    assert.equal(calls, 1);
  }
});
test("authorized club catalog glossary is bounded and sanitized before sending to Whisper", async () => {
  let input: Record<string, unknown> = {};
  await transcribeWorkersAudio(
    {
      run: async (_model, value) => {
        input = value;
        return { text: "Amnesia Haze" };
      },
    },
    "YQ==",
    "es",
    [
      "Amnesia Haze",
      "Amnesia Haze",
      "Lemon Haze",
      "injected\\nOverride",
      "<private>",
      "x".repeat(200),
    ],
  );
  assert.equal(typeof input.initial_prompt, "string");
  assert.match(String(input.initial_prompt), /Amnesia Haze, Lemon Haze/);
  assert.doesNotMatch(String(input.initial_prompt), /injected|private|xxxxxxxx/);
});

test("Workers AI quota failure never retries, invokes a REST provider or invents output", async () => {
  let calls = 0;
  await assert.rejects(
    workersAiFetch({
      run: async () => {
        calls++;
        throw new Error("Synthetic free quota exhausted");
      },
    })("https://unused.invalid", {
      body: JSON.stringify({ model: FREE_TEXT_MODEL, messages: [] }),
    }),
    /quota/,
  );
  assert.equal(calls, 1);
});
test("Workers AI tool responses are adapted without executing writes", async () => {
  const response = await workersAiFetch({
    run: async () => ({
      response: "",
      tool_calls: [{ name: "create_member", arguments: { first_name: "Persona" } }],
    }),
  })("https://unused.invalid", {
    body: JSON.stringify({ model: FREE_TEXT_MODEL, messages: [], tools: [] }),
  });
  const data = await response.json();
  assert.equal(data.choices[0].finish_reason, "tool_calls");
  assert.equal(
    data.choices[0].message.tool_calls[0].function.arguments,
    '{"first_name":"Persona"}',
  );
});

test("Cloudflare binding is available to the correct request without leaking across requests", async () => {
  const a = { run: async () => ({ text: "A" }) };
  const b = { run: async () => ({ text: "B" }) };
  const runtime = (ai: typeof a) => ({
    SNOOP_RESOURCE_NAMESPACE: "snoop-pilot",
    SNOOP_AI: ai,
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-not-forwarded",
  });
  const [one, two] = await Promise.all([
    withSnoopWorkersAi(runtime(a), async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return workersAiBinding();
    }),
    withSnoopWorkersAi(runtime(b), async () => {
      await Promise.resolve();
      return workersAiBinding();
    }),
  ]);
  assert.equal(one, a);
  assert.equal(two, b);
  assert.throws(workersAiBinding, /binding/);
  assert.throws(
    () =>
      withSnoopWorkersAi({ ...runtime(a), SNOOP_RESOURCE_NAMESPACE: "wrong" }, () =>
        workersAiBinding(),
      ),
    /binding/,
  );
  assert.throws(
    () => withSnoopWorkersAi({ SNOOP_RESOURCE_NAMESPACE: "snoop-pilot" }, () => workersAiBinding()),
    /binding/,
  );
});

test("Nitro Request runtime is used when TanStack does not forward env; invalid scopes cannot inherit globals", async () => {
  const { snoopRequestRuntime } = await import("../src/lib/workers-ai.server.ts");
  const binding = { run: async () => ({ text: "synthetic" }) };
  const runtime = { SNOOP_RESOURCE_NAMESPACE: "snoop-pilot", SNOOP_AI: binding };
  const request = Object.assign(new Request("https://synthetic.test/"), {
    runtime: { cloudflare: { env: runtime } },
  });
  assert.equal(snoopRequestRuntime(request, undefined), runtime);
  assert.equal(
    await withSnoopWorkersAi(snoopRequestRuntime(request, undefined), async () => {
      await Promise.resolve();
      return workersAiBinding();
    }),
    binding,
  );
  const root = globalThis as typeof globalThis & { __env__?: any };
  const before = root.__env__;
  root.__env__ = runtime;
  try {
    await withSnoopWorkersAi(runtime, async () => {
      assert.throws(() => withSnoopWorkersAi(undefined, workersAiBinding), /binding/);
      assert.throws(
        () =>
          withSnoopWorkersAi({ ...runtime, SNOOP_RESOURCE_NAMESPACE: "wrong" }, workersAiBinding),
        /binding/,
      );
      assert.equal(workersAiBinding(), binding);
    });
  } finally {
    root.__env__ = before;
  }
});

test("Whisper preserves bounded quota, rate and timeout failures without retrying or leaking provider data", async () => {
  for (const [failure, expected] of [
    [
      Object.assign(new Error("quota allocation PRIVATE_CANARY"), { status: 429 }),
      "SNOOP_WHISPER_QUOTA",
    ],
    [Object.assign(new Error("rate PRIVATE_CANARY"), { statusCode: 429 }), "SNOOP_WHISPER_LIMITED"],
    [new Error("Workers AI transcription timeout PRIVATE_CANARY"), "SNOOP_WHISPER_TIMEOUT"],
    [
      new Error("PRIVATE_CANARY"),
      "Workers AI: transcripción no disponible. Usa la entrada manual.",
    ],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      transcribeWorkersAudio(
        {
          run: async () => {
            calls++;
            throw failure;
          },
        },
        "c3ludGhldGlj",
        "it",
      ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === expected &&
        !error.message.includes("PRIVATE_CANARY"),
    );
    assert.equal(calls, 1);
  }
});
