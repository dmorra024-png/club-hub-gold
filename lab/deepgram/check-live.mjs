import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import WebSocket from "ws";
const ORIGIN = "https://snoop-voice-lab.dmorra024.workers.dev";
const key = process.env.LAB_PROBE_TOKEN;
assert(key, "LAB_PROBE_CAPABILITY_MISSING");
const result = {
  syntheticOnly: true,
  physicalMicrophone: false,
  provider: "Deepgram Voice Agent",
  productionTouched: false,
  sessions: [],
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const credit = async () => {
  try {
    const r = await fetch(ORIGIN + "/deepgram/credit", {
      method: "POST",
      headers: { "X-Preview-Key": key },
      signal: AbortSignal.timeout(25000),
    });
    return { http: r.status, ...(await r.json()) };
  } catch {
    return { available: false, code: "BALANCE_READ_TIMEOUT" };
  }
};
function wav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  let sampleRate, pcm;
  for (let off = 12; off + 8 <= bytes.length; ) {
    const size = v.getUint32(off + 4, true),
      id = bytes.toString("ascii", off, off + 4);
    if (id === "fmt ") {
      assert.equal(v.getUint16(off + 8, true), 1);
      assert.equal(v.getUint16(off + 10, true), 1);
      sampleRate = v.getUint32(off + 12, true);
      assert.equal(v.getUint16(off + 22, true), 16);
    }
    if (id === "data") pcm = bytes.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  assert(pcm && sampleRate);
  return { sampleRate, pcm };
}
function wave(pcm) {
  const h = Buffer.alloc(44);
  h.write("RIFF");
  h.writeUInt32LE(pcm.length + 36, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function wer(a, b) {
  const words = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^\p{L}\p{N}\s]/gu, "")
      .trim()
      .split(/\s+/);
  const x = words(a),
    y = words(b);
  let row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const next = [i];
    for (let j = 1; j <= y.length; j++)
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    row = next;
  }
  return row[y.length] / x.length;
}
async function run(ref) {
  const { sampleRate, pcm } = wav(await readFile(ref.path));
  // Deepgram accepts 16/24/44.1/48 kHz. Piper 22.05 kHz is resampled locally to 24 kHz.
  const inputRate = 24000,
    samples = pcm.length / 2,
    out = Buffer.alloc(Math.floor((samples * inputRate) / sampleRate) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const at = (i * sampleRate) / inputRate,
      left = Math.floor(at),
      f = at - left;
    out.writeInt16LE(
      Math.round(
        pcm.readInt16LE(Math.min(left, samples - 1) * 2) * (1 - f) +
          pcm.readInt16LE(Math.min(left + 1, samples - 1) * 2) * f,
      ),
      i * 2,
    );
  }
  const s = {
    language: ref.language,
    reference: ref.reference,
    transcript: "",
    settingsApplied: false,
    audioBytes: 0,
    proposal: null,
  };
  result.sessions.push(s);
  const ws = new WebSocket(ORIGIN.replace("https", "wss") + "/deepgram/socket", {
    headers: { Origin: ORIGIN },
  });
  const start = performance.now();
  let ready = false,
    failure,
    finished = false,
    firstAudio = 0,
    lastInput = 0;
  const audio = [];
  ws.on("open", () =>
    ws.send(
      JSON.stringify({
        type: "LabStart",
        key,
        language: ref.language,
        sampleRate: inputRate,
        synthetic: true,
      }),
    ),
  );
  ws.on("message", (data, binary) => {
    if (binary) {
      s.audioBytes += data.length;
      audio.push(data);
      firstAudio ||= performance.now();
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === "LabReady") {
        ready = true;
        s.settingsApplied = true;
        s.connectMs = performance.now() - start;
      }
      if (m.type === "ConversationText") {
        if (m.role === "user") s.transcript += " " + m.content;
        else s.reply = m.content;
      }
      if (m.type === "LabProposal") s.proposal = m;
      if (m.type === "AgentAudioDone") finished = true;
      if (m.type === "LabError" || m.type === "LabClosed") failure ||= m.code;
      if (m.detail) s.providerDiagnostic = m.detail;
    } catch {
      failure = "LAB_INVALID_EVENT";
    }
  });
  ws.on("error", () => {
    failure ||= "LAB_SOCKET_ERROR";
  });
  const until = async (test, limit) => {
    const deadline = performance.now() + limit;
    while (!test() && !failure && performance.now() < deadline) await wait(100);
    if (failure) throw Error(failure);
    assert(test(), "LAB_RESPONSE_TIMEOUT");
  };
  try {
    await until(() => ready, 20000);
    const chunk = 4800;
    for (let i = 0; i < out.length; i += chunk) {
      if (failure) throw Error(failure);
      ws.send(out.subarray(i, i + chunk));
      await wait(100);
    }
    lastInput = performance.now();
    for (let i = 0; i < 20; i++) {
      if (failure) break;
      ws.send(Buffer.alloc(4800));
      await wait(100);
    }
    await until(() => s.transcript.trim() && s.proposal?.ok && s.audioBytes > 0 && finished, 35000);
    s.wordErrorRate = wer(ref.reference, s.transcript);
    assert(s.wordErrorRate <= 0.25, "LAB_REFERENCE_TRANSCRIPTION_MISMATCH");
    const p = s.proposal.proposal;
    assert.equal(p.intent, "member");
    assert.equal(p.target, "member_create");
    assert.equal(p.member.first_name, ref.language === "it" ? "Luca" : "Carlos");
    assert.equal(p.member.last_name, ref.language === "it" ? "Prova" : "Prueba");
    assert.equal(s.proposal.persisted, false);
    assert.equal(s.proposal.requiresConfirmation, true);
    s.firstAudioAfterInputMs = firstAudio - lastInput;
    s.passed = true;
  } catch (e) {
    s.passed = false;
    if (e instanceof assert.AssertionError) s.assertion = e.message.slice(0, 400);
    s.error = /^[A-Z0-9_]+$/.test(e.message) ? e.message : "LAB_ASSERTION_FAILED";
  } finally {
    s.connectedMs = performance.now() - start;
    if (ws.readyState === 1) ws.send("STOP");
    ws.close();
    await writeFile(
      `.sandbox/deepgram-lab/deepgram-${ref.language}-reply.wav`,
      wave(Buffer.concat(audio)),
    );
  }
}
await mkdir(".sandbox/deepgram-lab", { recursive: true });
result.creditBefore = await credit();
for (const ref of JSON.parse(await readFile("lab/deepgram/audio/references.json", "utf8")))
  await run(ref);
result.creditAfter = await credit();
result.creditConsumptionNote =
  "Observed before/after balances may lag settlement. Standard published rate $0.075/min is an estimate, not an invoice. No billing/auto-top-up settings changed.";
result.estimatedStandardUsd = result.sessions.reduce(
  (sum, s) => sum + (s.connectedMs / 60000) * 0.075,
  0,
);
result.result = result.sessions.every((s) => s.passed)
  ? "PASS_FIXED_SYNTHETIC_VOICE_AGENT"
  : "FAILED";
await writeFile(".sandbox/deepgram-lab/live-results.json", JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    result: result.result,
    sessions: result.sessions.map(
      ({
        language,
        passed,
        error,
        settingsApplied,
        audioBytes,
        wordErrorRate,
        connectedMs,
        firstAudioAfterInputMs,
      }) => ({
        language,
        passed,
        error,
        settingsApplied,
        audioBytes,
        wordErrorRate,
        connectedMs,
        firstAudioAfterInputMs,
      }),
    ),
    creditBefore: result.creditBefore,
    creditAfter: result.creditAfter,
    estimatedStandardUsd: result.estimatedStandardUsd,
  }),
);
if (result.result === "FAILED") process.exitCode = 1;
