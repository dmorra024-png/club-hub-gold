import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const ACCOUNT = "0cc8106f8820d22996af3aed9e081e93";
const AUDIO = "@cf/openai/whisper-large-v3-turbo";
const GLM = "@cf/zai-org/glm-4.7-flash";
/** Fixed SNOOP account, read-only metadata and two allowed inference models. No retries. */
export function liveSnoopClient(token, transport = fetch, events = []) {
  if (!token?.trim()) throw new Error("SNOOP_LIVE_TOKEN_UNAVAILABLE");
  let count = 0;
  async function request(path, stage, body) {
    if (++count > 12) throw new Error("SNOOP_LIVE_REQUEST_BUDGET");
    const started = performance.now();
    const event = { stage, http: null, elapsedMs: 0, errorCodes: [] };
    events.push(event);
    let response;
    try {
      response = await transport(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(25000),
        },
      );
    } catch {
      event.elapsedMs = performance.now() - started;
      throw new Error("SNOOP_LIVE_NETWORK_OR_TIMEOUT");
    }
    event.http = response.status;
    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error("SNOOP_LIVE_INVALID_JSON");
    }
    event.elapsedMs = performance.now() - started;
    event.errorCodes = (Array.isArray(json.errors) ? json.errors : [])
      .map((e) => e?.code)
      .filter(Number.isFinite);
    if (!response.ok || json.success !== true) {
      const error = new Error(`SNOOP_LIVE_${stage.toUpperCase()}_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return json.result;
  }
  return {
    settings: () => request("/workers/scripts/snoop-pilot/settings", "worker_settings"),
    models: () => request("/ai/models/search?search=glm-4.7-flash", "models_catalogue"),
    run(model, input) {
      if (![AUDIO, GLM].includes(model)) throw new Error("SNOOP_LIVE_MODEL_NOT_ALLOWED");
      return request(`/ai/run/${model}`, model === AUDIO ? "whisper" : "glm", input);
    },
  };
}
function words(text) {
  return (
    text
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}
function wordErrorRate(reference, actual) {
  const a = words(reference),
    b = words(actual);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j] + 1, previous[j + 1] + 1, previous[j] + (a[i] === b[j] ? 0 : 1)));
    previous = next;
  }
  return previous.at(-1) / Math.max(a.length, 1);
}
async function main() {
  assert.equal(process.env.SNOOP_LIVE_SYNTHETIC_ONLY, "CONFIRM_FIXED_SYNTHETIC_FIXTURES");
  const report = {
    fixedSyntheticInputs: true,
    physicalMicrophone: false,
    realModelInferenceAttempted: false,
    requests: [],
    transcriptions: [],
    turns: [],
    result: "RUNNING",
  };
  await mkdir(".sandbox/live-ai", { recursive: true });
  try {
    const client = liveSnoopClient(process.env.CLOUDFLARE_API_TOKEN, fetch, report.requests);
    const settings = await client.settings();
    const bindings = settings.bindings ?? [];
    const value = (name) => bindings.find((b) => b.name === name && b.type === "plain_text")?.text;
    assert.equal(
      bindings.find((b) => b.name === "SNOOP_AI")?.type,
      "ai",
      "SNOOP_LIVE_BINDING_UNAVAILABLE",
    );
    assert.equal(value("SNOOP_RESOURCE_NAMESPACE"), "snoop-pilot", "SNOOP_LIVE_WRONG_NAMESPACE");
    assert.equal(value("SNOOP_AI_FREE_TIER_CONFIRMED"), "true", "SNOOP_LIVE_FREE_TIER_UNCONFIRMED");
    await client.models(); // Required permission: Account / Workers AI / Read (or Write).
    Object.assign(process.env, {
      AI_PROVIDER: "cloudflare",
      AI_VOICE_INTENTS_ENABLED: "true",
      AI_EXTERNAL_PROCESSING_ENABLED: "true",
      AI_VOICE_PROCESSING_ENABLED: "true",
      SNOOP_AI_FREE_TIER_CONFIRMED: "true",
      AI_PERSONAL_DATA_PROCESSING_ENABLED: "false",
      SNOOP_AI_CONVERSATION_MODE: "pilot",
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SNOOP_AI_PILOT_CLUB_ID: "10000000-0000-4000-8000-000000000001",
    });
    const { transcribeWorkersAudio, withSnoopWorkersAi } =
      await import("../src/lib/workers-ai.server.ts");
    const { interpretConversation } = await import("../src/lib/snoop-conversation.server.ts");
    const { emptyConversation, reduceConversation } =
      await import("../src/lib/snoop-conversation.ts");
    const benchmark = JSON.parse(await readFile("docs/JARVIS3_TTS_BENCHMARK.json", "utf8"));
    const owner = {
      userId: "00000000-0000-4000-8000-000000000001",
      clubId: process.env.SNOOP_AI_PILOT_CLUB_ID,
    };
    const access = {
      role: "collaborator",
      status: "active",
      clubId: owner.clubId,
      clubName: null,
      clubLogo: null,
      permissions: ["manage_members", "manage_products"],
    };
    for (const language of ["it", "es"]) {
      const reference = benchmark.results.find((r) => r.language === language);
      const audio = await readFile(`docs/audio/jarvis3-piper-${language}.wav`);
      assert.equal(
        createHash("sha256").update(audio).digest("hex"),
        reference.wav_sha256,
        "SNOOP_LIVE_FIXTURE_HASH",
      );
      const transcript = await transcribeWorkersAudio(client, audio.toString("base64"), language);
      const wer = wordErrorRate(reference.synthetic_text, transcript.text);
      report.transcriptions.push({
        language,
        reference: reference.synthetic_text,
        actual: transcript.text,
        wordErrorRate: wer,
      });
      let context = emptyConversation();
      const name = language === "it" ? "Luca" : "Carlos",
        surname = language === "it" ? "Prova" : "Prueba";
      const inputs =
        language === "it"
          ? [
              "Snoop, crea un socio. Nome Luca, cognome Prova, data di nascita 12 marzo 1995, città Palma.",
              "Non voglio aggiungere il telefono.",
              "Cambia soltanto la città in Inca.",
            ]
          : [
              "Snoop, crea un socio. Nombre Carlos, apellidos Prueba, fecha de nacimiento 12 de marzo de 1995, ciudad Palma.",
              "No quiero añadir un teléfono.",
              "Cambia solo la ciudad a Inca.",
            ];
      for (const [index, text] of inputs.entries()) {
        const started = performance.now();
        const proposal = await withSnoopWorkersAi(
          { SNOOP_RESOURCE_NAMESPACE: "snoop-pilot", SNOOP_AI: client },
          () =>
            interpretConversation(
              {
                mode: "pilot",
                owner,
                consent: true,
                synthetic: true,
                text,
                screen: index === 0 ? "home" : "member_create",
                context,
              },
              { userId: owner.userId, access },
            ),
        );
        report.turns.push({
          language,
          index,
          syntheticInput: text,
          proposal,
          elapsedMs: performance.now() - started,
        });
        if (index === 0) {
          assert.equal(proposal.member.first_name?.toLowerCase(), name.toLowerCase());
          assert.equal(proposal.member.last_name?.toLowerCase(), surname.toLowerCase());
          assert.equal(proposal.member.birth_date, "1995-03-12");
          assert.equal(proposal.member.city?.toLowerCase(), "palma");
        } else if (index === 1) assert.ok(proposal.declined.includes("phone"));
        else {
          assert.deepEqual(Object.keys(proposal.member), ["city"]);
          assert.equal(proposal.member.city?.toLowerCase(), "inca");
          assert.notEqual(proposal.asking, "phone");
        }
        context = reduceConversation(context, proposal);
      }
    }
    assert.ok(
      report.transcriptions.every((r) => r.wordErrorRate <= 0.1),
      "SNOOP_LIVE_REFERENCE_TRANSCRIPTION_MISMATCH",
    );
    report.result = "PASS_FIXED_SYNTHETIC_CASES_ONLY";
  } catch (error) {
    report.result = "BLOCKED_OR_FAILED";
    const lastRequest = report.requests.at(-1);
    report.failure = {
      code:
        lastRequest?.http >= 400
          ? `SNOOP_LIVE_${lastRequest.stage.toUpperCase()}_HTTP_${lastRequest.http}`
          : typeof error?.message === "string" && /^SNOOP_/.test(error.message)
            ? (error.message.match(/^SNOOP_[A-Z0-9_]+/)?.[0] ?? "SNOOP_LIVE_EXPECTATION_NOT_MET")
            : "SNOOP_LIVE_EXPECTATION_NOT_MET",
    };
    process.exitCode = 1;
  } finally {
    report.realModelInferenceAttempted = report.requests.some(
      (r) => r.stage === "whisper" || r.stage === "glm",
    );
    await writeFile(".sandbox/live-ai/result.json", JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        result: report.result,
        failure: report.failure,
        requests: report.requests,
        transcriptionWER: report.transcriptions.map((r) => ({
          language: r.language,
          value: r.wordErrorRate,
        })),
        validatedTurns: report.turns.length,
      }),
    );
  }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
