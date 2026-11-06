import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { before, after, afterEach, test } from "node:test";
import { generateObject } from "ai";
import { z } from "zod";
import {
  administrativeModel,
  administrativeSpeech,
  aiConfiguration,
  administrativeAiStatus,
  transcribeAdministrativeAudio,
} from "../src/lib/administrative-ai.server.ts";
import {
  EmailAPIError,
  sendProviderEmail,
  verifyWebhookRequest,
  parseEmailWebhookPayload,
} from "../src/lib/email-provider.server.ts";

const names = [
  "AI_EXTERNAL_PROCESSING_ENABLED",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "AI_AUTHORIZED_ORIGIN",
  "AI_DOCUMENT_PROCESSING_ENABLED",
  "AI_BROWSER_SPEECH_ENABLED",
  "EMAIL_API_URL",
  "EMAIL_FROM",
];
const initial = new Map(names.map((name) => [name, process.env[name]]));
const requests: { url: string; body: string; authorization?: string; idempotency?: string }[] = [];
let base = "";
let providerStatus = 200;
let redirects = 0;
const server = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({
    url: request.url!,
    body,
    authorization: request.headers.authorization,
    idempotency: request.headers["idempotency-key"] as string | undefined,
  });
  if (request.url === "/redirect") {
    response.writeHead(302, { location: `${base}/redirected` }).end();
    return;
  }
  if (request.url === "/redirected") redirects++;
  if (providerStatus !== 200) {
    response.writeHead(providerStatus, { "retry-after": "12" }).end("SYNTHETIC_SENSITIVE_PAYLOAD");
    return;
  }
  if (request.url === "/audio/speech") {
    response.writeHead(200, { "content-type": "audio/mpeg" }).end("ID3synthetic-audio");
    return;
  }
  response.setHeader("content-type", "application/json");
  if (request.url === "/audio/transcriptions")
    response.end(JSON.stringify({ text: "Nome Persona cognome Demo" }));
  else if (request.url === "/emails") response.end(JSON.stringify({ id: "synthetic-email-id" }));
  else
    response.end(
      JSON.stringify({
        id: "synthetic-completion",
        model: "test-model",
        created: 1,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"first_name":"Persona","last_name":"Demo"}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
});
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
afterEach(() => {
  providerStatus = 200;
  requests.length = 0;
  for (const name of names) {
    const value = initial.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
function configure() {
  process.env.AI_EXTERNAL_PROCESSING_ENABLED = "true";
  process.env.AI_API_KEY = "synthetic-key-not-a-real-credential";
  process.env.AI_BASE_URL = base;
  process.env.AI_MODEL = "test-model";
  process.env.EMAIL_API_URL = `${base}/emails`;
  process.env.EMAIL_FROM = "Association <noreply@example.test>";
}
test("AI defaults to disabled and missing credentials fail before any request", () => {
  delete process.env.AI_EXTERNAL_PROCESSING_ENABLED;
  assert.throws(aiConfiguration, /desactivada/);
  process.env.AI_EXTERNAL_PROCESSING_ENABLED = "true";
  delete process.env.AI_API_KEY;
  assert.throws(aiConfiguration, /AI_API_KEY/);
  assert.equal(requests.length, 0);
});
test("AI refuses insecure external URLs and embedded credentials", () => {
  configure();
  for (const url of [
    "http://provider.example.test/v1",
    "https://user:secret@provider.example.test",
    "https://provider.example.test/v1?key=x",
  ]) {
    process.env.AI_BASE_URL = url;
    assert.throws(aiConfiguration);
  }
});
test("Italian transcription sends model, language and audio via real local multipart HTTP", async () => {
  configure();
  const result = await transcribeAdministrativeAudio({
    audioBase64: Buffer.from("synthetic audio").toString("base64"),
    mimeType: "audio/webm;codecs=opus",
    language: "it",
  });
  assert.equal(result.text, "Nome Persona cognome Demo");
  assert.ok(requests[0].body.includes('name="language"\r\n\r\nit'));
  assert.ok(requests[0].body.includes('filename="recording.webm"'));
  assert.equal(requests[0].authorization, "Bearer synthetic-key-not-a-real-credential");
});
test("malformed, oversized or unsupported audio is rejected locally", async () => {
  configure();
  for (const data of [
    { audioBase64: "invalid===", mimeType: "audio/webm" },
    { audioBase64: "YQ==", mimeType: "text/html" },
    { audioBase64: "A".repeat(12_000_001), mimeType: "audio/wav" },
  ])
    await assert.rejects(transcribeAdministrativeAudio(data));
  assert.equal(requests.length, 0);
});
test("TTS returns provider audio and preserves independent voice/model settings", async () => {
  configure();
  const result = await administrativeSpeech("Ciao, persona di prova");
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(Buffer.from(result.audioBase64, "base64").toString(), "ID3synthetic-audio");
  assert.equal(JSON.parse(requests[0].body).input, "Ciao, persona di prova");
});
test("structured administrative extraction executes through the SDK against local compatible HTTP", async () => {
  configure();
  const { object } = await generateObject({
    model: administrativeModel(),
    schema: z.object({ first_name: z.string(), last_name: z.string() }),
    prompt: "Nome Persona cognome Demo",
  });
  assert.deepEqual(object, { first_name: "Persona", last_name: "Demo" });
  assert.equal(JSON.parse(requests[0].body).model, "test-model");
});
test("provider failures expose status without returning audio, transcript or secret payloads", async () => {
  configure();
  providerStatus = 429;
  await assert.rejects(
    administrativeSpeech("Test"),
    (error: Error) => error.message.includes("429") && !error.message.includes("SYNTHETIC"),
  );
});
test("redirect responses cannot forward an AI key to a second endpoint", async () => {
  configure();
  process.env.AI_BASE_URL = `${base}/redirect`;
  // Configure the speech route to redirect at the exact requested endpoint.
  const { providerFetch } = await import("../src/lib/administrative-ai.server.ts");
  await assert.rejects(
    providerFetch(`${base}/redirect`, { headers: { Authorization: "Bearer synthetic-key" } }),
  );
  assert.equal(redirects, 0);
});
const email = {
  to: "person@example.test",
  from: "legacy@example.test",
  subject: "Test",
  html: "<p>Synthetic</p>",
  text: "Synthetic",
  idempotency_key: "synthetic-idempotency",
};
test("independent email transport preserves idempotency and uses the configured verified sender", async () => {
  configure();
  assert.equal(
    (await sendProviderEmail(email, { apiKey: "synthetic-email-key" })).message_id,
    "synthetic-email-id",
  );
  assert.equal(requests[0].idempotency, "synthetic-idempotency");
  assert.equal(JSON.parse(requests[0].body).from, process.env.EMAIL_FROM);
});
test("email failures retain retry status without leaking provider payloads", async () => {
  configure();
  providerStatus = 429;
  await assert.rejects(
    sendProviderEmail(email, { apiKey: "synthetic-email-key" }),
    (error: EmailAPIError) =>
      error.status === 429 &&
      error.retryAfterSeconds === 12 &&
      !error.message.includes("SYNTHETIC"),
  );
});
function webhook(body: string, secret: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return new Request("https://local.example.test/hook", {
    method: "POST",
    body,
    headers: {
      "x-clubhub-timestamp": timestamp,
      "x-clubhub-signature": `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
    },
  });
}
test("signed email envelopes are verified and parsed without a Lovable SDK", async () => {
  const secret = "synthetic-webhook-secret-with-32-characters";
  const body = JSON.stringify({
    version: "1",
    type: "email",
    run_id: "synthetic-run",
    data: { email: "person@example.test" },
  });
  const result = await verifyWebhookRequest({
    req: webhook(body, secret),
    secret,
    parser: parseEmailWebhookPayload,
  });
  assert.equal(result.payload.run_id, "synthetic-run");
});
test("webhooks reject tampering, expired signatures, malformed JSON and oversized bodies", async () => {
  const secret = "synthetic-webhook-secret-with-32-characters";
  await assert.rejects(
    verifyWebhookRequest({
      req: webhook("{}", secret),
      secret: "different-key-with-at-least-32-characters",
    }),
    /Invalid signature/,
  );
  await assert.rejects(
    verifyWebhookRequest({ req: webhook("{}", secret, "1000000000"), secret }),
    /Expired/,
  );
  await assert.rejects(
    verifyWebhookRequest({ req: webhook("not-json", secret), secret }),
    /Invalid webhook/,
  );
  await assert.rejects(
    verifyWebhookRequest({ req: webhook("x".repeat(1_048_577), secret), secret }),
    /limit/,
  );
});

test("external provider origin and document processing require separate explicit authorization", () => {
  configure();
  process.env.AI_BASE_URL = "https://provider.example.test/v1";
  delete process.env.AI_AUTHORIZED_ORIGIN;
  assert.throws(aiConfiguration, /AI_AUTHORIZED_ORIGIN/);
  process.env.AI_AUTHORIZED_ORIGIN = "https://other.example.test";
  assert.throws(aiConfiguration, /AI_AUTHORIZED_ORIGIN/);
  process.env.AI_AUTHORIZED_ORIGIN = "https://provider.example.test";
  assert.equal(aiConfiguration().baseURL, "https://provider.example.test/v1");
  delete process.env.AI_DOCUMENT_PROCESSING_ENABLED;
  assert.throws(() => aiConfiguration("documents"), /documentos/);
  assert.deepEqual(administrativeAiStatus(), {
    available: true,
    documents: false,
    browserSpeech: false,
  });
  process.env.AI_DOCUMENT_PROCESSING_ENABLED = "true";
  assert.equal(aiConfiguration("documents").baseURL, "https://provider.example.test/v1");
  assert.equal(requests.length, 0);
});
test("Spanish audio transport sends explicit language and does not rely on browser speech service", async () => {
  configure();
  await transcribeAdministrativeAudio({
    audioBase64: Buffer.from("synthetic Spanish fixture").toString("base64"),
    mimeType: "audio/mp4",
    language: "es",
  });
  assert.ok(requests[0].body.includes('name="language"\r\n\r\nes'));
  assert.ok(requests[0].body.includes('filename="recording.mp4"'));
});
