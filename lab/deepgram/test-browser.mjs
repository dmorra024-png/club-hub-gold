import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { chromium, webkit } from "playwright-core";
const assets = {
  "/deepgram": ["index.html", "text/html"],
  "/deepgram/client.js": ["client.js", "text/javascript"],
  "/deepgram/style.css": ["style.css", "text/css"],
};
const server = createServer(async (req, res) => {
  const a = assets[req.url];
  if (!a) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader("Content-Type", a[1]);
  res.end(await readFile("lab/deepgram/" + a[0]));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(".sandbox/deepgram-lab", { recursive: true });
const results = [];
try {
  for (const [name, engine, viewport] of [
    ["samsung", chromium, { width: 412, height: 915 }],
    ["iphone-webkit", webkit, { width: 390, height: 844 }],
  ]) {
    const browser = await engine.launch(
      name === "samsung" && existsSync("/usr/bin/chromium")
        ? { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] }
        : { headless: true },
    );
    try {
      const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
      let ws,
        starts = 0;
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.addInitScript(() => {
        window.__lab = { stops: 0, requests: 0, denied: false };
        Object.defineProperty(navigator, "mediaDevices", {
          value: {
            getUserMedia: async () => {
              window.__lab.requests++;
              if (window.__lab.denied) throw new DOMException("Denied", "NotAllowedError");
              return { getTracks: () => [{ stop: () => window.__lab.stops++ }] };
            },
          },
        });
        class Context {
          constructor() {
            this.sampleRate = 48000;
            this.currentTime = 1;
            this.audioWorklet = { addModule: async () => {} };
            this.destination = {};
          }
          async resume() {}
          async close() {}
          createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
          }
          createGain() {
            return { gain: { value: 0 }, connect() {}, disconnect() {} };
          }
          createBuffer(c, n, r) {
            return { duration: n / r, getChannelData: () => new Float32Array(n) };
          }
          createBufferSource() {
            return { connect() {}, start() {}, stop() {} };
          }
        }
        window.AudioContext = Context;
        window.AudioWorkletNode = class {
          constructor() {
            this.port = {};
          }
          connect() {}
          disconnect() {}
        };
      });
      await page.routeWebSocket("**/deepgram/socket", (route) => {
        ws = route;
        route.onMessage((data) => {
          if (data === "STOP") return;
          const m = JSON.parse(data);
          assert.equal(m.synthetic, true);
          assert(!JSON.stringify(m).includes("DEEPGRAM_API_KEY"));
          if (starts === 1) assert.equal(m.language, "en");
          starts++;
          route.send(
            JSON.stringify({
              type: "LabReady",
              turnDetection: { eotThreshold: 0.85, silenceBackstopMs: 5000 },
              recognitionLanguages: ["it", "es", "en"],
              keytermCount: 25,
              verifiedCategoryCount: 0,
            }),
          );
        });
      });
      await page.goto(base + "/deepgram");
      await page.locator("#start").click();
      assert.equal(await page.evaluate(() => window.__lab.requests), 0);
      await page.locator("#key").fill("synthetic-lab-pass");
      await page.locator("#consent").check();
      await page.locator("#start").click();
      await page.waitForFunction(() =>
        document.querySelector("#status").textContent.includes("in ascolto"),
      );
      assert((await page.locator("#metrics").textContent()).includes("0.85"));
      assert((await page.locator("#metrics").textContent()).includes("5000 ms"));
      ws.send(JSON.stringify({ type: "UserStartedSpeaking" }));
      await page.waitForFunction(
        () => document.querySelector("#status").textContent === "Ti ascolto…",
      );
      await page.locator("[name=first_name]").fill("Manuale");
      ws.send(
        JSON.stringify({
          type: "LabProposal",
          ok: true,
          proposal: {
            target: "member_create",
            member: { first_name: "Luca", last_name: "Prova", city: "Palma" },
            product: {},
          },
        }),
      );
      await page.waitForFunction(
        () => document.querySelector("[name=last_name]").value === "Prova",
      );
      assert.equal(await page.locator("[name=first_name]").inputValue(), "Manuale");
      assert.equal(await page.locator("[name=city]").inputValue(), "Palma");
      assert.equal(await page.locator("#confirm").isEnabled(), true);
      await page.locator("#confirm").click();
      assert((await page.locator("#proposal").textContent()).includes("Nessun dato scritto"));
      // Simulated transcription and interpretation remain distinct for diagnosis.
      ws.send(
        JSON.stringify({
          type: "ConversationText",
          role: "user",
          content: "Cerca Amnesia Hayes nella categoria Flores",
        }),
      );
      ws.send(
        JSON.stringify({
          type: "LabProposal",
          ok: true,
          proposal: {
            intent: "product",
            target: "product_create",
            member: {},
            product: { name: "Amnesia Haze" },
          },
        }),
      );
      await page.waitForFunction(
        () => document.querySelector("[name=name]").value === "Amnesia Haze",
      );
      assert((await page.locator("#transcript").textContent()).includes("Amnesia Hayes"));
      ws.send(
        JSON.stringify({ type: "LabProposal", ok: false, code: "SNOOP_CATEGORY_CONTEXT_REQUIRED" }),
      );
      await page.waitForFunction(() =>
        document.querySelector("#proposal").textContent.includes("categorie verificate"),
      );
      assert.equal(await page.locator("#confirm").isEnabled(), false);
      assert.equal(await page.locator("[name=category]").inputValue(), "");
      assert.equal(await page.locator("#language option[value=en]").count(), 1);
      await page.setViewportSize({ width: viewport.width, height: viewport.height - 290 });
      await page.locator("[name=category]").fill("Sintetica");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.setViewportSize(viewport);
      await page.screenshot({ path: `.sandbox/deepgram-lab/lab-${name}.png`, fullPage: true });
      await page.locator("#stop").click();
      assert.equal(await page.locator("#key").inputValue(), "");
      assert((await page.evaluate(() => window.__lab.stops)) > 0);
      await page.locator("#language").selectOption("en");
      await page.locator("#key").fill("synthetic-lab-pass");
      await page.locator("#start").click();
      await page.waitForFunction(() =>
        document.querySelector("#status").textContent.includes("in ascolto"),
      );
      assert.equal(starts, 2);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForFunction(() =>
        document.querySelector("#status").textContent.includes("secondo piano"),
      );
      assert((await page.evaluate(() => window.__lab.stops)) >= 2);
      await page.evaluate(() => {
        window.__lab.denied = true;
      });
      await page.locator("#key").fill("synthetic-lab-pass");
      await page.locator("#start").click();
      await page.waitForFunction(() =>
        document.querySelector("#status").textContent.includes("negato"),
      );
      assert.deepEqual(errors, []);
      results.push({
        browser: name,
        passed: true,
        physicalHardware: false,
        provider: "mock",
        scenarios: [
          "consent",
          "manual-edit-preserved",
          "draft-only-confirmation",
          "narrow-keyboard-viewport",
          "stop-and-restart",
          "background-stop",
          "permission-denied",
          "transcript-versus-proposal-diagnosis",
          "unverified-category-not-assigned",
        ],
      });
      console.log("PASS lab browser " + name + "; synthetic recorder/provider only");
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
await writeFile(".sandbox/deepgram-lab/browser-results.json", JSON.stringify(results, null, 2));
