import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import process from "node:process";
const root = resolve(new URL("../", import.meta.url).pathname);
const work = resolve(process.env.SANDBOX_WORKDIR || join(root, ".sandbox"));
const env = Object.fromEntries(
  (await readFile(join(root, ".env.sandbox.local"), "utf8"))
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
assert.equal(env.SUPABASE_URL, "http://127.0.0.1:54321");
assert.equal(env.VITE_SUPABASE_URL, "/sandbox-api");
const credentials = JSON.parse(await readFile(join(work, "test-credentials.json"), "utf8"));
assert.equal(credentials.email, "admin.demo@example.test");
const api = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const counts = async () => {
  const r = await api.from("members").select("id", { count: "exact", head: true });
  if (r.error) throw r.error;
  return r.count;
};
const calls = [];
let unavailable = false;
let transcriptOverride = "";
const fields = {
  first_name: "Persona AI",
  last_name: "Demo Sintetico",
  birth_date: "2000-02-29",
  city: "Località Fittizia",
  phone: "000000000",
  email: "",
  dni_number: "AIFIXTURE",
  plan_name: "",
};
const provider = createServer(async (req, res) => {
  let body = "";
  for await (const part of req) body += part;
  calls.push({ url: req.url, body });
  assert.equal(req.headers.authorization, "Bearer synthetic-local-ai-key");
  if (unavailable) {
    res.writeHead(503).end("Synthetic outage");
    return;
  }
  res.setHeader("content-type", "application/json");
  if (req.url === "/v1/audio/transcriptions") {
    const it = body.includes('name="language"\r\n\r\nit');
    res.end(
      JSON.stringify({ text: transcriptOverride || (it ? "CASO_ITALIANO" : "CASO_ESPANOL") }),
    );
  } else {
    res.end(
      JSON.stringify({
        id: "synthetic-ai",
        model: "synthetic-model",
        created: 1,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(fields) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );
  }
});
await new Promise((r) => provider.listen(0, "127.0.0.1", r));
const providerPort = provider.address().port;
const origin = "http://127.0.0.1:3005";
const app = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "dev",
    "--mode",
    "sandbox",
    "--host",
    "127.0.0.1",
    "--port",
    "3005",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      ...env,
      AI_EXTERNAL_PROCESSING_ENABLED: "true",
      AI_API_KEY: "synthetic-local-ai-key",
      AI_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
      AI_MODEL: "synthetic-model",
      AI_DOCUMENT_PROCESSING_ENABLED: "false",
      AI_BROWSER_SPEECH_ENABLED: "false",
    },
    stdio: ["ignore", "ignore", "ignore"],
  },
);
let browser;
const results = [];
async function record(name, fn) {
  try {
    await fn();
    results.push({ name, status: "PASS", level: "Native local Auth + test double AI provider" });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "FAIL", detail: String(e.message).slice(0, 700) });
    console.log("FAIL " + name + ": " + String(e.message).slice(0, 250));
  }
}
try {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(origin + "/auth")).ok) break;
    } catch {}
    if (i === 89) throw new Error("Local AI application failed to start");
    await new Promise((r) => setTimeout(r, 500));
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    headless: true,
  });
  const context = await browser.newContext({
    serviceWorkers: "block",
    permissions: ["microphone"],
  });
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  const page = await context.newPage();
  await page.goto(origin + "/auth", { waitUntil: "networkidle" });
  await page.locator("input[type=email]").fill(credentials.email);
  await page.locator("input[type=password]").fill(credentials.password);
  await page.locator("form").getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(origin + "/");
  await record(
    "AI authenticated status hides credentials and disables documents/browser vendors",
    async () => {
      const result = await page.evaluate(async () => {
        const m = await import("/src/lib/voice-agent.functions.ts");
        return m.getAdministrativeAiStatus();
      });
      assert.deepEqual(result, { available: true, documents: false, browserSpeech: false });
      assert.ok(!JSON.stringify(result).includes("synthetic-local-ai-key"));
    },
  );
  for (const language of ["it", "es"]) {
    await record(
      `AI ${language}: authenticated audio transport and validated field extraction`,
      async () => {
        const result = await page.evaluate(async (language) => {
          const m = await import("/src/lib/voice-agent.functions.ts");
          const audio = await m.transcribeAudio({
            data: {
              audioBase64: btoa("SYNTHETIC AUDIO FIXTURE"),
              mimeType: language === "it" ? "audio/webm" : "audio/mp4",
              language,
            },
          });
          const extracted = await m.extractMemberFields({
            data: {
              transcript: audio.text,
              current: {
                first_name: "",
                last_name: "",
                birth_date: "",
                city: "",
                phone: "",
                email: "",
                dni_number: "",
                plan_name: "",
              },
              available_plans: [],
            },
          });
          return { audio, extracted };
        }, language);
        assert.equal(result.audio.text, language === "it" ? "CASO_ITALIANO" : "CASO_ESPANOL");
        assert.equal(result.extracted.source, "ai");
        assert.equal(result.extracted.fields.birth_date, "2000-02-29");
        assert.equal(result.extracted.fields.first_name, "Persona AI");
      },
    );
    await record(
      `AI ${language}: form compilation requires manual save and accepts manual corrections`,
      async () => {
        const before = await counts();
        await page.goto(origin + "/soci/nuovo", { waitUntil: "networkidle" });
        await page.getByLabel("Nombre *", { exact: true }).waitFor();
        await page.evaluate(
          (text) =>
            window.dispatchEvent(
              new StorageEvent("storage", {
                key: "snoop:new-member-transcript",
                newValue: JSON.stringify({ text, at: Date.now() }),
              }),
            ),
          language === "it" ? "CASO_ITALIANO" : "CASO_ESPANOL",
        );
        await page.waitForFunction(() => document.querySelector("input")?.value !== undefined);
        await page.getByLabel("Nombre *", { exact: true }).filter({ visible: true }).waitFor();
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll("input")).some((i) => i.value === "Persona AI"),
        );
        assert.equal(
          await page.getByLabel("Fecha de nacimiento *", { exact: true }).inputValue(),
          "2000-02-29",
        );
        await page.getByLabel("Nombre *", { exact: true }).fill("Correzione manuale");
        assert.equal(
          await page.getByLabel("Nombre *", { exact: true }).inputValue(),
          "Correzione manuale",
        );
        assert.equal(await counts(), before);
      },
    );
  }
  for (const [language, command] of [
    ["it-IT", "Apri registro quote"],
    ["es-ES", "Abre ingresos"],
  ]) {
    await record(
      `Voice administrative command ${language}: actual MediaRecorder with synthetic microphone`,
      async () => {
        const before = await counts();
        transcriptOverride = command;
        await page.goto(origin + "/", { waitUntil: "networkidle" });
        await page
          .getByLabel("Idioma de voz / Lingua voce", { exact: true })
          .selectOption(language);
        page.once("dialog", (d) => d.accept());
        await page.getByRole("button", { name: "Encender Snoop", exact: true }).click();
        await page.getByRole("button", { name: "Apagar Snoop", exact: true }).waitFor();
        await page.waitForTimeout(700);
        await page.getByRole("button", { name: "Apagar Snoop", exact: true }).click();
        await page.waitForURL(origin + "/cuotas");
        await page.getByRole("heading", { name: "Cuotas e ingresos", exact: true }).waitFor();
        assert.equal(await counts(), before);
        transcriptOverride = "";
      },
    );
  }
  await record("Document processing blocked server-side before contacting provider", async () => {
    const before = calls.length;
    const out = await page.evaluate(async () => {
      const m = await import("/src/lib/voice-agent.functions.ts");
      try {
        await m.extractMemberFieldsFromImages({
          data: { images: [{ base64: "YQ==", mimeType: "image/png" }] },
        });
        return "unexpected success";
      } catch {
        return "blocked";
      }
    });
    assert.equal(out, "blocked");
    assert.equal(calls.length, before);
  });
  await record(
    "Unavailable AI falls back to Italian/Spanish local parser without writes",
    async () => {
      unavailable = true;
      const before = await counts();
      for (const transcript of [
        "Nome Persona cognome Demo nascita 29/02/2000 città Luogo Demo",
        "Nombre Persona apellido Demo nacimiento 29/02/2000 ciudad Lugar Demo",
      ]) {
        const out = await page.evaluate(async (transcript) => {
          const m = await import("/src/lib/voice-agent.functions.ts");
          return m.extractMemberFields({
            data: {
              transcript,
              current: {
                first_name: "",
                last_name: "",
                birth_date: "",
                city: "",
                phone: "",
                email: "",
                dni_number: "",
                plan_name: "",
              },
              available_plans: [],
            },
          });
        }, transcript);
        assert.equal(out.source, "local");
        assert.equal(out.fields.first_name, "Persona");
        assert.equal(out.fields.birth_date, "2000-02-29");
        assert.ok(out.warning);
      }
      assert.equal(await counts(), before);
      unavailable = false;
    },
  );
  await record("Microphone denial keeps manual form usable", async () => {
    await page.goto(origin + "/soci/nuovo", { waitUntil: "networkidle" });
    await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException("Synthetic denied", "NotAllowedError");
      };
    });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Dictar datos", exact: true }).click();
    await page.getByLabel("Nombre *", { exact: true }).fill("Manual tras denegación");
    assert.equal(
      await page.getByLabel("Nombre *", { exact: true }).inputValue(),
      "Manual tras denegación",
    );
  });
  results.push({
    name: "Real spoken Italian/Spanish accuracy and actual microphone",
    status: "BLOCKED",
    detail:
      "Local provider returns synthetic fixtures; real credentials and physical devices unavailable.",
  });
} finally {
  if (browser) await browser.close();
  app.kill("SIGTERM");
  await new Promise((r) => provider.close(r));
  await mkdir(join(work, "acceptance"), { recursive: true });
  await writeFile(join(work, "acceptance/ai-results.json"), JSON.stringify(results, null, 2), {
    mode: 0o600,
  });
}
if (results.some((r) => r.status === "FAIL")) process.exitCode = 1;
