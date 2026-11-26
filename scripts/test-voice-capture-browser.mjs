/** Real capture graph, synthetic MediaStream. No microphone, provider, recordings or production. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import ts from "typescript";
import { chromium, webkit } from "playwright-core";
const source = await readFile("src/components/DeepgramPilotVoice.tsx", "utf8");
const file = ts.createSourceFile(
  "voice.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const codes = [];
function visit(n) {
  if (
    ts.isVariableDeclaration(n) &&
    n.name.getText(file) === "worklet" &&
    n.initializer &&
    ts.isStringLiteral(n.initializer)
  )
    codes.push(n.initializer.text);
  ts.forEachChild(n, visit);
}
visit(file);
assert.equal(codes.length, 1, "Test must execute the actual application capture processor");
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  res.end('<!doctype html><button id="start">Start synthetic capture</button>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const results = [];
try {
  for (const [name, engine, executablePath] of [
    ["chromium", chromium, existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined],
    ["webkit", webkit, process.env.TEST_WEBKIT_EXECUTABLE_PATH],
  ]) {
    const browser = await engine.launch({ headless: true, executablePath });
    try {
      const context = await browser.newContext();
      await context.route("**/*", (r) =>
        new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
      );
      const page = await context.newPage();
      await page.goto(origin);
      await page.evaluate((code) => {
        document.getElementById("start").onclick = () => {
          window.captureResult = (async () => {
            const audio = new AudioContext({ sampleRate: 48000 });
            await audio.resume();
            const oscillator = audio.createOscillator(),
              gain = audio.createGain(),
              media = audio.createMediaStreamDestination();
            oscillator.frequency.value = 440;
            gain.gain.value = 0.25;
            oscillator.connect(gain);
            gain.connect(media);
            const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
            try {
              await audio.audioWorklet.addModule(url);
            } finally {
              URL.revokeObjectURL(url);
            }
            const input = audio.createMediaStreamSource(media.stream),
              node = new AudioWorkletNode(audio, "snoop-app-capture"),
              sink = audio.createGain();
            sink.gain.value = 0;
            const stats = {
              sampleRate: audio.sampleRate,
              frames: 0,
              bytes: 0,
              nonzero: 0,
              energy: 0,
              samples: 0,
              crossings: 0,
              processorErrors: 0,
              state: audio.state,
            };
            let previous = 0;
            const spectrum = Array(61).fill(0);
            node.onprocessorerror = () => stats.processorErrors++;
            node.port.onmessage = (e) => {
              stats.frames++;
              stats.bytes += e.data.byteLength;
              const data = new DataView(e.data);
              // Estimate dominant frequency inside each contiguous frame. Global
              // zero-crossing counts misread MediaStream block discontinuities as pitch.
              for (let bin = 0; bin < spectrum.length; bin++) {
                const frequency = 300 + bin * 5;
                let real = 0,
                  imaginary = 0;
                const count = data.byteLength / 2;
                for (let n = 0; n < count; n += 4) {
                  const sample =
                    (data.getInt16(n * 2, true) / 32768) *
                    (0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (count - 1)));
                  const angle = (2 * Math.PI * frequency * n) / audio.sampleRate;
                  real += sample * Math.cos(angle);
                  imaginary += sample * Math.sin(angle);
                }
                spectrum[bin] += real * real + imaginary * imaginary;
              }
              for (let i = 0; i < data.byteLength; i += 2) {
                const value = data.getInt16(i, true) / 32768;
                stats.energy += value * value;
                stats.samples++;
                if (value) stats.nonzero++;
                if (previous < 0 && value >= 0) stats.crossings++;
                previous = value;
              }
            };
            input.connect(node);
            node.connect(sink);
            sink.connect(audio.destination);
            oscillator.start();
            await new Promise((resolve) => setTimeout(resolve, 1400));
            stats.state = audio.state;
            oscillator.stop();
            input.disconnect();
            node.disconnect();
            sink.disconnect();
            media.stream.getTracks().forEach((t) => t.stop());
            await audio.close();
            return {
              ...stats,
              rms: Math.sqrt(stats.energy / Math.max(1, stats.samples)),
              crossingHz: (stats.crossings * stats.sampleRate) / Math.max(1, stats.samples),
              hz: 300 + 5 * spectrum.indexOf(Math.max(...spectrum)),
            };
          })();
        };
      }, codes[0]);
      await page.click("#start");
      const data = await page.evaluate(() => window.captureResult);
      assert.equal(data.processorErrors, 0, JSON.stringify(data));
      assert.equal(data.state, "running", JSON.stringify(data));
      assert(
        data.frames >= 8,
        "Capture processor must produce actual PCM: " + JSON.stringify(data),
      );
      assert(data.nonzero > 1000 && data.rms > 0.12 && data.rms < 0.2, JSON.stringify(data));
      assert(data.hz > 420 && data.hz < 460, JSON.stringify(data));
      assert.equal(data.bytes, data.samples * 2);
      results.push({
        engine: name,
        syntheticMediaStream: true,
        physicalMicrophone: false,
        liveDeepgram: false,
        ...data,
      });
      console.log(
        "PASS " +
          name +
          ": actual AudioWorklet capture, signed mono PCM, nonzero signal and verified frequency",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise((r) => server.close(r));
}
await mkdir(".sandbox/voice-capture", { recursive: true });
await writeFile(".sandbox/voice-capture/results.json", JSON.stringify(results, null, 2));
