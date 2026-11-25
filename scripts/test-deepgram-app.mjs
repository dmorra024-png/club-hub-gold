import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, webkit, devices } from "playwright-core";
import { fromJSON } from "seroval";
const pendingResume = process.argv.includes("--pending-resume");
const thirdExecutionId = "70000000-0000-4000-8000-000000000003";
const secondExecutionId = "70000000-0000-4000-8000-000000000002";
const executionUI = process.argv.includes("--execution-ui");
const startupOnly = process.argv.includes("--startup-only");
const nativeAudio = process.argv.includes("--native-audio");
assert(
  !nativeAudio || (startupOnly && !pendingResume),
  "Native audio uses the isolated startup scenario",
);
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3074";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const api = new URL(
  process.env.TEST_SUPABASE_URL ||
    (await readFile(".env", "utf8")).match(/^VITE_SUPABASE_URL=["']?([^\s"']+)/m)[1],
  base,
);
// TanStack emits both SSR wrappers and server implementations; filesystem/hash
// ordering must not decide which one the test reads. Require one unique real ID.
async function serverFunctionId(name, prefix) {
  const values = new Set();
  for (const file of (await readdir(".output/server/_ssr")).filter((file) =>
    file.startsWith(prefix),
  )) {
    const code = await readFile(".output/server/_ssr/" + file, "utf8");
    const pattern = new RegExp(
      "id:\\s*[\"'`]([a-f0-9]+)[\"'`],\\s*name:\\s*[\"'`]" + name + "[\"'`]",
      "g",
    );
    for (const match of code.matchAll(pattern)) values.add(match[1]);
  }
  assert.equal(values.size, 1, "Expected one compiled server function: " + name);
  return [...values][0];
}
const statusId = await serverFunctionId("deepgramPilotStatus", "deepgram-pilot.functions-"),
  catalogId = await serverFunctionId("deepgramPilotCatalog", "deepgram-pilot.functions-"),
  cashId = await serverFunctionId("getCashReport", "cash-sessions.functions-"),
  historyId = await serverFunctionId("getMemberOrderHistory", "member-order-history.functions-"),
  collaboratorListId = await serverFunctionId("listCollaborators", "platform.functions-"),
  walletStatusId = await serverFunctionId("walletMemberStatus", "wallet-management.functions-");
const accessSettingsId = await serverFunctionId(
    "getClubAccessControl",
    "club-access-control.functions-",
  ),
  mermaSettingsId = await serverFunctionId("getClubMermaSettings", "club-merma.functions-");
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
const browserResults = [];
for (const [label, engine, device] of [
  ["samsung", chromium, devices["Galaxy S9+"]],
  ["iphone-webkit", webkit, devices["iPhone 13"]],
  ["desktop-chromium", chromium, { viewport: { width: 1440, height: 1000 } }],
  ["tablet-webkit", webkit, devices["iPad Pro 11"]],
].filter(([label]) => !process.argv.includes("--desktop") || label === "desktop-chromium")) {
  const browser = await engine.launch({
    headless: true,
    ...(engine === chromium
      ? {
          executablePath: existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined,
          args: ["--no-sandbox"],
        }
      : process.env.TEST_WEBKIT_EXECUTABLE_PATH
        ? { executablePath: process.env.TEST_WEBKIT_EXECUTABLE_PATH }
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
      actionReceipts = [],
      stops = 0;
    const unexpected = [];
    const extraExecutions = new Set();
    const receiptExecutions = new Set();
    let executionConfirms = 0,
      executionChecks = 0,
      executionCancels = 0,
      executionRecoveries = 0;
    const recoveredExecutionId = crypto.randomUUID();
    const reloadExecutionId = crypto.randomUUID();
    let capturedInputBytes = 0,
      capturedInputSignal = false;
    let firstReady, subsequentReady;
    const readyFirst = new Promise((resolve) => {
      firstReady = resolve;
    });
    await context.addInitScript(
      ({ auth, key, pendingResume, nativeAudio }) => {
        localStorage.setItem(key, JSON.stringify(auth));
        window.__audio = {
          started: 0,
          stopped: 0,
          played: 0,
          interrupted: 0,
          worklet: null,
          suspendDuringStart: !pendingResume,
          pendingResume,
          nonzero: 0,
        };
        if (nativeAudio) {
          const NativeAudioContext = window.AudioContext;
          window.AudioContext = class extends NativeAudioContext {
            constructor(options) {
              super(options);
              window.__audio.context = this;
            }
            createBufferSource() {
              const source = super.createBufferSource();
              const connect = source.connect.bind(source),
                start = source.start.bind(source);
              source.connect = (target, ...args) => {
                if (target === this.destination) {
                  const tap = this.createAnalyser();
                  tap.fftSize = 256;
                  connect(tap);
                  tap.connect(target);
                  const samples = new Float32Array(tap.fftSize);
                  const timer = setInterval(() => {
                    tap.getFloatTimeDomainData(samples);
                    const rms = Math.sqrt(
                      samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
                    );
                    window.__audio.outputRms = Math.max(window.__audio.outputRms || 0, rms);
                  }, 5);
                  source.addEventListener("ended", () => clearInterval(timer), { once: true });
                  return target;
                }
                return connect(target, ...args);
              };
              source.start = (...args) => {
                window.__audio.played++;
                return start(...args);
              };
              return source;
            }
          };
          Object.defineProperty(navigator, "mediaDevices", {
            configurable: true,
            value: {
              async getUserMedia() {
                window.__audio.started++;
                const ctx = window.__audio.context,
                  osc = ctx.createOscillator(),
                  gain = ctx.createGain(),
                  media = ctx.createMediaStreamDestination();
                osc.frequency.value = 440;
                gain.gain.value = 0.2;
                osc.connect(gain);
                gain.connect(media);
                osc.start();
                window.__audio.stream = media.stream;
                const track = media.stream.getAudioTracks()[0],
                  stop = track.stop.bind(track);
                track.stop = () => {
                  window.__audio.stopped++;
                  osc.stop();
                  stop();
                };
                return media.stream;
              },
            },
          });
          return; // Keep the browser's actual AudioWorklet and Web Audio implementation.
        }
        const track = {
          readyState: "live",
          muted: false,
          stop() {
            this.readyState = "ended";
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
              track.readyState = "live";
              window.__audio.started++;
              window.__audio.unlockResume?.();
              if (window.__audio.hold)
                await new Promise((r) => {
                  window.__audio.release = r;
                });
              if (window.__audio.suspendDuringStart) {
                window.__audio.suspendDuringStart = false;
                window.__audio.context.state = "interrupted";
              }
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
            window.__audio.context = this;
            this.state = pendingResume ? "suspended" : "running";
            this.sampleRate = 48000;
            this.currentTime = 1;
            this.destination = new Node();
            this.audioWorklet = { addModule: async () => {} };
          }
          async resume() {
            if (window.__audio.pendingResume && window.__audio.started === 0)
              await new Promise((resolve) => {
                window.__audio.unlockResume = resolve;
              });
            this.state = "running";
            this.onstatechange?.();
          }
          async close() {}
          createMediaStreamSource() {
            return new Node();
          }
          createGain() {
            return Object.assign(new Node(), { gain: { value: 0 } });
          }
          createBuffer(ch, len, rate) {
            const samples = new Float32Array(len);
            return { duration: len / rate, getChannelData: () => samples };
          }
          createBufferSource() {
            return Object.assign(new Node(), {
              start() {
                if (this.buffer?.getChannelData(0).some((value) => value !== 0))
                  window.__audio.nonzero++;
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
            this.timer = setInterval(() => {
              if (window.__audio.context.state === "running")
                this.port.onmessage?.({ data: new ArrayBuffer(4096) });
            }, 43);
          }
          disconnect() {
            clearInterval(this.timer);
          }
        };
      },
      { auth, key: `sb-${api.hostname.split(".")[0]}-auth-token`, pendingResume, nativeAudio },
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
      if (u.pathname.endsWith("/" + cashId)) {
        const data = fromJSON(JSON.parse(req.postData())).data;
        const day = data.day ?? "2026-10-25";
        return json({
          result: {
            day,
            admin: true,
            start: "2026-10-24T22:00:00.000Z",
            end: "2026-10-25T23:00:00.000Z",
            movements: [],
            sessions: [],
            profiles: [],
            refunds: [],
            auditRecords: [],
          },
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
        if (u.pathname.endsWith("/club_member_field_config")) {
          assert.equal(u.searchParams.get("club_id"), "eq." + club);
          data = [
            { field_key: "address", visible: true, required: false },
            { field_key: "postal_code", visible: true, required: false },
          ];
        }
        if (u.pathname.endsWith("/membership_plans")) {
          // Registration adds an explicit club filter. Existing member-card and
          // fee-settings queries select * under the authenticated RLS session.
          if (u.searchParams.get("select") === "id,name,duration_days,price_cents")
            assert.equal(u.searchParams.get("club_id"), "eq." + club);
          else assert.equal(u.searchParams.get("select"), "*");
          assert.equal(req.headers().authorization, "Bearer " + auth.access_token);
          data = [
            {
              id: "60000000-0000-4000-8000-000000000001",
              name: "Semestral sintética",
              duration_days: 180,
              price_cents: 3000,
            },
          ];
        }
        if (u.pathname.endsWith("/member_discounts"))
          data = [
            {
              id: "50000000-0000-4000-8000-000000000001",
              name: "Descuento sintético",
              percentage_basis_points: 1000,
              active: true,
              valid_from: null,
              valid_until: null,
            },
          ];
        if (u.pathname.endsWith("/member_discount_assignments")) data = { discount_id: null };
        if (u.pathname.endsWith("/members")) {
          const member = {
            id: club,
            club_id: club,
            member_number: "1042",
            first_name: "Marco",
            last_name: "Rossi",
            birth_date: "1995-03-12",
            city: "Palma",
            phone: null,
            email: null,
            dni_number: "SYNTHETIC",
            joined_at: "2026-01-01",
            expires_at: "2030-01-01",
            plan_id: null,
          };
          data = u.searchParams.get("id") ? member : [member];
        }
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
      if (u.pathname.includes(collaboratorListId)) return json({ result: [], context: {} });
      if (u.pathname.includes(walletStatusId))
        return json({
          result: { enabled: true, clubEnabled: true, balanceCents: 12345, cashSessionId: club },
          context: {},
        });
      if (u.pathname.includes(historyId))
        return json({ result: { orders: [], ownOnly: false, hasMore: false }, context: {} });
      if (u.pathname.includes(accessSettingsId))
        return json({ result: { enabled: false }, context: {} });
      if (u.pathname.includes(mermaSettingsId))
        return json({ result: { maxMermaPerGram: 0.1 }, context: {} });
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
        if (typeof message !== "string") {
          capturedInputBytes += message.byteLength;
          const pcm = Buffer.from(message);
          for (let i = 0; i + 1 < pcm.length; i += 2)
            if (Math.abs(pcm.readInt16LE(i)) > 16) {
              capturedInputSignal = true;
              break;
            }
          return;
        }
        const m = JSON.parse(message);
        if (executionUI && m.type === "AppExecutionRecover") {
          executionRecoveries++;
          assert([recoveredExecutionId, reloadExecutionId].includes(m.id));
          assert.equal(
            executionConfirms,
            m.id === recoveredExecutionId ? 7 : 8,
            "Recovery must never confirm a write automatically",
          );
          extraExecutions.add(m.id);
          peer.send(
            JSON.stringify({
              type: "AppExecutionPrepared",
              id: m.id,
              token: uid,
              action: "category.create",
              summary: {
                label: "Recovered synthetic proposal",
                changes: { name: "Recovered category" },
              },
            }),
          );
          return;
        }
        if (executionUI && m.type === "AppExecutionConfirm") {
          executionConfirms++;
          assert.equal(m.confirmed, true);
          if (receiptExecutions.has(m.id)) assert.equal(m.receiptConfirmed, true);
          assert([club, secondExecutionId].includes(m.id) || extraExecutions.has(m.id));
          assert.equal(m.token, uid);
          peer.send(
            JSON.stringify({
              type: "AppExecutionResult",
              id: m.id,
              status: m.id === club ? "uncertain" : "completed",
            }),
          );
          return;
        }
        if (executionUI && m.type === "AppExecutionCancel") {
          executionCancels++;
          assert.equal(m.id, thirdExecutionId);
          assert.equal(m.token, uid);
          peer.send(JSON.stringify({ type: "AppExecutionResult", id: m.id, status: "cancelled" }));
          return;
        }
        if (executionUI && m.type === "AppExecutionCheck") {
          executionChecks++;
          assert.equal(m.id, club);
          peer.send(
            JSON.stringify({
              type: "AppExecutionResult",
              id: club,
              status: "completed",
              enabled: false,
            }),
          );
          return;
        }
        if (m.type === "AppActionResult") {
          assert.equal(typeof m.id, "string");
          assert.notEqual(m.status, "completed");
          actionReceipts.push(m);
          return;
        }
        assert.equal(m.type, "AppStart");
        assert.equal(m.token, auth.access_token);
        assert.equal(m.consent, true);
        assert.equal(m.synthetic, true);
        ws.send(JSON.stringify({ type: "AppReady" }));
        firstReady();
        subsequentReady?.();
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/productos", { waitUntil: "domcontentloaded" });
    console.log(label + ": loaded");
    await page
      .getByRole("heading", { name: "Productos", exact: true })
      .waitFor()
      .catch(async (e) => {
        console.error("Synthetic page state:", await page.locator("body").innerText());
        throw e;
      });
    // One normal dock click, also valid if the asynchronous provider check is still pending.
    const voiceEntry = page.getByRole("button", { name: "SNOOP", exact: true });
    assert.equal(await voiceEntry.count(), 1, "One voice entry per viewport");
    if (label === "desktop-chromium") {
      await voiceEntry.waitFor();
      const box = await voiceEntry.boundingBox();
      assert(
        box && box.x >= 0 && box.x + box.width <= 248,
        "Desktop voice control stays in the existing rail, outside forms",
      );
    }
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "No horizontal overflow",
    );
    await voiceEntry.click();
    const panel = page.getByRole("dialog", { name: "SNOOP JARVIS 3" });
    await panel.waitFor();
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Avvia JARVIS", exact: true }).click();
    if (pendingResume)
      await page.waitForFunction(() => window.__audio.started === 1, {}, { timeout: 4000 });
    let readyDeadline;
    try {
      await Promise.race([
        readyFirst,
        new Promise((_, reject) => {
          readyDeadline = setTimeout(
            () => reject(Error("Synthetic provider did not become ready")),
            20000,
          );
        }),
      ]);
    } finally {
      clearTimeout(readyDeadline);
    }
    if (executionUI) {
      peer.send(
        JSON.stringify({ type: "AppExecutionPrepared", id: club, token: uid, enabled: false }),
      );
      await panel.getByRole("button", { name: "Conferma modifica", exact: true }).click();
      await panel.getByRole("button", { name: "Verifica esito", exact: true }).click();
      await panel
        .getByRole("status")
        .filter({ hasText: "Operazione completata e verificata dal server." })
        .waitFor();
      peer.send(
        JSON.stringify({
          type: "AppPrivateRecords",
          kind: "members",
          rows: [{ ref: "record-1", first_name: "Ana", last_name: "Synthetic" }],
        }),
      );
      await panel
        .locator('[aria-label="Registros autorizados"]')
        .getByText("1. Ana Synthetic", { exact: true })
        .waitFor();
      peer.send(
        JSON.stringify({
          type: "AppExecutionPrepared",
          id: secondExecutionId,
          token: uid,
          action: "member.renew",
          summary: {
            label: "Renovar cuota",
            member_name: "Ana Synthetic",
            plan: "Synthetic fee",
            amount_cents: 1000,
            method: "cash",
          },
        }),
      );
      const review = panel.locator('[aria-label="Conferma operazione"]');
      await review.getByText("Ana Synthetic", { exact: true }).waitFor();
      assert((await review.innerText()).includes("10,00"));
      assert((await review.innerText()).includes("Efectivo"));
      await review.getByRole("button", { name: "Conferma modifica", exact: true }).click();
      await review.waitFor({ state: "hidden" });
      peer.send(
        JSON.stringify({
          type: "AppExecutionPrepared",
          id: thirdExecutionId,
          token: uid,
          action: "category.update",
          summary: {
            label: "Actualizar categoría",
            name: "Synthetic",
            changes: { name: "Cancelled name", archived: true },
          },
        }),
      );
      await panel.getByRole("button", { name: "Annulla proposta", exact: true }).click();
      await review.waitFor({ state: "hidden" });
      for (const [action, title, changes, expected] of [
        [
          "product.create",
          "Crear ficha",
          { name: "Synthetic Binder", buy_price: 420, sell_price: 1350 },
          ["4,20", "13,50"],
        ],
        ["cash.open", "Abrir caja", { opening_cash_cents: 5000 }, ["50,00"]],
        [
          "cash.close",
          "Cerrar caja",
          { closing_cash_cents: 4950, notes: "Synthetic cash count" },
          ["49,50", "Synthetic cash count"],
        ],
        ["discount.create", "Crear descuento", { percentage_basis_points: 1250 }, ["12,5"]],
        ["wallet.topup", "Recarga de créditos", { amount_cents: 1250, method: "cash" }, ["12,50"]],
      ]) {
        const id = crypto.randomUUID();
        extraExecutions.add(id);
        if (action === "wallet.topup") receiptExecutions.add(id);
        peer.send(
          JSON.stringify({
            type: "AppExecutionPrepared",
            id,
            token: uid,
            action,
            summary: {
              label: title,
              changes,
              ...(action === "wallet.topup"
                ? { attestation: "Confirmo el cobro de la recarga." }
                : {}),
            },
          }),
        );
        await review.getByText(title, { exact: true }).waitFor();
        const text = await review.innerText();
        for (const value of expected)
          assert(text.includes(value), title + " must display " + value);
        assert(!text.includes(id), "Never display an internal UUID as an operation label");
        await page.screenshot({
          path: `.sandbox/deepgram/${label}-${action}-confirmation.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (action === "wallet.topup") {
          assert(
            await review
              .getByRole("button", { name: "Conferma modifica", exact: true })
              .isDisabled(),
          );
          await review.getByRole("checkbox", { name: "Confirmo el cobro de la recarga." }).check();
        }
        await review.getByRole("button", { name: "Conferma modifica", exact: true }).click();
        await review.waitFor({ state: "hidden" });
      }
      peer.send(
        JSON.stringify({ type: "AppExecutionRejected", code: "VOICE_HUMAN_DOCUMENTS_REQUIRED" }),
      );
      await panel.getByRole("status").filter({ hasText: "Completa documento y firma" }).waitFor();
      assert.equal(executionCancels, 1);
      assert.equal(writes, 0);
      peer.send(
        JSON.stringify({
          type: "AppExecutionPrepared",
          id: recoveredExecutionId,
          token: uid,
          action: "category.create",
          summary: {
            label: "Recovered synthetic proposal",
            changes: { name: "Recovered category" },
          },
        }),
      );
      await review.getByText("Recovered synthetic proposal", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Chiudi assistente", exact: true }).click();
      assert.equal(executionConfirms, 7);
      await voiceEntry.click();
      await panel.waitFor();
      await panel.getByRole("button", { name: "Avvia JARVIS", exact: true }).click();
      await review.getByText("Recovered synthetic proposal", { exact: true }).waitFor();
      assert.equal(executionRecoveries, 1);
      assert.equal(executionConfirms, 7);
      await review.getByRole("button", { name: "Conferma modifica", exact: true }).click();
      await review.waitFor({ state: "hidden" });
      assert.equal(executionConfirms, 8);
      assert.equal(
        await page.evaluate(
          () =>
            Object.keys(sessionStorage).filter((k) => k.startsWith("snoop:voice-pending:")).length,
        ),
        0,
      );
      await panel.getByRole("button", { name: "Chiudi assistente", exact: true }).click();
      assert.equal(executionChecks, 1);
      // An actual committed outbox request is not an email-delivery receipt.
      await voiceEntry.click();
      await panel.waitFor();
      let subsequentDeadline;
      const readyThird = new Promise((resolve, reject) => {
        subsequentReady = resolve;
        subsequentDeadline = setTimeout(
          () => reject(Error("Third voice session did not become ready")),
          20000,
        );
      });
      try {
        await panel.getByRole("button", { name: "Avvia JARVIS", exact: true }).click();
        await readyThird;
      } finally {
        clearTimeout(subsequentDeadline);
      }
      assert.equal(await page.evaluate(() => window.__audio.started), 3);
      peer.send(
        JSON.stringify({
          type: "AppExecutionResult",
          id: crypto.randomUUID(),
          status: "completed",
          action: "member.mail.request",
          mailStatus: "pending",
        }),
      );
      await panel.getByRole("status").filter({ hasText: "Pendiente de envío" }).waitFor();
      peer.send(
        JSON.stringify({
          type: "AppExecutionPrepared",
          id: reloadExecutionId,
          token: uid,
          action: "category.create",
          summary: {
            label: "Recovered synthetic proposal",
            changes: { name: "Reloaded category" },
          },
        }),
      );
      await review.getByText("Recovered synthetic proposal", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Chiudi assistente", exact: true }).click();
      await page.waitForLoadState("networkidle");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Productos", exact: true }).waitFor();
      await voiceEntry.click();
      await panel.getByRole("checkbox").check();
      await panel.getByRole("button", { name: "Avvia JARVIS", exact: true }).click();
      await review.getByText("Recovered synthetic proposal", { exact: true }).waitFor();
      assert.equal(executionRecoveries, 2);
      assert.equal(executionConfirms, 8, "Reload must not repeat a persistent write");
      await review.getByRole("button", { name: "Conferma modifica", exact: true }).click();
      await review.waitFor({ state: "hidden" });
      assert.equal(executionConfirms, 9);
      await panel.getByRole("button", { name: "Chiudi assistente", exact: true }).click();
      assert.deepEqual(errors, []);
      browserResults.push({
        browser: label,
        scenario: "execution-confirmation",
        confirmationRequests: executionConfirms,
        recoveredProposals: executionRecoveries,
        statusReads: executionChecks,
        syntheticGateway: true,
        persistenceTestedSeparately: true,
        physicalDevice: false,
        result: "PASS",
      });
      console.log(
        "PASS " +
          label +
          ": explicit confirmation and uncertain-result reconciliation UI (synthetic gateway; persistence tested separately in PostgreSQL)",
      );
      await context.close();
      continue;
    }
    if (startupOnly) {
      assert.equal(await page.evaluate(() => window.__audio.started), 1);
      for (let n = 0; n < 40 && !capturedInputBytes; n++) await page.waitForTimeout(25);
      assert(
        capturedInputBytes > 0,
        "Microphone PCM must reach the socket before a reply is accepted",
      );
      peer.send(JSON.stringify({ type: "AgentStartedSpeaking" }));
      const tone = Buffer.alloc(24000);
      for (let i = 0; i < tone.length; i += 2)
        tone.writeInt16LE(Math.round(8192 * Math.sin((2 * Math.PI * 440 * i) / 2 / 24000)), i);
      peer.send(tone);
      await page.waitForFunction(
        nativeAudio ? () => window.__audio.outputRms > 0.05 : () => window.__audio.nonzero > 0,
      );
      await panel.getByRole("button", { name: "Chiudi assistente", exact: true }).click();
      assert.equal(sockets, 1);
      assert.equal(writes, 0);
      if (nativeAudio)
        await page.waitForFunction(
          () =>
            window.__audio.stream.getTracks().every((track) => track.readyState === "ended") &&
            window.__audio.context.state === "closed",
        );
      else assert.equal(await page.evaluate(() => window.__audio.stopped), 1);
      console.log(
        "PASS " +
          label +
          (nativeAudio
            ? ": actual capture PCM reaches WebSocket and returned PCM produces a measured output signal (synthetic stream/provider, no physical microphone or speaker)"
            : ": pending audio activation never blocks microphone consent; output and stop recover (simulated device/provider)"),
      );
      if (nativeAudio)
        assert(
          capturedInputSignal,
          "Actual capture PCM must contain the synthetic microphone signal, not just silent buffers",
        );
      browserResults.push({
        browser: label,
        scenario: nativeAudio ? "native-duplex" : "pending-resume",
        syntheticAuth: true,
        syntheticProvider: true,
        syntheticMediaStream: nativeAudio,
        physicalMicrophone: false,
        physicalSpeaker: false,
        liveDeepgram: false,
        inputBytes: capturedInputBytes,
        inputSignal: capturedInputSignal,
        outputRms: nativeAudio ? await page.evaluate(() => window.__audio.outputRms) : null,
        automaticWrites: writes,
        result: "PASS",
      });
      await context.close();
      continue;
    }
    // The context was interrupted during getUserMedia, before audio.current existed.
    // Old code misses that event and never offers recovery despite a ready socket.
    await panel.getByRole("button", { name: "Riattiva audio", exact: true }).waitFor();
    peer.send(JSON.stringify({ type: "AgentStartedSpeaking" }));
    const audiblePcm = Buffer.alloc(4800);
    for (let i = 0; i < audiblePcm.length; i += 2) audiblePcm.writeInt16LE(8192, i);
    peer.send(audiblePcm);
    await panel.getByRole("button", { name: "Dettagli SNOOP" }).click();
    await panel.locator("summary").filter({ hasText: "Diagnostica audio privata" }).click();
    let metadata;
    for (let attempt = 0; attempt < 20; attempt++) {
      await panel.getByRole("button", { name: "Aggiorna diagnostica audio" }).click();
      metadata = JSON.parse(await panel.locator("pre").innerText());
      if (metadata.bufferedSamples === 2400) break;
      await page.waitForTimeout(25);
    }
    assert.equal(metadata.bufferedSamples, 2400);
    assert.equal(metadata.scheduledSamples, 0);
    assert.equal(
      await page.evaluate(() => window.__audio.played),
      0,
      "Suspended context must not claim playback",
    );
    await panel.getByRole("button", { name: "Riattiva audio", exact: true }).click();
    await page.waitForFunction(() => window.__audio.played > 0 && window.__audio.nonzero > 0);
    await panel.getByRole("button", { name: "Riduci SNOOP" }).click();
    assert(
      (await panel.boundingBox()).height < 220,
      "active voice must leave the actual form visible",
    );
    assert.equal(sockets, 1);
    assert.equal(catalogCalls, 1);
    assert.equal(statusCalls, 1);
    // A valid next response need not include AgentThinking. Interrupting an old
    // answer must not permanently mute future Deepgram audio.
    peer.send(JSON.stringify({ type: "UserStartedSpeaking" }));
    peer.send(JSON.stringify({ type: "AgentStartedSpeaking" }));
    peer.send(Buffer.alloc(4800));
    await page.waitForFunction(() => window.__audio.played > 0);
    await page.evaluate(() => {
      window.__audio.context.state = "suspended";
      window.__audio.context.onstatechange?.();
    });
    await panel.getByRole("button", { name: "Riattiva audio", exact: true }).click();
    await page.waitForFunction(() => window.__audio.context.state === "running");
    const send = async (p, extra = {}) => {
      const actionId = "action-" + crypto.randomUUID();
      peer.send(JSON.stringify({ type: "UserStartedSpeaking" }));
      peer.send(JSON.stringify({ type: "AgentThinking" }));
      peer.send(
        JSON.stringify({
          type: "AppProposal",
          id: actionId,
          result: { ok: true, proposal: p },
          ...extra,
        }),
      );
      if (p.intent === "stop") return;
      // The real provider waits for FunctionCallResponse. Do not inject a second
      // command while the preceding application action is still being acknowledged.
      for (let attempt = 0; attempt < 300; attempt++) {
        const result = actionReceipts.find((receipt) => receipt.id === actionId);
        if (result) return result;
        await page.waitForTimeout(20);
      }
      throw Error("Application did not acknowledge synthetic action " + p.intent);
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
    await send(
      proposal("member", "member_create", { member: { email: "synthetic.member@example.test" } }),
    );
    await page.getByLabel("Email", { exact: true }).waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some(
        (i) => i.value === "synthetic.member@example.test",
      ),
    );
    await page.getByLabel("Email", { exact: true }).fill("manual@example.test");
    await send(proposal("member", "member_create", { member: { email: "other@example.test" } }));
    assert.equal(
      await page.getByLabel("Email", { exact: true }).inputValue(),
      "manual@example.test",
    );
    await send(
      proposal("member", "member_create", {
        member: {
          address: "Calle Sintética 12",
          postal_code: "07001",
          plan_name: "Semestral sintética",
        },
      }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some((i) => i.value === "Calle Sintética 12"),
    );
    assert.equal(await page.getByLabel("Código postal", { exact: true }).inputValue(), "07001");
    assert.equal(
      await page.getByRole("button", { name: /Semestral sintética/ }).getAttribute("aria-pressed"),
      "true",
    );
    const invalidFee = await send(
      proposal("member", "member_create", {
        member: { city: "No aplicar", plan_name: "Cuota inexistente" },
      }),
    );
    assert.equal(invalidFee.status, "rejected");
    assert.equal(invalidFee.code, "REFERENCE_NOT_FOUND");
    assert.equal(await page.getByLabel("Ciudad *", { exact: true }).inputValue(), "Palma");
    await page.getByLabel("Dirección", { exact: true }).fill("Dirección manual");
    await send(proposal("member", "member_create", { member: { address: "Dirección tardía" } }));
    assert.equal(
      await page.getByLabel("Dirección", { exact: true }).inputValue(),
      "Dirección manual",
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

    await send(proposal("search", "members", { query: "Marco Rossi" }));
    await page.getByRole("heading", { name: "Marco Rossi", exact: true }).waitFor();
    await send(proposal("member_edit", null, { member: { last_name: "Bianchi", city: "Inca" } }));
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some((i) => i.value === "Bianchi"),
    );
    assert.equal(await page.getByLabel("Nombre", { exact: true }).inputValue(), "Marco");
    assert.equal(await page.getByLabel("Ciudad", { exact: true }).inputValue(), "Inca");
    await page.getByLabel("Apellido", { exact: true }).fill("Manual");
    await send(proposal("member_edit", null, { member: { last_name: "Modelo", city: "Madrid" } }));
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some((i) => i.value === "Madrid"),
    );
    assert.equal(await page.getByLabel("Apellido", { exact: true }).inputValue(), "Manual");
    assert.equal(writes, 0, "member correction is a draft, never a hidden update");
    await page.getByRole("button", { name: "Hacer pedido", exact: true }).click();
    await page.getByRole("heading", { name: "Nuevo pedido", exact: true }).waitFor();
    await send(proposal("member_edit", null, { member: { last_name: "Hidden" } }));
    await page.waitForFunction(() =>
      document.body.innerText.includes("Apri la scheda del socio prima di modificarla"),
    );
    assert.equal(writes, 0, "hidden parent editor cannot write from the nested order route");
    await page.getByRole("link", { name: "Cancelar borrador", exact: true }).click();
    await page.getByRole("heading", { name: "Marco Rossi", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Apellido", { exact: true }).inputValue(), "Manual");
    for (const section of ["qr", "discounts", "renewal", "history"])
      await send(proposal("member_section", null, { query: section }));
    await page.getByText("Sin registros visibles.", { exact: true }).waitFor();
    assert.equal(writes, 0, "opening renewal/history never charges or writes");
    await send(
      proposal("administrative_draft", null, {
        form: { kind: "member_discount", fields: { discount_name: "Descuento inexistente" } },
      }),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("Impossibile preparare il modulo"),
    );
    assert.equal(await page.getByLabel("Descuento asignado", { exact: true }).inputValue(), "");
    await send(
      proposal("administrative_draft", null, {
        form: { kind: "member_discount", fields: { discount_name: "Descuento sintético" } },
      }),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('select[aria-label="Descuento asignado"]')?.value ===
        "50000000-0000-4000-8000-000000000001",
    );
    if (process.env.TEST_WALLET_ENABLED === "true") {
      const wallet = page.getByLabel("Monedero del socio", { exact: true });
      await wallet.waitFor();
      await send(
        proposal("administrative_draft", null, {
          form: { kind: "wallet_topup", fields: { amount: "25,50" } },
        }),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("input")].some((input) => input.value === "25,50"),
      );
      assert.equal(await wallet.getByRole("checkbox").isChecked(), false);
      await wallet.getByRole("checkbox").check();
      await send(
        proposal("administrative_draft", null, {
          form: { kind: "wallet_topup", fields: { amount: "30,25" } },
        }),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("input")].some((input) => input.value === "30,25"),
      );
      assert.equal(
        await wallet.getByRole("checkbox").isChecked(),
        false,
        "changed voice amount must revoke prior confirmation",
      );
      assert.equal(writes, 0, "wallet preparation never calls topup or activation");
      await page.screenshot({
        path: ".sandbox/deepgram/" + label + "-wallet-draft.png",
        fullPage: false,
      });
    }

    await page.screenshot({
      path: ".sandbox/deepgram/" + label + "-member-edit.png",
      fullPage: true,
    });
    await send(proposal("navigate", "profile"));
    await page.getByRole("heading", { name: "Mi perfil", exact: true }).waitFor();
    assert.equal(sockets, 1, "profile navigation must preserve the voice session");
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click({ trial: true });
    await send(proposal("navigate", "cash_report"), { cashDay: "2026-10-25" });
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="Fecha del informe"]')?.value === "2026-10-25",
    );
    assert.equal(sockets, 1, "dated report must retain the same voice session");
    await send(proposal("cash_draft", "cash", { cash: { opening_cash: "50,25" } }));
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="Dinero inicial (€)"]')?.value === "50,25",
    );
    await page.getByLabel("Dinero inicial (€)", { exact: true }).fill("75");
    await send(proposal("cash_draft", "cash", { cash: { opening_cash: "60" } }));
    await page.waitForFunction(() =>
      document.body.innerText.includes("Conservo le modifiche manuali"),
    );
    assert.equal(await page.getByLabel("Dinero inicial (€)", { exact: true }).inputValue(), "75");
    assert.equal(writes, 0, "cash draft must never open a session automatically");
    await send(proposal("review", null));
    await page.waitForFunction(() =>
      document.body.innerText.includes("Rivedi i dati e conferma dal modulo"),
    );
    assert(
      actionReceipts.some(
        (receipt) =>
          receipt.status === "confirmation_required" && receipt.code === "CONFIRMATION_REQUIRED",
      ),
    );
    assert.equal(writes, 0, "review requires explicit manual confirmation and never saves");
    peer.send(
      JSON.stringify({
        type: "AppCashPeriodResult",
        summary: { from: "2026-10-24", to: "2026-10-25", cents: 1750, scope: "club" },
      }),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("2026-10-24 – 2026-10-25: 17.50 €"),
    );
    peer.send(
      JSON.stringify({
        type: "AppGeneticsResult",
        name: "Amnesia Haze",
        verified: true,
        sources: [
          "https://www.leafly.com/strains/amnesia-haze",
          "javascript:alert(1)",
          "https://untrusted.invalid/steal",
          "https://www.leafly.com/shop/amnesia-haze",
        ],
      }),
    );
    await panel.getByRole("button", { name: "Dettagli SNOOP", exact: true }).click();
    await panel.locator("summary").filter({ hasText: "Fuentes" }).click();
    assert.equal(
      await panel.locator("a").count(),
      1,
      "only verified informational citations may be linked",
    );
    assert.equal(
      await panel.locator("a").getAttribute("href"),
      "https://www.leafly.com/strains/amnesia-haze",
    );
    await panel.locator("summary").filter({ hasText: "Fuentes" }).click();
    await panel.getByRole("button", { name: "Riduci SNOOP", exact: true }).click();
    await send(
      proposal("administrative_draft", "collaborators", {
        form: {
          kind: "collaborator_invite",
          fields: { first_name: "Ana", last_name: "Prueba", email: "synthetic@example.test" },
        },
      }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some(
        (input) => input.value === "synthetic@example.test",
      ),
    );
    await page.getByLabel("Apellidos", { exact: true }).fill("Manual");
    await send(
      proposal("administrative_draft", "collaborators", {
        form: { kind: "collaborator_invite", fields: { last_name: "Modelo" } },
      }),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("Conservo le modifiche manuali"),
    );
    assert.equal(await page.getByLabel("Apellidos", { exact: true }).inputValue(), "Manual");
    for (let round = 0; round < 4; round++) {
      await send(
        proposal("administrative_draft", "membership_fees", {
          form: {
            kind: "membership_fee",
            fields: { name: "Cuota sintética", duration_days: "180", price: "30,25" },
          },
        }),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("input")].some((input) => input.value === "30.25"),
      );
      await send(
        proposal("administrative_draft", "membership_fees", {
          form: { kind: "membership_fee", fields: { price: "32,50" } },
        }),
      );
      await page.waitForFunction(() =>
        [...document.querySelectorAll("input")].some((input) => input.value === "32.5"),
      );
      await send(
        proposal("administrative_draft", "membership_fees", {
          form: { kind: "membership_fee", fields: { price: "33,50" } },
        }),
      );
      await page
        .waitForFunction(() =>
          [...document.querySelectorAll("input")].some((input) => input.value === "33.5"),
        )
        .catch(async (error) => {
          console.error(
            "Fee correction metadata",
            JSON.stringify({
              browser: label,
              round,
              receipts: actionReceipts
                .slice(-4)
                .map(({ status, code, applied, skipped }) => ({ status, code, applied, skipped })),
            }),
          );
          await page.screenshot({ path: ".sandbox/deepgram/" + label + "-fee-failure.png" });
          throw error;
        });
      await page.getByRole("button", { name: "Guardar", exact: true }).click({ trial: true });
      assert(
        (await panel.boundingBox()).height <= 120,
        "active voice must stay compact above the form",
      );
      if (round < 3) await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    }
    await page.screenshot({
      path: ".sandbox/deepgram/" + label + "-fee-draft.png",
      fullPage: false,
    });
    await page.getByLabel("Precio (€)", { exact: true }).fill("45.75");
    await send(
      proposal("administrative_draft", "membership_fees", {
        form: { kind: "membership_fee", fields: { price: "40,50" } },
      }),
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("Conservo le modifiche manuali"),
    );
    assert.equal(await page.getByLabel("Precio (€)", { exact: true }).inputValue(), "45.75");
    assert.equal(writes, 0, "consecutive corrections must never save a fee");
    await send(
      proposal("administrative_draft", "general_settings", {
        form: {
          kind: "discount",
          fields: {
            name: "Descuento de prueba",
            percentage: "12,50",
            valid_from: "2026-11-18",
            valid_until: "2026-12-31",
          },
        },
      }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some(
        (input) => input.value === "Descuento de prueba",
      ),
    );
    await send(
      proposal("administrative_draft", "general_settings", {
        form: { kind: "discount", fields: { percentage: "15,25" } },
      }),
    );
    await page.waitForFunction(() =>
      [...document.querySelectorAll("input")].some((input) => input.value === "15,25"),
    );
    assert.equal(
      writes,
      0,
      "administrative drafts must not invite, save fees, assign discounts or top up",
    );
    await page.screenshot({
      path: ".sandbox/deepgram/" + label + "-discount-draft.png",
      fullPage: false,
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
    assert.equal(await page.getByLabel("Categoría", { exact: true }).inputValue(), club);
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
    assert(
      actionReceipts.some((r) => r.applied.includes("first_name")),
      "application must acknowledge the actual patched fields",
    );
    assert(
      actionReceipts.some((r) => r.skipped.includes("last_name")),
      "manual edits must be reported as preserved",
    );
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
    console.log(label + ": drafts and audio passed; checking provider failure");
    await page.evaluate(() => {
      window.__audio.hold = true;
    });
    await page.getByRole("button", { name: "SNOOP", exact: true }).click();
    await panel.getByRole("button", { name: "Avvia JARVIS", exact: true }).click();
    await page.waitForFunction(() => !!window.__audio.release);
    await page.getByRole("button", { name: "SNOOP", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    await page.evaluate(() => window.__audio.release());
    await page.waitForFunction(() => window.__audio.stopped === 2);
    assert.equal(sockets, 1, "closing during pending microphone permission must not connect later");
    unavailable = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Productos", exact: true })
      .waitFor()
      .catch(async (e) => {
        console.error("Synthetic page state:", await page.locator("body").innerText());
        throw e;
      });
    await page.getByRole("button", { name: "SNOOP", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "No se pudo verificar el asistente" })
      .waitFor();
    assert.equal(await page.getByRole("dialog", { name: "SNOOP", exact: true }).count(), 0);
    assert.equal(await page.getByRole("dialog", { name: "SNOOP JARVIS 3" }).count(), 0);
    assert.equal(sockets, 1, "failed verification must never open a provider session");
    console.log(label + ": provider failure passed; checking collaborator");
    accountRole = "collaborator";
    unavailable = false;
    const readsBeforeStaff = statusCalls;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page
      .getByRole("heading", { name: "Productos", exact: true })
      .waitFor()
      .catch(async (e) => {
        console.error("Synthetic page state:", await page.locator("body").innerText());
        throw e;
      });
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
    await page.getByRole("button", { name: "Terminar escucha", exact: true }).click();
    await page.getByLabel("Sesión de voz", { exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Abrir menú", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Menú principal", exact: true })
      .getByRole("link", { name: "Ajustes", exact: true })
      .click();
    await page.getByRole("heading", { name: "Ajustes", exact: true }).waitFor();
    await page.getByRole("link", { name: "Mi perfil", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: /Colaboradores/ }).count(), 0);
    assert.equal(await page.getByRole("link", { name: /Cuotas/ }).count(), 0);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS " +
        label +
        ": Deepgram dock, consent, one persistent socket, real member/product/category forms, search, protected manual edits, streamed playback/interruption, stop, no automatic writes (audio/provider simulated)",
    );
    browserResults.push({
      browser: label,
      syntheticAuth: true,
      syntheticAudio: true,
      syntheticProvider: true,
      automaticWrites: writes,
      walletDraft: process.env.TEST_WALLET_ENABLED === "true",
      result: "PASS",
    });
    await context.close();
  } finally {
    await browser.close();
  }
}

await writeFile(
  executionUI
    ? ".sandbox/deepgram/execution-results.json"
    : startupOnly
      ? `.sandbox/deepgram/${nativeAudio ? "native-duplex" : "pending-resume"}-results.json`
      : ".sandbox/deepgram/administrative-results.json",
  JSON.stringify(browserResults, null, 2),
);
