/** Real Chromium/WebKit Web Audio rendering. Synthetic tone, no microphone/provider/hardware proof. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import ts from "typescript";
import { chromium, webkit } from "playwright-core";
const code = ts.transpileModule(await readFile("src/lib/voice/pcm-playback.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const results = [];
for (const [name, engine, executablePath] of [
  ["android-chromium", chromium, existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined],
  ["iphone-webkit", webkit, process.env.TEST_WEBKIT_EXECUTABLE_PATH],
]) {
  const browser = await engine.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const cases = await page.evaluate(async (code) => {
      const { PcmPlayback } = await import("data:text/javascript;base64," + btoa(code));
      const results = [];
      for (const kind of ["fragmented", "interrupted", "blocked"]) {
        const offline = new OfflineAudioContext(1, 48000, 48000);
        let state = kind === "blocked" ? "interrupted" : "running";
        const adapter = {
          get state() {
            return state;
          },
          get currentTime() {
            return offline.currentTime;
          },
          destination: offline.destination,
          createBuffer: offline.createBuffer.bind(offline),
          createBufferSource: offline.createBufferSource.bind(offline),
        };
        const notices = [];
        const player = new PcmPlayback(adapter, (n) => notices.push(n));
        const pcm = (hz) => {
          const b = new ArrayBuffer(12000),
            v = new DataView(b);
          for (let i = 0; i < 6000; i++)
            v.setInt16(i * 2, Math.round(Math.sin((2 * Math.PI * hz * i) / 24000) * 8192), true);
          return b;
        };
        const data = pcm(440);
        for (const piece of [data.slice(0, 13), data.slice(13, 20), data.slice(20)])
          player.push(piece);
        const blocked = player.snapshot();
        if (kind === "interrupted") {
          player.interrupt();
          player.beginResponse();
          player.push(pcm(220));
        }
        if (kind === "blocked") {
          state = "running";
          player.contextChanged();
        }
        const output = await offline.startRendering();
        const samples = output.getChannelData(0);
        let energy = 0,
          crossings = 0;
        for (let i = 0; i < samples.length; i++) {
          energy += samples[i] * samples[i];
          if (i && samples[i - 1] < 0 && samples[i] >= 0) crossings++;
        }
        results.push({
          kind,
          sampleRate: output.sampleRate,
          rms: Math.sqrt(energy / samples.length),
          crossings,
          blocked,
          final: player.snapshot(),
          notices,
        });
      }
      return results;
    }, code);
    for (const row of cases) {
      assert(row.rms > 0.07 && row.rms < 0.11, JSON.stringify(row));
      assert.equal(row.sampleRate, 48000);
      assert(
        row.crossings > (row.kind === "interrupted" ? 45 : 100) &&
          row.crossings < (row.kind === "interrupted" ? 65 : 120),
        JSON.stringify(row),
      );
      if (row.kind === "blocked") {
        assert.equal(row.blocked.scheduledSamples, 0);
        assert.equal(row.blocked.bufferedSamples, 6000);
        assert.equal(row.final.bufferedSamples, 0);
      }
    }
    results.push({
      browser: name,
      engineAudioRendered: true,
      physicalSpeaker: false,
      liveDeepgram: false,
      results: cases,
    });
    console.log(
      "PASS " +
        name +
        ": real Web Audio DSP, nonzero rendered PCM, correct resampling/frequency, queued suspension recovery and canceled old response",
    );
  } finally {
    await browser.close();
  }
}
await mkdir(".sandbox/voice-pcm", { recursive: true });
await writeFile(".sandbox/voice-pcm/results.json", JSON.stringify(results, null, 2));
