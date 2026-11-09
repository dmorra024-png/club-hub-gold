import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium, webkit, devices } from "playwright-core";
const baseline = process.argv.includes("--baseline");
if (baseline) {
  await mkdir(".sandbox", { recursive: true });
  await writeFile(
    ".sandbox/voice-baseline-hook.ts",
    execFileSync("git", ["show", "4564192:src/hooks/useWhisperDictation.ts"]),
  );
}
const server = await createServer({
  configFile: false,
  resolve: {
    alias: baseline
      ? { "../../src/hooks/useWhisperDictation": resolve(".sandbox/voice-baseline-hook.ts") }
      : {},
  },
  root: process.cwd(),
  envDir: "tests/browser",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const results = [];
try {
  for (const [name, engine, device] of [
    ["samsung", chromium, devices["Galaxy S9+"]],
    ["iphone-webkit", webkit, devices["iPhone 13"]],
  ]) {
    const browser = await engine.launch({
      headless: true,
      ...(engine === chromium
        ? {
            executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
            args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
          }
        : {}),
    });
    try {
      const context = await browser.newContext({ ...device, serviceWorkers: "block" });
      await context.addInitScript(() => {
        window.events = { created: 0, stopped: 0, contexts: 0, closed: 0, recorders: [], rms: 0.1 };
        class Audio {
          state = "running";
          constructor() {
            window.events.contexts++;
          }
          resume() {
            return Promise.resolve();
          }
          close() {
            this.state = "closed";
            window.events.closed++;
            return Promise.resolve();
          }
          createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
          }
          createAnalyser() {
            return {
              fftSize: 1024,
              getByteTimeDomainData(a) {
                a.fill(window.events.rms > 0 ? 144 : 128);
              },
            };
          }
        }
        Object.defineProperty(window, "AudioContext", { configurable: true, value: Audio });
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {
            getUserMedia: async () => {
              if (window.fixture.denied) throw new DOMException("Denied", "NotAllowedError");
              window.events.created++;
              const t = {
                onended: null,
                readyState: "live",
                stop() {
                  if (this.readyState === "ended") return;
                  this.readyState = "ended";
                  window.events.stopped++;
                  if (window.fixture.endedMode) this.onended?.();
                },
              };
              return { getTracks: () => [t] };
            },
          },
        });
        class Recorder {
          static isTypeSupported() {
            return true;
          }
          state = "inactive";
          mimeType;
          constructor(stream, options) {
            this.mimeType = options.mimeType;
            window.events.recorders.push(this);
          }
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            const data = this.ondataavailable,
              stop = this.onstop;
            this.savedStop = stop;
            queueMicrotask(() => {
              data?.({ data: new Blob([new Uint8Array(4096)], { type: this.mimeType }) });
              stop?.();
            });
          }
        }
        Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
      );
      await page.goto(base + "/tests/browser/voice-lifecycle.html");
      const phase = async (v) => page.locator(`output[data-phase="${v}"]`).waitFor();
      await phase("idle");
      // Genuine consecutive start requests, not a state-dependent toggle in a test helper.
      for (let i = 0; i < 6; i++) {
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await phase("recording");
        const before = await page.evaluate(() => window.events.created);
        await page.evaluate(() => {
          void window.hook.start();
          void window.hook.start();
        });
        assert.equal(await page.evaluate(() => window.events.created), before);
        await page.getByRole("button", { name: "Finish", exact: true }).click();
        await phase("idle");
      }
      assert.equal(await page.evaluate(() => window.fixture.uploads), 6);
      assert.equal(await page.evaluate(() => window.fixture.applied), 6);
      // The hook must stay busy until interpretation/form handoff is complete.
      await page.evaluate(() => (window.fixture.holdInterpretation = true));
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.getByRole("button", { name: "Finish", exact: true }).click();
      await phase("processing");
      await page.waitForFunction(() => !!window.fixture.interpret);
      const beforeBusy = await page.evaluate(() => window.events.created);
      await page.evaluate(() => window.hook.start());
      assert.equal(await page.evaluate(() => window.events.created), beforeBusy);
      await page.evaluate(() => {
        window.fixture.holdInterpretation = false;
        window.fixture.interpret();
      });
      await phase("idle");
      // A delayed old onstop must not release or transcribe a newer recording.
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.evaluate(() => {
        const old = window.events.recorders.at(-1);
        window.oldStop = old.onstop;
        window.hook.cancel();
      });
      await phase("idle");
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      const beforeStale = await page.evaluate(() => ({
        stopped: window.events.stopped,
        uploads: window.fixture.uploads,
      }));
      await page.evaluate(() => window.oldStop());
      assert.deepEqual(
        await page.evaluate(() => ({
          stopped: window.events.stopped,
          uploads: window.fixture.uploads,
        })),
        beforeStale,
      );
      await phase("recording");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await phase("idle");
      // Ending tracks during normal cleanup must not cancel a valid transcript.
      await page.evaluate(() => (window.fixture.endedMode = true));
      const beforeEnded = await page.evaluate(() => window.fixture.applied);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.getByRole("button", { name: "Finish", exact: true }).click();
      await phase("idle");
      assert.equal(await page.evaluate(() => window.fixture.applied), beforeEnded + 1);
      // Local VAD, sustained speech followed by silence: no second click to finish.
      await page.evaluate(() => (window.events.rms = 0.1));
      const beforeAuto = await page.evaluate(() => window.fixture.uploads);
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.waitForTimeout(400);
      await page.evaluate(() => (window.events.rms = 0));
      await phase("idle");
      assert.equal(await page.evaluate(() => window.fixture.uploads), beforeAuto + 1);
      // Scope/language changes discard an in-flight result and keep the next recorder safe.
      await page.evaluate(() => {
        window.fixture.hold = true;
        window.events.rms = 0.1;
      });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.getByRole("button", { name: "Finish", exact: true }).click();
      await page.waitForFunction(() => !!window.fixture.resolve);
      const applied = await page.evaluate(() => window.fixture.applied);
      await page.evaluate(() => window.setScope("synthetic-user:club-b:/form"));
      await phase("idle");
      await page.evaluate(() => {
        window.fixture.hold = false;
        window.fixture.resolve();
      });
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      assert.equal(await page.evaluate(() => window.fixture.applied), applied);
      await page.evaluate(() => window.setLanguage("it"));
      await phase("idle");
      // A newer contextual microphone claims ownership before a slow status request.
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.evaluate(() => {
        window.fixture.holdOtherStatus = true;
        void window.otherHook.start();
      });
      await page.locator('output[data-other-phase="starting"]').waitFor();
      await phase("idle");
      // Starting the global microphone again cancels that pending contextual start.
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.evaluate(() => {
        window.fixture.holdOtherStatus = false;
        window.fixture.resumeOtherStatus();
      });
      await page.locator('output[data-other-phase="idle"]').waitFor();
      await phase("recording");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await phase("idle");
      // Permission failure is an error, never a pretend recording. Recovery starts normally.
      await page.evaluate(() => (window.fixture.denied = true));
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Permiso de micrófono denegado" }).waitFor();
      await phase("idle");
      await page.evaluate(() => (window.fixture.denied = false));
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await phase("recording");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await phase("idle");
      assert.equal(
        await page.evaluate(() => window.events.created),
        await page.evaluate(() => window.events.stopped),
      );
      assert.equal(
        await page.evaluate(() => window.events.contexts),
        await page.evaluate(() => window.events.closed),
      );
      assert.deepEqual(errors, []);
      results.push({
        browser: name,
        result: "PASS",
        physical: false,
        audio: "simulated speech envelope / recorder",
        consecutiveCommands: 6,
        checks: [
          "idempotent start",
          "interpretation busy lock",
          "stale onstop ownership",
          "normal track cleanup",
          "latest user gesture owns microphone before asynchronous status checks",
          "automatic speech endpoint",
          "scope/language cancellation",
          "permission recovery",
          "all tracks and audio contexts released",
        ],
      });
      console.log("PASS recorder lifecycle", name);
      await context.close();
      if (engine === chromium && !baseline) {
        const nativeContext = await browser.newContext({ ...device, serviceWorkers: "block" });
        await nativeContext.addInitScript(() => {
          window.nativeAudio = { created: 0, stopped: 0 };
          Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
              getUserMedia: async () => {
                const ctx = new AudioContext();
                await ctx.resume();
                const oscillator = ctx.createOscillator(),
                  gain = ctx.createGain(),
                  destination = ctx.createMediaStreamDestination();
                oscillator.connect(gain);
                gain.connect(destination);
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.setValueAtTime(0, ctx.currentTime + 0.7);
                oscillator.start();
                window.nativeAudio.created++;
                for (const track of destination.stream.getTracks()) {
                  const original = track.stop.bind(track);
                  let stopped = false;
                  track.stop = () => {
                    if (stopped) return;
                    stopped = true;
                    original();
                    oscillator.stop();
                    void ctx.close();
                    window.nativeAudio.stopped++;
                  };
                }
                return destination.stream;
              },
            },
          });
        });
        const nativePage = await nativeContext.newPage();
        nativePage.setDefaultTimeout(10000);
        await nativePage.route("**/*", (route) =>
          new URL(route.request().url()).origin === base ? route.continue() : route.abort(),
        );
        await nativePage.goto(base + "/tests/browser/voice-lifecycle.html");
        await nativePage.locator('output[data-phase="idle"]').waitFor();
        for (let i = 0; i < 3; i++) {
          await nativePage.getByRole("button", { name: "Start", exact: true }).click();
          await nativePage.locator('output[data-phase="recording"]').waitFor();
          await nativePage.locator('output[data-phase="idle"]').waitFor();
          assert.equal(await nativePage.evaluate(() => window.fixture.uploads), i + 1);
          assert.equal(await nativePage.evaluate(() => window.fixture.applied), i + 1);
        }
        assert.deepEqual(await nativePage.evaluate(() => window.nativeAudio), {
          created: 3,
          stopped: 3,
        });
        results.push({
          browser: name,
          result: "PASS",
          physical: false,
          audio:
            "native MediaRecorder/WebAudio, synthetic tone then silence; simulated transcription",
          consecutiveCommands: 3,
        });
        console.log("PASS native audio automatic endpoint, three consecutive recordings", name);
        await nativeContext.close();
      }
    } finally {
      await browser.close();
    }
  }
  await mkdir(".sandbox", { recursive: true });
  await writeFile(".sandbox/VOICE_LIFECYCLE_RESULTS.json", JSON.stringify(results, null, 2));
} finally {
  await server.close();
}
