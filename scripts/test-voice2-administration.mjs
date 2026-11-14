import { dialogueCases } from "../tests/fixtures/snoop-dialogue-cases.mjs";
import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
import { privateCatalogCommand } from "../src/lib/private-voice.ts";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3040";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001",
  plan = "20000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Synthetic Voice Tester" },
};
const enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url"),
  exp = Math.floor(Date.now() / 1000) + 3600;
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, role: "authenticated", aud: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_at: exp,
  expires_in: 3600,
  token_type: "bearer",
};
const aiDialogue = process.argv.includes("--ai-dialogue");
const conversational = process.argv.includes("--conversation") || aiDialogue;
const results = [];
await mkdir("docs/screenshots", { recursive: true });
for (const [name, engine, device] of [
  ["samsung", chromium, { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } }],
  ["iphone-webkit", webkit, devices["iPhone 13"]],
]) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? {
          executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
          args: ["--no-sandbox"],
        }
      : {}),
  });
  try {
    const context = await browser.newContext({ ...device, serviceWorkers: "block" });
    let transcript = "",
      audioCalls = 0,
      writes = 0,
      memberReads = 0,
      denied = false,
      failTranscription = false,
      available = true,
      catalogDelay = 0,
      holdTranscription = false,
      resume = null,
      aiProposalCalls = 0,
      legacyInterpretations = 0,
      aiOverride = null,
      aiDelay = 0,
      aiQuota = false;
    await context.addInitScript(
      ({ auth, key, conversational }) => {
        localStorage.setItem(key, JSON.stringify(auth));
        localStorage.setItem("snoop:voice-language", conversational ? "es-ES" : "it-IT");
        window.__voice = { denied: false, created: 0, stopped: 0, recorders: 0, speechSamples: 0 };
        const NativeAudio = window.AudioContext || window.webkitAudioContext;
        const NativeRecorder = window.MediaRecorder;
        const Speech = window.SpeechRecognition ?? window.webkitSpeechRecognition;
        window.voiceCapabilities = {
          nativeRecorder: typeof NativeRecorder === "function",
          audioContext: !!NativeAudio,
          localSpeechApi: !!Speech && "processLocally" in Speech.prototype,
          localReady: "not verified; no language pack installed by this test",
          whisperStreaming: false,
        };

        window.__nativeRecordingCheck = async () => {
          const Audio = NativeAudio;
          if (!NativeRecorder || !Audio) return { available: false };
          const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) =>
            NativeRecorder.isTypeSupported(t),
          );
          if (!mime) return { available: false };
          const audio = new Audio(),
            source = audio.createOscillator(),
            destination = audio.createMediaStreamDestination();
          source.connect(destination);
          source.start();
          const recorder = new NativeRecorder(destination.stream, { mimeType: mime });
          try {
            const result = await new Promise((resolve, reject) => {
              const chunks = [];
              recorder.ondataavailable = (e) => chunks.push(e.data);
              recorder.onerror = reject;
              recorder.onstop = () =>
                resolve({
                  available: true,
                  mime,
                  bytes: new Blob(chunks).size,
                  physical: false,
                  source: "synthetic oscillator",
                });
              recorder.start();
              setTimeout(() => recorder.stop(), 200);
            });
            return result;
          } finally {
            source.stop();
            destination.stream.getTracks().forEach((t) => t.stop());
            await audio.close();
          }
        };

        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {
            getUserMedia: async () => {
              if (window.__voice.denied) throw new DOMException("Denied", "NotAllowedError");
              window.__voice.created++;
              const track = {
                readyState: "live",
                stop() {
                  if (this.readyState !== "ended") {
                    this.readyState = "ended";
                    window.__voice.stopped++;
                  }
                },
                onended: null,
              };
              return { getTracks: () => [track] };
            },
          },
        });

        class Recorder {
          static isTypeSupported(type) {
            return type.startsWith("audio/");
          }
          constructor(stream, options) {
            this.mimeType = options.mimeType;
            this.state = "inactive";
            window.__voice.recorders++;
          }
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            queueMicrotask(() => {
              this.ondataavailable?.({
                data: new Blob([new Uint8Array(4096)], { type: this.mimeType }),
              });
              this.onstop?.();
            });
          }
        }
        Object.defineProperty(window, "MediaRecorder", { configurable: true, value: Recorder });
        class LocalAnalyserContext {
          state = "running";
          resume() {
            return Promise.resolve();
          }
          close() {
            this.state = "closed";
            return Promise.resolve();
          }
          createMediaStreamSource() {
            return { connect() {}, disconnect() {} };
          }
          createAnalyser() {
            return {
              fftSize: 1024,
              getByteTimeDomainData(a) {
                if (!window.__voice.silent) window.__voice.speechSamples++;
                a.fill(window.__voice.silent ? 128 : 144);
              },
            };
          }
        }
        Object.defineProperty(window, "AudioContext", {
          configurable: true,
          value: LocalAnalyserContext,
        });
      },
      { auth, conversational, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        isApi =
          u.origin === api.origin &&
          (!api.pathname.replace(/\/$/, "") ||
            u.pathname.startsWith(api.pathname.replace(/\/$/, "") + "/"));
      if (u.origin !== new URL(base).origin && !isApi) return route.abort();
      if (u.pathname.includes("_serverFn")) {
        let result = {
          ...(aiDialogue ? { pilot: true, real: false } : {}),
          available,
          documents: false,
          browserSpeech: false,
          profiles: [{ id: uid, full_name: "Synthetic Voice Tester" }],
          sessions: [],
          movements: [],
          refunds: [],
          auditRecords: [],
          admin: false,
          day: "2026-11-09",
          start: "2026-11-08T23:00:00Z",
          end: "2026-11-09T23:00:00Z",
        };
        if (req.method() === "POST") {
          const data = fromJSON(JSON.parse(req.postData())).data;
          if (aiDialogue && data.mode) {
            assert.equal(data.mode, "pilot");
            assert.deepEqual(data.owner, { userId: uid, clubId: club });
            assert.equal(data.synthetic, true);
            assert.equal(data.consent, true);
            const row = aiOverride
              ? { text: data.text, proposal: aiOverride }
              : dialogueCases[aiProposalCalls];
            assert.equal(data.text, row.text);
            assert.deepEqual(Object.keys(data).sort(), [
              "consent",
              "context",
              "mode",
              "owner",
              "screen",
              "synthetic",
              "text",
            ]);
            if (aiProposalCalls > 4 && aiProposalCalls < 43)
              assert.deepEqual(data.context.declined, ["phone"]);
            aiProposalCalls++;
            if (aiDelay) await new Promise((r) => setTimeout(r, aiDelay));
            return route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                result: { proposal: row.proposal, error: null },
                context: {},
              }),
            });
          }
          if (data.consent === true && data.sketch) {
            legacyInterpretations++;
            assert.deepEqual(Object.keys(data).sort(), ["consent", "sketch"]);
            assert.deepEqual(data.sketch, {
              symbols: ["request", "member", "create"],
              screen: "home",
              references: [],
            });
            aiProposalCalls++;
            return route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                result: {
                  command: aiQuota ? null : "Crear socio",
                  error: aiQuota ? "quota" : null,
                },
                context: {},
              }),
            });
          }
          if (Object.keys(data).length === 1 && "day" in data)
            return route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({ result, context: {} }),
            });
          if (data.transcript && Array.isArray(data.categories)) {
            legacyInterpretations++;
            return route.fulfill({
              contentType: "application/json",
              body: JSON.stringify({
                result: privateCatalogCommand(data.transcript, data.categories),
                context: {},
              }),
            });
          }
          assert.deepEqual(
            Object.keys(data).sort(),
            ["audioBase64", "language", "mimeType"],
            "No text, history, member fields, catalogue or economic data may be sent to another model",
          );
          assert.ok(["it", "es"].includes(data.language));
          audioCalls++;
          if (holdTranscription)
            await new Promise((resolve) => {
              resume = resolve;
            });
          if (failTranscription) return route.abort("failed");
          result = { text: transcript };
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ result, context: {} }),
        });
      }
      if (!isApi) return route.continue();
      if (aiDialogue && req.method() === "POST" && u.pathname.includes("/rpc/")) {
        const rpc = u.pathname.split("/").at(-1);
        assert.ok(
          ["snoop_access_context", "current_club_id"].includes(rpc),
          "unexpected mutation/unmodeled RPC in read-only dialogue",
        );
      }
      let data = [];
      if (
        req.method() !== "GET" &&
        (!u.pathname.includes("/rpc/") ||
          u.pathname.endsWith("/rpc/save_membership_with_receipt") ||
          u.pathname.endsWith("/rpc/confirm_membership_with_receipt")) &&
        !u.pathname.includes("/auth/")
      )
        writes++;
      if (u.pathname.endsWith("/auth/v1/user")) data = user;
      else if (u.pathname.endsWith("/rpc/snoop_access_context"))
        data = {
          role: "collaborator",
          status: "active",
          clubId: club,
          clubName: "Club Sintético",
          permissions: denied
            ? []
            : [
                "manage_members",
                "manage_products",
                "use_cash",
                ...(aiDialogue ? ["view_reports"] : []),
              ],
        };
      else if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
      else if (u.pathname.endsWith("/products")) {
        // Existing reports use an authenticated RLS read rather than a client club filter.
        // The fixture returns only this synthetic club; this is NOT a live RLS proof.
        if (
          aiDialogue &&
          u.searchParams.get("select") === "id,name,stock,buy_price,sell_price,category_id"
        )
          assert.equal(req.headers()["authorization"], `Bearer ${auth.access_token}`);
        else assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
        data = [
          {
            id: "60000000-0000-4000-8000-000000000001",
            club_id: club,
            category_id: plan,
            name: "Amnesia Haze",
            stock: 20,
            buy_price: 0,
            sell_price: 0,
            active: true,
            archived_at: null,
            strain: "hybrid",
            is_smokeable: false,
          },
        ];
      } else if (u.pathname.endsWith("/product_categories")) {
        if (catalogDelay) await new Promise((r) => setTimeout(r, catalogDelay));
        data = [
          { id: plan, club_id: club, name: "Material", unit_type: "unit", is_smokeable: false },
        ];
      } else if (u.pathname.endsWith("/membership_plans")) {
        assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
        data = [
          {
            id: plan,
            club_id: club,
            name: "Mensual",
            active: true,
            duration_days: 30,
            price_cents: 1000,
          },
        ];
      } else if (u.pathname.endsWith("/members")) {
        memberReads++;
        if (u.searchParams.get("select")?.includes("first_name")) {
          assert.equal(u.searchParams.get("club_id"), `eq.${club}`);
          data = [1, 2].map((n) => ({
            id: `30000000-0000-4000-8000-00000000000${n}`,
            club_id: club,
            first_name: "Persona",
            last_name: "Sintética",
            member_number: `000100${n}`,
            dni_number: `TEST00${n}`,
            city: "Demo",
            expires_at: "2030-01-01",
            plan: { name: "Mensual" },
          }));
        }
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    const errors = [],
      expectedOfflineAborts = [];
    let forcingOffline = false;
    page.on("pageerror", (e) => {
      // WebKit emits a native access-control diagnostic when the fixture deliberately
      // aborts an in-flight access-context fetch. Keep all other JS errors fatal.
      if (
        name === "iphone-webkit" &&
        forcingOffline &&
        e.message.endsWith("/rest/v1/rpc/snoop_access_context due to access control checks.")
      )
        expectedOfflineAborts.push(e.message);
      else errors.push(e.message);
    });
    page.setDefaultTimeout(15000);
    async function requestStart() {
      // The actual production dock starts once. Consent also starts once.
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      const permit = page.getByRole("button", { name: "Permitir y escuchar", exact: true });
      if (await permit.isVisible()) await permit.click();
      const checkbox = page.getByRole("checkbox", { name: /transcripción con Cloudflare Whisper/ });
      if ((await checkbox.isVisible()) && !(await checkbox.isChecked())) await checkbox.check();
    }
    async function begin() {
      await requestStart();
      await page.getByRole("button", { name: "Apagar SNOOP", exact: true }).waitFor();
    }
    async function start() {
      await page.waitForLoadState("networkidle");
      if (new URL(page.url()).pathname === "/")
        await page.getByRole("heading", { name: "Club Sintético", exact: true }).waitFor();
      await begin();
      try {
        await page.getByRole("button", { name: "Apagar SNOOP", exact: true }).waitFor();
      } catch (e) {
        console.error(
          "Voice start evidence",
          name,
          await page.evaluate(() => ({
            online: navigator.onLine,
            voice: window.__voice,
            secure: isSecureContext,
            recorder: String(window.MediaRecorder).slice(0, 120),
          })),
          errors,
          await page.locator("body").innerText(),
        );
        throw e;
      }
    }
    async function say(text) {
      transcript = text;
      await start();
      await page.getByRole("button", { name: "Apagar SNOOP", exact: true }).click();
      if (!holdTranscription)
        await page.waitForFunction(() => {
          const panel = document.querySelector(".premium-voice-panel");
          return !panel || panel.getAttribute("data-phase") === "idle";
        });
    }
    if (process.argv.includes("--continuous") || conversational) {
      await page.addInitScript(() => {
        window.voiceTimings = [];
        window.addEventListener("snoop:voice-timing", (e) => window.voiceTimings.push(e.detail));
      });
      await page.goto(base + "/", { waitUntil: "networkidle" });
      if (aiDialogue) {
        await page.evaluate(() => window.dispatchEvent(new Event("snoop:voice-open")));
        assert.equal(
          await page
            .locator('select[aria-label="Modo conversacional"] option[value="real"]')
            .evaluate((option) => option instanceof HTMLOptionElement && option.disabled),
          true,
        );
        await page.getByLabel("Modo conversacional").selectOption("pilot");
        await page
          .getByRole("checkbox", { name: "Confirmo que usaré exclusivamente datos sintéticos." })
          .check();
        await page
          .getByRole("checkbox", { name: "Permitir conversación Cloudflare con datos sintéticos." })
          .check();
        await page.getByRole("button", { name: "Cerrar SNOOP", exact: true }).click();
      }
      transcript = "Crear socio";
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      await page.getByRole("button", { name: "Permitir y escuchar", exact: true }).click();
      const listening = () => page.locator('.snoop-listening[data-phase="recording"]').waitFor();
      const verifiedTurns = [];
      async function phrase(text) {
        transcript = text;
        await listening();
        assert.equal(await page.getByRole("dialog", { name: "SNOOP", exact: true }).count(), 0);
        const before = await page.evaluate(() => window.voiceTimings.length);
        const sampleStart = await page.evaluate(() => window.__voice.speechSamples);
        await page.evaluate(() => (window.__voice.silent = false));
        try {
          // Wait until the actual VAD analyser has sampled synthetic speech.
          // A fixed 400 ms wall clock sleep can miss the window while the
          // continuous recorder is restarting after a navigation.
          await page.waitForFunction(
            (baseline) => window.__voice.speechSamples >= baseline + 4,
            sampleStart,
            { timeout: 10000 },
          );
        } finally {
          await page.evaluate(() => (window.__voice.silent = true));
        }
        try {
          await page.waitForFunction((before) => window.voiceTimings.length > before, before);
        } catch (error) {
          console.error("Synthetic voice sequence failure", {
            device: name,
            text,
            audioCalls,
            errors,
            snapshot: await page.evaluate(() => ({
              path: location.pathname,
              badge: document.querySelector(".snoop-listening")?.textContent,
              phase: document.querySelector(".snoop-listening")?.getAttribute("data-phase"),
              voice: window.__voice,
              timingCount: window.voiceTimings.length,
            })),
          });
          throw error;
        }
        await listening();
        verifiedTurns.push(text);
      }
      if (aiDialogue) {
        const assertions = [];
        for (const row of dialogueCases) {
          const p = row.proposal;
          if (p.intent === "stop") {
            transcript = row.text;
            await listening();
            await page.evaluate(() => (window.__voice.silent = false));
            await page.waitForTimeout(400);
            await page.evaluate(() => (window.__voice.silent = true));
            await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
            assertions.push(row.text);
            break;
          }
          if (aiProposalCalls === 15) catalogDelay = 1400;
          await phrase(row.text);
          catalogDelay = 0;
          if (p.target)
            await page.waitForURL(
              base +
                {
                  home: "/",
                  member_create: "/soci/nuovo",
                  members: "/soci/gestisci",
                  products: "/productos",
                  product_create: "/productos",
                  categories: "/productos",
                  stock: "/productos",
                  cash: "/caja",
                  reports: "/ajustes/informes",
                  activity: "/actividades",
                }[p.target],
            );
          const labels = {
            first_name: "Nombre *",
            last_name: "Apellidos *",
            birth_date: "Fecha de nacimiento *",
            city: /^Ciudad/,
            phone: /^Teléfono/,
          };
          for (const [key, value] of Object.entries(p.member))
            assert.equal(
              await page
                .getByLabel(labels[key], { exact: typeof labels[key] === "string" })
                .inputValue(),
              value,
            );
          if (p.intent === "product") {
            if (p.product.name)
              assert.equal(
                await page.getByPlaceholder("ej. Amnesia Haze").inputValue(),
                p.product.name,
              );
            if (p.product.category)
              assert.equal(await page.getByLabel("Categoría", { exact: true }).inputValue(), plan);
          }
          if (p.intent === "search")
            assert.equal(
              await page
                .getByPlaceholder(
                  p.target === "members"
                    ? "Buscar por nº socio, nombre, DNI o ciudad..."
                    : "Buscar en todos los productos…",
                )
                .inputValue(),
              p.query,
            );
          if (p.intent === "clarify" || p.intent === "review")
            await page.locator(".snoop-listening").filter({ hasText: p.question }).waitFor();
          assert.equal(writes, 0);
          assert.equal(legacyInterpretations, 0, "no concurrent legacy interpreter");
          assert.equal(
            aiProposalCalls,
            assertions.length + 1,
            "exactly one interpreter for each turn",
          );
          assertions.push(row.text);
        }
        assert.equal(assertions.length, 51);
        assert.equal(
          aiProposalCalls,
          50,
          "spoken stop is handled locally for immediate interruption",
        );
        assert.deepEqual(errors, []);
        aiOverride = { ...dialogueCases[1].proposal, member: { first_name: "Outdated" } };
        aiDelay = 900;
        transcript = "Nombre voz pendiente";
        await page.getByRole("button", { name: "SNOOP", exact: true }).click();
        await listening();
        const pending = page.waitForRequest(
          (req) => req.method() === "POST" && req.postData()?.includes('"mode"'),
        );
        const turn = phrase(transcript);
        await pending;
        await page.getByLabel("Nombre *", { exact: true }).fill("Manual");
        await turn;
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Manual");
        assert.equal(writes, 0);
        assert.equal(legacyInterpretations, 0);
        await page.getByRole("button", { name: "Terminar escucha", exact: true }).click();
        await page.screenshot({
          path: `docs/screenshots/snoop-ai-dialogue-${name}.png`,
          scale: "css",
        });
        results.push({
          device: name,
          result: "PASS",
          physical: false,
          transcription: "simulated",
          model: "simulated",
          turns: assertions,
          automaticWrites: writes,
          metrics: await page.evaluate(() => window.voiceTimings),
        });
        console.log("PASS SNOOP AI isolated dialogue", name, assertions.length, "turns");
        await context.close();
        continue;
      }
      await phrase("Crear socio");
      await page.waitForURL(base + "/soci/nuovo");
      if (conversational) {
        await page
          .locator(".snoop-listening")
          .filter({ hasText: "Dime nombre y apellidos" })
          .waitFor();
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "");
        await phrase("Un momento");
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "");
      }
      await phrase(conversational ? "Marco Rossi" : "Nombre Carlos, apellido García");
      assert.equal(
        await page.getByLabel("Nombre *", { exact: true }).inputValue(),
        conversational ? "Marco" : "Carlos",
      );
      assert.equal(
        await page.getByLabel("Apellidos *", { exact: true }).inputValue(),
        conversational ? "Rossi" : "García",
      );
      if (conversational) {
        await phrase("Si chiama Marco, no scusa Mario Rossi");
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Mario");
        await phrase("Aspetta, cambia il cognome");
        assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Rossi");
        await page
          .locator(".snoop-listening")
          .filter({ hasText: /apellidos|cognome/ })
          .waitFor();
        await phrase("Bianchi");
        assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Bianchi");
        await phrase("È nato il dodici marzo del novantacinque a Palma");
        assert.equal(await page.getByLabel("Fecha de nacimiento *").inputValue(), "");
        await phrase("1995");
        assert.equal(await page.getByLabel("Fecha de nacimiento *").inputValue(), "1995-03-12");
        await phrase("Nombre Marco, apellido Rossi");
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Marco");
        for (const [utterance, field, expected] of [
          ["Nombre Carlos, apellido López", "Nombre *", "Carlos"],
          ["Cambia el apellido a García", "Apellidos *", "García"],
          ["Nombre Mario", "Nombre *", "Mario"],
          ["Apellido Rossi", "Apellidos *", "Rossi"],
          ["Ciudad Palma", "Ciudad", "Palma"],
          ["Apellidos Pérez", "Apellidos *", "Pérez"],
          ["Nombre Ana", "Nombre *", "Ana"],
          ["Nombre Marco", "Nombre *", "Marco"],
        ]) {
          await phrase(utterance);
          assert.equal(
            await page
              .getByLabel(field === "Ciudad" ? /^Ciudad/ : field, { exact: true })
              .inputValue(),
            expected,
          );
        }
      }
      await phrase(
        conversational ? "12 marzo 1995, vive a Palma" : "Fecha de nacimiento 15 de marzo de 1995",
      );
      assert.equal(
        await page.getByLabel("Fecha de nacimiento *", { exact: true }).inputValue(),
        conversational ? "1995-03-12" : "1995-03-15",
      );
      if (conversational) {
        assert.equal(await page.getByLabel(/^Ciudad/).inputValue(), "Palma");
        await phrase("Sì, 666123456. Anzi, cambia il cognome in Bianchi");
        assert.equal(await page.getByLabel(/Teléfono/).inputValue(), "666123456");
        assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Bianchi");
        await phrase("Nombre Juan Carlos, apellidos García López");
        assert.equal(
          await page.getByLabel("Nombre *", { exact: true }).inputValue(),
          "Juan Carlos",
        );
        assert.equal(
          await page.getByLabel("Apellidos *", { exact: true }).inputValue(),
          "García López",
        );
        await phrase("Nombre Marco, apellido Rossi");
        assert.equal(
          await page.getByRole("button", { name: "Dictar datos", exact: true }).count(),
          0,
        );
        await phrase("Cambia el apellido a García");
        assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "García");
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Marco");
        const original = await page
          .locator("input")
          .evaluateAll((inputs) => inputs.map((i) => i.value));
        await phrase("las nubes cantan sobre el mar");
        assert.deepEqual(
          await page.locator("input").evaluateAll((inputs) => inputs.map((i) => i.value)),
          original,
        );
        await phrase("resumen");
        await page
          .locator(".snoop-listening")
          .filter({ hasText: "Para guardar usa su botón" })
          .waitFor();
        await page
          .getByLabel("Nombre *", { exact: true })
          .evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await page.screenshot({
          path: `docs/screenshots/voice-conversation-${name}.png`,
          scale: "css",
        });
        transcript = "Stop Snoop";
        await page.evaluate(() => (window.__voice.silent = false));
        await page.waitForTimeout(400);
        await page.evaluate(() => (window.__voice.silent = true));
        await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
        await page.getByRole("button", { name: "SNOOP", exact: true }).click();
        await listening();
      }
      await phrase("Ciudad Palma, teléfono 666123456");
      assert.equal(await page.getByLabel(/^Ciudad/).inputValue(), "Palma");
      assert.equal(await page.getByLabel(/Teléfono/).inputValue(), "666123456");
      assert.equal(
        await page.evaluate(() => window.__voice.created),
        conversational ? 2 : 1,
        "same microphone across route and successive phrases",
      );
      // Manual edits during delayed transcription must win.
      holdTranscription = true;
      resume = null;
      transcript = "No, el apellido es Tardío";
      await page.evaluate(() => (window.__voice.silent = false));
      await page.waitForTimeout(400);
      await page.evaluate(() => (window.__voice.silent = true));
      await page.waitForFunction(
        () =>
          document.querySelector(".snoop-listening")?.getAttribute("data-phase") === "processing",
      );
      await page.locator(".snoop-listening").filter({ hasText: "Transcribiendo" }).waitFor();
      for (let i = 0; !resume && i < 100; i++) await page.waitForTimeout(20);
      assert.ok(resume);
      await page.waitForTimeout(1200);
      assert.equal(
        await page.evaluate(() => window.__voice.created),
        conversational ? 2 : 1,
        "no overlapping recording while response is slow",
      );
      await page.getByLabel("Apellidos *", { exact: true }).fill("Manual");
      holdTranscription = false;
      resume();
      await listening();
      assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Manual");
      await phrase("No, la città è Barcelona");
      assert.equal(await page.getByLabel(/^Ciudad/).inputValue(), "Barcelona");
      await phrase("abrir caja o producto");
      assert.equal(
        new URL(page.url()).pathname,
        "/soci/nuovo",
        "ambiguous command does not navigate",
      );
      // Successful intent following a delayed request stays in the same session.
      catalogDelay = 2400;
      await phrase("Crear producto Libreta en categoría Material");
      catalogDelay = 0;
      await page.waitForURL(base + "/productos");
      assert.equal(
        await page.getByRole("button", { name: "Dictar nombre", exact: true }).count(),
        0,
      );
      await phrase("Nombre Cuaderno, categoría Material, precio diez euros con cincuenta");
      assert.equal(await page.getByPlaceholder("ej. Amnesia Haze").inputValue(), "Cuaderno");
      assert.equal(await page.getByLabel("P. venta €", { exact: true }).inputValue(), "10.5");
      assert.equal(
        await page.evaluate(() => window.__voice.created),
        conversational ? 2 : 1,
        "same stream also survives product navigation",
      );
      let metrics = await page.evaluate(() => window.voiceTimings);
      await page.screenshot({
        path: `docs/screenshots/${conversational ? "voice-conversation-product" : "voice-session"}-${name}.png`,
        scale: "css",
      });
      transcript = "Terminar";
      await page.evaluate(() => (window.__voice.silent = false));
      await page.waitForTimeout(400);
      await page.evaluate(() => (window.__voice.silent = true));
      await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
      const stopped = audioCalls;
      await page.waitForTimeout(300);
      assert.equal(audioCalls, stopped);
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      await listening();
      await page.getByRole("button", { name: "Terminar escucha", exact: true }).click();
      await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
      if (conversational) {
        await page
          .getByRole("navigation", { name: "Navegación principal" })
          .getByRole("link", { name: "Home", exact: true })
          .click();
        await page.waitForURL(base + "/");
        await page.evaluate(() => window.dispatchEvent(new Event("snoop:voice-open")));
        await page.getByRole("checkbox", { name: /Permitir sugerencias IA/ }).check();
        await page.getByRole("button", { name: "Cerrar SNOOP", exact: true }).click();
        assert.equal(aiProposalCalls, 0);
        await page.getByRole("button", { name: "SNOOP", exact: true }).click();
        await listening();
        const fuzzy = "Snoop fammi uno socio nuovo";
        await phrase(fuzzy);
        await page.waitForURL(base + "/soci/nuovo");
        assert.equal(
          await page.getByLabel("Nombre *", { exact: true }).inputValue(),
          "",
          "validated AI navigation never invents member data",
        );
        assert.equal(aiProposalCalls, 1);
        await page
          .getByRole("navigation", { name: "Navegación principal" })
          .getByRole("link", { name: "Home", exact: true })
          .click();
        await page.waitForURL(base + "/");
        await listening();
        aiQuota = true;
        await phrase(fuzzy);
        await page.locator(".snoop-listening").filter({ hasText: "Cuota IA agotada" }).waitFor();
        assert.equal(aiProposalCalls, 2);
        await phrase(fuzzy);
        assert.equal(aiProposalCalls, 2, "quota failure disables further remote attempts");
        await phrase("Crear socio");
        await page.waitForURL(base + "/soci/nuovo");
        await phrase("Juan Carlos García López");
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "");
        await phrase("Juan Carlos");
        assert.equal(
          await page.getByLabel("Nombre *", { exact: true }).inputValue(),
          "Juan Carlos",
        );
        await phrase("García López");
        assert.equal(
          await page.getByLabel("Apellidos *", { exact: true }).inputValue(),
          "García López",
        );
        await phrase("Nombre Marco, apellido Rossi");
        assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Marco");
        assert.equal(aiProposalCalls, 2, "member fields stay local despite AI opt-in");
        transcript = "Snoop, fermati";
        await page.evaluate(() => (window.__voice.silent = false));
        await page.waitForTimeout(400);
        await page.evaluate(() => (window.__voice.silent = true));
        await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
      }
      // Background/freeze must terminate the session and must not resume on return.
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      await listening();
      await page.evaluate(() => document.dispatchEvent(new Event("freeze")));
      await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
      const backgroundCount = await page.evaluate(() => window.__voice.created);
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => window.__voice.created), backgroundCount);
      // A provider failure pauses, releases the microphone, and never auto-retries.
      failTranscription = true;
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      await listening();
      await page.evaluate(() => (window.__voice.silent = false));
      await page.waitForTimeout(400);
      await page.evaluate(() => (window.__voice.silent = true));
      await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
      failTranscription = false;
      await page.evaluate(() => (window.__voice.denied = true));
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Permite el micrófono" }).waitFor();
      await page.evaluate(() => (window.__voice.denied = false));
      await page.getByRole("button", { name: "SNOOP", exact: true }).click();
      await listening();
      const beforeRevoked = audioCalls;
      denied = true;
      await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
      await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
      await page.waitForTimeout(400);
      assert.equal(
        await page.evaluate(() => window.__voice.created === window.__voice.stopped),
        true,
        "revoked session cannot silently rearm",
      );
      assert.equal(audioCalls, beforeRevoked, "permission revocation discards pending audio");
      assert.equal(writes, 0);
      if (conversational)
        assert.ok(
          new Set(verifiedTurns).size >= 30,
          "at least 30 distinct full browser utterances",
        );
      assert.deepEqual(errors, []);
      metrics = await page.evaluate(() => window.voiceTimings);
      results.push({
        device: name,
        physical: false,
        result: "PASS",
        transcription: "simulated",
        verifiedTurns,
        ai: conversational ? "simulated proposals and quota, not live GLM" : "not requested",
        metrics,
        capabilities: await page.evaluate(() => window.voiceCapabilities),
        checks: [
          "persistent root",
          "one mic across navigation",
          "ES successive member fields",
          "product patches",
          "manual edit wins",
          "spoken stop/restart",
          "zero writes",
          "minimal indicator",
        ],
      });
      console.log(
        conversational ? "PASS conversational member session" : "PASS continuous voice session",
        name,
      );
      await context.close();
      continue;
    }
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const nativeRecording = await page.evaluate(() => window.__nativeRecordingCheck());
    if (nativeRecording.available)
      assert.ok(
        nativeRecording.bytes > 0,
        "Native browser encodes synthetic audio without external services",
      );
    const dock = page.getByRole("navigation", { name: "Navegación principal" });
    assert.equal(await dock.locator(":scope > *").count(), 4);
    const dockGeometry = await dock.evaluate((el) =>
      Array.from(el.children).map((e) => {
        const r = e.getBoundingClientRect(),
          i = e.querySelector("svg").getBoundingClientRect(),
          l = e.querySelector("span").getBoundingClientRect();
        return {
          width: r.width,
          top: r.top,
          height: r.height,
          iconWidth: i.width,
          iconHeight: i.height,
          labelTop: l.top,
        };
      }),
    );
    for (const field of ["width", "top", "height", "iconWidth", "iconHeight", "labelTop"])
      assert.ok(
        Math.max(...dockGeometry.map((r) => r[field])) -
          Math.min(...dockGeometry.map((r) => r[field])) <
          1,
        `equal dock ${field}`,
      );

    await page.evaluate(() => window.dispatchEvent(new Event("snoop:voice-open")));
    assert.equal(
      await page.evaluate(() => window.__voice.created),
      0,
      "Opening Voice never captures audio",
    );
    assert.equal(
      await page.getByRole("button", { name: "Encender SNOOP", exact: true }).isDisabled(),
      true,
      "Consent is required before recording",
    );
    await page.screenshot({ path: `docs/screenshots/voice2-premium-${name}.png`, scale: "css" });
    await page.getByRole("checkbox", { name: "Continuar escuchando", exact: true }).uncheck();
    // Written fallback is fully local and works without consent or a speech provider.
    await page
      .getByRole("textbox", { name: "Comando escrito", exact: true })
      .fill("Buscar socio Juan");
    const fullViewport = { ...device.viewport };
    await page.setViewportSize({ width: fullViewport.width, height: fullViewport.height - 260 });
    await page.waitForFunction(() => document.body.dataset.snoopKeyboard === "true");
    assert.equal(await dock.isHidden(), true);
    await page.waitForFunction(() => {
      const input = document.querySelector('input[aria-label="Comando escrito"]'),
        r = input?.getBoundingClientRect();
      return (
        document.activeElement === input &&
        r.top >= 0 &&
        r.bottom <= (window.visualViewport?.height ?? innerHeight)
      );
    });
    assert.equal(
      await page.getByRole("textbox", { name: "Comando escrito", exact: true }).inputValue(),
      "Buscar socio Juan",
    );
    await page.setViewportSize(fullViewport);
    await page.getByRole("button", { name: "Aplicar comando", exact: true }).click();
    await page.waitForURL(base + "/soci/gestisci");
    await page.waitForFunction(() => document.querySelector("input")?.value === "Juan");
    assert.equal(audioCalls, 0);
    await page.goto(base + "/", { waitUntil: "networkidle" });
    const automaticCommands = [
      ["Crear socio", "/soci/nuovo"],
      ["Buscar socio Carlos García", "/soci/gestisci"],
      ["Crear producto", "/productos"],
      ["Buscar producto Amnesia Haze", "/productos"],
      ["Ver stock", "/productos"],
      ["Crear categoría Archivo", "/productos"],
      ["Abrir caja", "/caja"],
      ["Ver caja de hoy", "/caja"],
      ["Últimas actividades", "/actividades"],
      ["Hacer pedido", "/soci/gestisci"],
    ];
    for (const [command, path] of automaticCommands) {
      transcript = command;
      await page.evaluate(() => (window.__voice.silent = false));
      const before = audioCalls;
      await requestStart();
      await page.getByRole("button", { name: "Apagar SNOOP", exact: true }).waitFor();
      await page.waitForTimeout(400);
      await page.evaluate(() => (window.__voice.silent = true));
      await page.waitForURL(base + path);
      await page.getByRole("dialog", { name: "SNOOP", exact: true }).waitFor({ state: "hidden" });
      assert.equal(
        audioCalls,
        before + 1,
        "one tap and speech/silence produce exactly one transcription",
      );
      if (command === "Buscar producto Amnesia Haze") {
        assert.equal(
          await page.getByPlaceholder("Buscar en todos los productos…").inputValue(),
          "Amnesia Haze",
        );
        await page.getByRole("button", { name: "Editar Amnesia Haze", exact: true }).waitFor();
      }
      if (command === "Ver stock")
        await page.getByPlaceholder("Buscar en todos los productos…").waitFor();
      if (command.startsWith("Crear categoría"))
        assert.equal(await page.getByPlaceholder("ej. Flores").inputValue(), "Archivo");
      if (command === "Ver caja de hoy")
        assert.equal(
          await page
            .getByRole("tab", { name: "Informe de caja", exact: true })
            .getAttribute("aria-selected"),
          "true",
        );
      assert.equal(writes, 0);
    }
    await page.evaluate(() => (window.__voice.silent = false));
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Home", exact: true })
      .click();
    await page.waitForURL(base + "/");
    await say("Crea un socio Mario Rossi, nato il 15 marzo 1990, residente a Palma");
    await page.waitForURL(base + "/soci/nuovo");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("input")).some((i) => i.value === "Mario"),
    );
    assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Mario");
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Rossi");
    assert.equal(
      await page.getByLabel("Fecha de nacimiento *", { exact: true }).inputValue(),
      "1990-03-15",
    );
    assert.equal(await page.getByLabel(/^Ciudad/).inputValue(), "Palma");
    assert.equal(writes, 0);
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await say(
      "Crea un producto Libreta en categoría Material, precio diez euros con cincuenta, stock veinticinco unidades",
    );
    await page.waitForURL(base + "/productos");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("input")).some((i) => i.value === "Libreta"),
    );
    assert.equal(
      await page.getByRole("combobox", { name: "Categoría", exact: true }).inputValue(),
      plan,
    );
    assert.equal(await page.getByLabel("Stock (unit)", { exact: true }).inputValue(), "25");
    assert.equal(await page.getByLabel("P. venta €", { exact: true }).inputValue(), "10.5");
    await say("No, el precio es cinco euros con veinte");
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="P. venta €"]')?.value === "5.2",
    );
    assert.equal(await page.getByLabel("Stock (unit)", { exact: true }).inputValue(), "25");
    const productName = page.getByPlaceholder("ej. Amnesia Haze");
    await say("Crea un prodotto Quaderno, categoria Material, quantità venticinque");
    await page.waitForFunction(
      () => document.querySelector('input[placeholder="ej. Amnesia Haze"]')?.value === "Quaderno",
    );
    assert.equal(await page.getByLabel("Stock (unit)", { exact: true }).inputValue(), "25");
    await say("No, lo stock è zero");
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="Stock (unit)"]')?.value === "",
    );
    assert.equal(await productName.inputValue(), "Quaderno");
    assert.equal(writes, 0);
    await productName.fill("Libreta manual");
    holdTranscription = true;
    resume = null;
    await say("No, el nombre es Resultado tardío");
    for (let n = 0; !resume && n < 100; n++) await page.waitForTimeout(20);
    assert.ok(resume, "Product transcription is pending");
    await productName.fill("Libreta manual definitiva");
    holdTranscription = false;
    resume();
    await page.getByRole("dialog", { name: "SNOOP", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await productName.inputValue(), "Libreta manual definitiva");
    await productName.fill("Libreta manual");

    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(300);
    assert.equal(await productName.inputValue(), "Libreta manual");
    assert.equal(writes, 0);
    await page.screenshot({
      path: `docs/screenshots/critical-voice-supplies-${name}.png`,
      scale: "css",
    });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await say(
      "SNOOP, registra un socio Persona Sintetica, nato il ventiquattro luglio millenovecentonovantacinque, residente a Palma, telefono sei sei sei sette sette sette otto otto otto, email prova chiocciola esempio punto test, quota Mensile",
    );
    await page.waitForURL(base + "/soci/nuovo");
    await page.waitForFunction(
      () => document.querySelector("input[type=email]")?.value === "prova@esempio.test",
    );
    assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Persona");
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Sintetica");
    assert.equal(
      await page.getByLabel("Fecha de nacimiento *", { exact: true }).inputValue(),
      "1995-07-24",
    );
    assert.equal(
      await page.getByRole("button", { name: /Mensual/ }).getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("region", { name: "Resumen del dictado", exact: true }).waitFor();
    assert.equal(writes, 0);
    await say("No, cambia solamente el apellido a Demo");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("input")).some((i) => i.value === "Demo"),
    );
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Demo");
    assert.equal(await page.getByLabel("Nombre *", { exact: true }).inputValue(), "Persona");
    await page.evaluate(() => window.dispatchEvent(new Event("snoop:voice-open")));
    await page
      .getByRole("combobox", { name: "Idioma de voz / Lingua voce", exact: true })
      .selectOption("es-ES");
    await say("No, la ciudad es Barcelona");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("input")).some((i) => i.value === "Barcelona"),
    );
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Demo");
    assert.equal(writes, 0);
    // A user's newer manual correction wins over a late transcription result.
    holdTranscription = true;
    resume = null;
    await say("No, apellido Dictado");
    for (let n = 0; !resume && n < 100; n++) await page.waitForTimeout(20);
    assert.ok(resume, "Transcription request is pending");
    await page.getByLabel("Apellidos *", { exact: true }).fill("Manual");
    holdTranscription = false;
    resume();
    await page.getByRole("dialog", { name: "SNOOP", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Manual");
    // “Encender” is also rendered while transcription is busy, but disabled.
    // Observe completion before dispatching synthetic events that bypass native button gating.
    await page.evaluate(() => window.dispatchEvent(new Event("snoop:voice-open")));
    await page.locator('button[aria-label="Encender SNOOP"]:not(:disabled)').waitFor();
    const beforeDuplicate = await page.evaluate(() => window.__voice.created),
      beforeExplicitCancel = audioCalls;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("snoop:voice-start"));
      window.dispatchEvent(new Event("snoop:voice-start"));
    });
    await page.getByRole("button", { name: "Apagar SNOOP", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__voice.created),
      beforeDuplicate + 1,
      "Double activation opens one microphone",
    );
    await page.getByRole("button", { name: "Cancelar dictado", exact: true }).click();
    assert.equal(audioCalls, beforeExplicitCancel, "Explicit cancellation never uploads a clip");
    available = false;
    const beforeUnavailable = await page.evaluate(() => window.__voice.created);
    await page.getByRole("button", { name: "Encender SNOOP", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "IA no disponible" }).waitFor();
    assert.equal(await page.evaluate(() => window.__voice.created), beforeUnavailable);
    available = true;
    await page.getByRole("button", { name: "Cerrar SNOOP", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/screenshots/voice2-${name}.png`,
      fullPage: false,
      scale: "css",
    });
    const beforeRevocation = audioCalls;
    await start();
    denied = true;
    await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
    await page
      .getByRole("button", { name: "Apagar SNOOP", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      audioCalls,
      beforeRevocation,
      "Permission revocation discards the pending form recording",
    );
    // Disabled can mean an access refresh is still in flight. Observe actual
    // recorder cancellation before restoring the fixture's permission, otherwise
    // verifiedAccess legitimately coalesces both refreshes into the same request.
    await page
      .getByRole("button", { name: "Apagar SNOOP", exact: true })
      .waitFor({ state: "hidden" });
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => window.__voice.created === window.__voice.stopped);
    denied = false;
    await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="SNOOP"]')?.disabled === false,
    );
    const beforeCancel = audioCalls;
    await start();
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Home", exact: true })
      .click();
    await page.waitForURL(base + "/");
    assert.equal(audioCalls, beforeCancel, "Navigation discards a pending recording");
    assert.ok(
      await page.evaluate(() => window.__voice.created === window.__voice.stopped),
      "Every acquired microphone track was stopped",
    );
    await say("Busca al socio Persona Sintética");
    await page.waitForURL(base + "/soci/gestisci");
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "Persona Sintética",
    );
    assert.equal(
      new URL(page.url()).pathname,
      "/soci/gestisci",
      "Ambiguous member matches must not open the first result",
    );
    const beforeOffline = audioCalls;
    await start();
    forcingOffline = true;
    await context.setOffline(true);
    await page.getByRole("alert").filter({ hasText: "Conexión interrumpida" }).waitFor();
    assert.equal(audioCalls, beforeOffline);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Cerrar SNOOP", exact: true }).click();
    await page.evaluate(() => (window.__voice.denied = true));
    await requestStart();
    await page.getByRole("alert").filter({ hasText: "Permiso de micrófono denegado" }).waitFor();
    await page.evaluate(() => (window.__voice.denied = false));
    await page.getByRole("button", { name: "Cerrar SNOOP", exact: true }).click();
    await page.waitForLoadState("networkidle");
    forcingOffline = false;
    failTranscription = true;
    await say("nombre Sin guardar");
    await page.getByRole("alert").waitFor();
    failTranscription = false;
    assert.equal(writes, 0);
    await page.goto(base + "/", { waitUntil: "networkidle" });
    async function written(command) {
      await page.evaluate(() => window.dispatchEvent(new Event("snoop:voice-open")));
      await page.getByRole("textbox", { name: "Comando escrito", exact: true }).fill(command);
      await page.getByRole("button", { name: "Aplicar comando", exact: true }).click();
    }
    await written("Buscar producto Café Especial");
    await page.waitForURL(base + "/productos");
    await page.waitForFunction(
      () =>
        document.querySelector('input[placeholder="Buscar en todos los productos…"]')?.value ===
        "Café Especial",
    );
    await written("Ver caja de hoy");
    await page.waitForURL(base + "/caja");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('[role="tab"]')).some(
        (e) => e.textContent === "Informe de caja" && e.getAttribute("aria-selected") === "true",
      ),
    );
    await written("Últimas actividades");
    await page.waitForURL(base + "/actividades");
    await page.waitForLoadState("networkidle");
    assert.equal(
      writes,
      0,
      "Voice navigation never opens a cash session or writes economic records",
    );
    // Use the real Home control: a hard document navigation intentionally restores
    // the saved PWA location and is not equivalent to the user's Home action.
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: "Home", exact: true })
      .click();
    await page.waitForURL(base + "/");
    await page.getByRole("heading", { name: "Club Sintético", exact: true }).waitFor();
    denied = true;
    await page.reload({ waitUntil: "networkidle" });
    const readBefore = memberReads;
    await say("Registra un socio nombre Prohibido apellido Sintético");
    await page.getByText("No tienes permiso para esta función.", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(memberReads, readBefore);
    assert.equal(await page.evaluate(() => sessionStorage.getItem("snoop:member-draft")), null);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    results.push({
      device: name,
      result: "PASS",
      physical: false,
      nativeRecording,
      expectedOfflineAborts,
      transcription: "simulated, synthetic recorder",
      checks: [
        "four-item premium dock and compact Voice panel",
        "nine consecutive single-tap commands with automatic local speech endpoint",
        "equal-width dock actions, equal icons and aligned labels",
        "keyboard simulation hides dock and preserves focused command field",
        "opening panel never captures audio; explicit consent required",
        "written fallback routes a local member search without audio/provider",
        "product query preserves name and accents in actual search field",
        "cash today selects existing report tab without cash mutation",
        "latest activity opens existing history",
        "complete IT/ES administrative drafts",
        "exact Mario Rossi real-user phrase into actual member fields",
        "generic non-smokeable Libreta creation routed into actual category/name/quantity fields",
        "actual plan binding",
        "single-field corrections and spoken Spanish decimal prices on synthetic stationery",
        "scoped local member search",
        "no ambiguous auto-open",
        "permissions before field handoff",
        "live permission revocation cancels the form recorder",
        "recording cancelled on navigation/offline",
        "permission denial",
        "network error recovery",
        "late transcript preserves manual edits",
        "double start opens one microphone",
        "explicit cancel does not upload",
        "unavailable service preserves manual entry",
        "no text-model calls",
        "zero writes",
      ],
    });
    console.log("PASS SNOOP", name);
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile(
  aiDialogue
    ? "docs/SNOOP_AI_DIALOGUE_RESULTS.json"
    : conversational
      ? "docs/VOICE_CONVERSATION_RESULTS.json"
      : process.argv.includes("--continuous")
        ? "docs/VOICE_SESSION_RESULTS.json"
        : "docs/VOICE2_ADMINISTRATIVE_BROWSER_RESULTS.json",
  JSON.stringify({ results }, null, 2),
);
