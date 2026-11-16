import assert from "node:assert/strict";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3074";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
const file = (await readdir(".output/server/_ssr")).find((n) =>
  n.startsWith("deepgram-pilot.functions-"),
);
const source = await readFile(".output/server/_ssr/" + file, "utf8");
const id = (name) => {
  const value = new RegExp(
    "id:\\s*[\"'`]([a-f0-9]+)[\"'`],\\s*name:\\s*[\"'`]" + name + "[\"'`]",
  ).exec(source)?.[1];
  assert(value, name);
  return value;
};
const statusId = id("deepgramPilotStatus"),
  catalogId = id("deepgramPilotCatalog");
const uid = "00000000-0000-4000-8000-000000000001",
  club = "10000000-0000-4000-8000-000000000001";
const user = {
  id: uid,
  email: "synthetic@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: { full_name: "Synthetic Tester" },
};
const exp = Math.floor(Date.now() / 1000) + 3600,
  enc = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
const auth = {
  user,
  access_token: `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ sub: uid, exp, role: "authenticated", aud: "authenticated" })}.synthetic`,
  refresh_token: "synthetic",
  expires_at: exp,
  expires_in: 3600,
  token_type: "bearer",
};
const proposal = (intent, target, fields = {}) => ({
  intent,
  target,
  member: {},
  product: {},
  query: null,
  declined: [],
  question: "Verifica la bozza",
  asking: null,
  ...fields,
});
await mkdir(".sandbox/deepgram", { recursive: true });
for (const [label, engine, device] of [
  ["samsung", chromium, devices["Galaxy S9+"]],
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
    let accountRole = "admin",
      unavailable = false;
    let writes = 0,
      statusCalls = 0,
      catalogCalls = 0,
      sockets = 0,
      peer,
      stops = 0;
    const unexpected = [];
    await context.addInitScript(
      ({ auth, key }) => {
        localStorage.setItem(key, JSON.stringify(auth));
        window.__audio = { started: 0, stopped: 0, played: 0, interrupted: 0, worklet: null };
        const track = {
          stop() {
            window.__audio.stopped++;
          },
          addEventListener() {},
          getSettings() {
            return { echoCancellation: true };
          },
        };
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: {
            async getUserMedia() {
              window.__audio.started++;
              return { getTracks: () => [track], getAudioTracks: () => [track] };
            },
          },
        });
        class Node {
          connect() {}
          disconnect() {}
        }
        window.AudioContext = class {
          constructor() {
            this.sampleRate = 48000;
            this.currentTime = 1;
            this.destination = new Node();
            this.audioWorklet = { addModule: async () => {} };
          }
          async resume() {}
          async close() {}
          createMediaStreamSource() {
            return new Node();
          }
          createGain() {
            return Object.assign(new Node(), { gain: { value: 0 } });
          }
          createBuffer(ch, len, rate) {
            return { duration: len / rate, getChannelData: () => new Float32Array(len) };
          }
          createBufferSource() {
            return Object.assign(new Node(), {
              start() {
                window.__audio.played++;
              },
              stop() {
                window.__audio.interrupted++;
              },
            });
          }
        };
        window.AudioWorkletNode = class extends Node {
          constructor() {
            super();
            this.port = { onmessage: null };
            window.__audio.worklet = this;
          }
        };
      },
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token` },
    );
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      const json = (data) =>
        route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
      if (u.pathname.endsWith("/" + statusId)) {
        statusCalls++;
        await new Promise((r) => setTimeout(r, 650));
        return json({ result: { enabled: !unavailable, unavailable }, context: {} });
      }
      if (u.pathname.endsWith("/" + catalogId)) {
        const data = fromJSON(JSON.parse(req.postData())).data;
        assert.deepEqual(data, { consent: true });
        catalogCalls++;
        return json({
          result: { categories: ["Flores"], products: ["Amnesia Haze"] },
          context: {},
        });
      }
      if (u.origin === api.origin) {
        let data = [];
        if (
          req.method() !== "GET" &&
          !["/rpc/snoop_access_context", "/rpc/current_club_id"].some((p) => u.pathname.endsWith(p))
        ) {
          writes++;
          unexpected.push(u.pathname);
        }
        if (u.pathname.endsWith("/auth/v1/user")) data = user;
        if (u.pathname.endsWith("/rpc/current_club_id")) data = club;
        if (u.pathname.endsWith("/rpc/snoop_access_context"))
          data = {
            role: accountRole,
            status: "active",
            clubId: club,
            clubName: "Club sintético",
            permissions: ["manage_members", "manage_products", "use_cash", "view_reports"],
          };
        if (u.pathname.endsWith("/product_categories"))
          data = [
            {
              id: club,
              club_id: club,
              name: "Flores",
              unit_type: "unit",
              is_smokeable: false,
              archived: false,
            },
          ];
        if (u.pathname.endsWith("/products"))
          data = [
            {
              id: club,
              club_id: club,
              category_id: club,
              name: "Amnesia Haze",
              active: true,
              stock: 0,
              buy_price: 0,
              sell_price: 0,
            },
          ];
        return json(data);
      }
      if (u.pathname.includes("_serverFn")) {
        unexpected.push(u.pathname);
        return json({ result: { available: false }, context: {} });
      }
      if (u.origin !== new URL(base).origin) return route.abort();
      return route.continue();
    });
    await context.routeWebSocket("**/api/snoop-deepgram/socket", (ws) => {
      sockets++;
      peer = ws;
      ws.onMessage((message) => {
        if (message === "STOP") {
          stops++;
          return;
        }
        if (typeof message !== "string") return;
        const m = JSON.parse(message);
        assert.equal(m.type, "AppStart");
        assert.equal(m.token, auth.access_token);
        assert.equal(m.consent, true);
        assert.equal(m.synthetic, true);
        ws.send(JSON.stringify({ type: "AppReady" }));
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/productos", { waitUntil: "domcontentloaded" });
    console.log(label + ": loaded");
    await page.getByRole("heading", { name: "Productos", exact: true }).waitFor();
    // One normal dock click, also valid if the asynchronous provider check is still pending.
    await page.getByRole("button", { name: "SNOOP", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "SNOOP JARVIS 3" });
    await panel.waitFor();
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Avvia JARVIS", exact: true }).click();
    await page.waitForFunction(() =>
      document.body.innerText.includes("interruzione vocale attiva"),
    );
    assert.equal(sockets, 1);
    assert.equal(catalogCalls, 1);
    assert.equal(statusCalls, 1);
    const send = async (p) => {
      peer.send(JSON.stringify({ type: "UserStartedSpeaking" }));
      peer.send(JSON.stringify({ type: "AppProposal", result: { ok: true, proposal: p } }));
    };
    await send(
      proposal("member", "member_create", {
        member: { first_name: "Ana", last_name: "Prueba", birth_date: "1995-03-12", city: "Palma" },
      }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("label")].some(
        (l) => l.textContent.includes("Nombre *") && l.querySelector("input")?.value === "Ana",
      ),
    );
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Prueba");
    assert.equal(
      await page.getByLabel("Fecha de nacimiento *", { exact: true }).inputValue(),
      "1995-03-12",
    );
    await page.getByLabel("Apellidos *", { exact: true }).fill("Manual");
    await send(
      proposal("member", "member_create", { member: { last_name: "Modelo", city: "Inca" } }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some((i) => i.value === "Inca"),
    );
    assert.equal(await page.getByLabel("Apellidos *", { exact: true }).inputValue(), "Manual");
    await page.screenshot({
      path: ".sandbox/deepgram/" + label + "-member.png",
      fullPage: true,
      timeout: 60000,
      animations: "disabled",
    });
    await send(
      proposal("product", "product_create", {
        product: { name: "Amnesia Haze", category: "Flores" },
      }),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('input[placeholder="ej. Amnesia Haze"]')?.value === "Amnesia Haze",
    );
    await page.screenshot({
      path: ".sandbox/deepgram/" + label + "-product.png",
      fullPage: true,
      timeout: 60000,
      animations: "disabled",
    });
    await send(proposal("search", "products", { query: "Amnesia Haze" }));
    await page.waitForFunction(
      () =>
        document.querySelector('input[placeholder="Buscar en todos los productos…"]')?.value ===
        "Amnesia Haze",
    );
    await send(proposal("category", "categories", { product: { name: "Categoría sintética" } }));
    await page.waitForFunction(
      () =>
        document.querySelector('input[placeholder="ej. Flores"]')?.value === "Categoría sintética",
    );
    assert.equal(sockets, 1, "internal navigation must retain the same authenticated socket");
    peer.send(Buffer.alloc(2400));
    await page.waitForFunction(() => window.__audio.played > 0);
    peer.send(JSON.stringify({ type: "UserStartedSpeaking" }));
    await page.waitForFunction(() => window.__audio.interrupted > 0);
    await send(proposal("stop", null));
    await panel.waitFor({ state: "hidden" });
    await page.waitForFunction(() => window.__audio.stopped > 0);
    assert(stops > 0);
    assert.equal(writes, 0, JSON.stringify(unexpected));
    assert.deepEqual(unexpected, []);
    unavailable = true;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "SNOOP", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "No se pudo verificar el asistente" })
      .waitFor();
    assert.equal(await page.getByRole("dialog", { name: "SNOOP", exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "SNOOP JARVIS 3" }).count(), 0);
    assert.equal(sockets, 1, "failed verification must never open a provider session");
    accountRole = "collaborator";
    unavailable = false;
    const readsBeforeStaff = statusCalls;
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "SNOOP", exact: true }).click();
    await page.getByLabel("Sesión de voz", { exact: true }).waitFor();
    await page
      .getByText("Permite transcribir con Cloudflare Whisper. El audio no se guarda.", {
        exact: true,
      })
      .waitFor();
    assert.equal(
      statusCalls,
      readsBeforeStaff,
      "collaborators retain legacy without querying the admin gate",
    );
    assert.equal(sockets, 1);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS " +
        label +
        ": Deepgram dock, consent, one persistent socket, real member/product/category forms, search, protected manual edits, streamed playback/interruption, stop, no automatic writes (audio/provider simulated)",
    );
    await context.close();
  } finally {
    await browser.close();
  }
}
