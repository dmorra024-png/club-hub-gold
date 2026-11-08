import { existsSync } from "node:fs";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
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
      holdTranscription = false,
      resume = null;
    await context.addInitScript(
      ({ auth, key }) => {
        localStorage.setItem(key, JSON.stringify(auth));
        localStorage.setItem("snoop:voice-language", "it-IT");
        window.__voice = { denied: false, created: 0, stopped: 0, recorders: 0 };
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {
            getUserMedia: async () => {
              if (window.__voice.denied) throw new DOMException("Denied", "NotAllowedError");
              window.__voice.created++;
              const track = {
                stop() {
                  window.__voice.stopped++;
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
      },
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
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
        let result = { available, documents: false, browserSpeech: false };
        if (req.method() === "POST") {
          const data = fromJSON(JSON.parse(req.postData())).data;
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
      let data = [];
      if (
        req.method() !== "GET" &&
        (!u.pathname.includes("/rpc/") ||
          u.pathname.endsWith("/rpc/save_membership_with_receipt")) &&
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
          permissions: denied ? [] : ["manage_members"],
        };
      else if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
      else if (u.pathname.endsWith("/membership_plans")) {
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
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    async function start() {
      await page.waitForLoadState("networkidle");
      if (new URL(page.url()).pathname === "/")
        await page.getByRole("heading", { name: "Club Sintético", exact: true }).waitFor();
      const mic = page.getByRole("button", { name: "Encender Snoop", exact: true });
      if (!(await mic.isVisible())) {
        await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
        await page.getByRole("button", { name: "Asistente de voz · ES / IT", exact: true }).click();
      } else await mic.click();
      try {
        await page.getByRole("button", { name: "Apagar Snoop", exact: true }).waitFor();
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
      await page.getByRole("button", { name: "Apagar Snoop", exact: true }).click();
    }
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
    await page.getByRole("button", { name: "Encender Snoop", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Manual");
    const beforeDuplicate = await page.evaluate(() => window.__voice.created),
      beforeExplicitCancel = audioCalls;
    await page.evaluate(() => {
      window.dispatchEvent(new Event("snoop:voice-start"));
      window.dispatchEvent(new Event("snoop:voice-start"));
    });
    await page.getByRole("button", { name: "Apagar Snoop", exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => window.__voice.created),
      beforeDuplicate + 1,
      "Double activation opens one microphone",
    );
    await page.getByRole("button", { name: "Cancelar dictado", exact: true }).click();
    assert.equal(audioCalls, beforeExplicitCancel, "Explicit cancellation never uploads a clip");
    available = false;
    const beforeUnavailable = await page.evaluate(() => window.__voice.created);
    await page.getByRole("button", { name: "Encender Snoop", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "IA no disponible" }).waitFor();
    assert.equal(await page.evaluate(() => window.__voice.created), beforeUnavailable);
    available = true;
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/screenshots/voice2-${name}.png`,
      fullPage: false,
      scale: "css",
    });
    const beforeRevocation = audioCalls;
    await page.getByRole("button", { name: "Dictar datos", exact: true }).click();
    await page.getByText("● Escuchando… pulsa para parar", { exact: true }).waitFor();
    denied = true;
    await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="Dictar datos"]')?.disabled === true,
    );
    assert.equal(
      audioCalls,
      beforeRevocation,
      "Permission revocation discards the pending form recording",
    );
    denied = false;
    await page.evaluate(() => window.dispatchEvent(new Event("snoop:retry-access")));
    await page.waitForFunction(
      () => document.querySelector('button[aria-label="Dictar datos"]')?.disabled === false,
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
    await context.setOffline(true);
    await page.getByRole("alert").filter({ hasText: "Conexión interrumpida" }).waitFor();
    assert.equal(audioCalls, beforeOffline);
    await context.setOffline(false);
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.evaluate(() => (window.__voice.denied = true));
    await page.getByRole("button", { name: "Encender Snoop", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Permiso de micrófono denegado" }).waitFor();
    await page.evaluate(() => (window.__voice.denied = false));
    await page.getByRole("button", { name: "Cerrar", exact: true }).click();
    failTranscription = true;
    await say("nombre Sin guardar");
    await page.getByRole("alert").waitFor();
    failTranscription = false;
    assert.equal(writes, 0);
    await page.goto(base + "/", { waitUntil: "networkidle" });
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
      transcription: "simulated, synthetic recorder",
      checks: [
        "complete IT/ES administrative drafts",
        "actual plan binding",
        "single-field corrections",
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
    console.log("PASS Voice 2.0", name);
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile(
  "docs/VOICE2_ADMINISTRATIVE_BROWSER_RESULTS.json",
  JSON.stringify({ results }, null, 2),
);
