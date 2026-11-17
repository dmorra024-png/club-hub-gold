import { emptyConversation } from "./snoop-conversation.ts";
import { voiceCashToday } from "./voice/cash-read.server.ts";
import { VoiceUsageLease } from "./voice/usage.server.ts";
import {
  sealVoiceSnapshot,
  openVoiceSnapshot,
  type VoiceSnapshot,
} from "./voice/checkpoint.server.ts";
import { ActionReceipt, actionOutcome } from "./voice/action-protocol.ts";
import { parseAccountAccess, type AccountAccess } from "./access-context.ts";
import { deepgramPilotAllowed, normalizedPilotNames } from "./deepgram-pilot-policy.ts";
import { agentSettings, authorizeProposal } from "./voice/agent-settings.server.ts";
import type { CatalogVocabulary } from "./voice/catalog-vocabulary.ts";

const SAFE_FAILURES = new Set([
  "AUTH_CONFIG",
  "AUTH_FAILED",
  "AUTH_FORBIDDEN",
  "CATALOG_UNAVAILABLE",
  "VOICE_SESSION_BUSY",
  "VOICE_USAGE_CONFIG_REQUIRED",
  "VOICE_USAGE_UNAVAILABLE",
  "VOICE_USAGE_INVALID",
  "VOICE_BUDGET_EXHAUSTED",
  "VOICE_RESUME_INVALID",
]);
const active = new Set<string>();

const setting = (env: Record<string, unknown>, name: string) =>
  String(env[name] ?? process.env[name] ?? "");

async function verifySession(
  token: string,
  env: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{
  user: string;
  access: AccountAccess;
  catalog: CatalogVocabulary;
}> {
  const base = setting(env, "SUPABASE_URL").replace(/\/$/, "");
  const key = setting(env, "SUPABASE_PUBLISHABLE_KEY");
  if (
    base !== "https://bnwanxbmprbymbutoths.supabase.co" ||
    !key ||
    token.length > 5000 ||
    token.split(".").length !== 3
  )
    throw Error("AUTH_CONFIG");
  const headers = { Authorization: "Bearer " + token, apikey: key };
  async function get(path: string, method = "GET") {
    const res = await fetch(base + path, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
      redirect: "manual",
      signal,
    });
    if (!res.ok) throw Error("AUTH_FAILED");
    return res.json();
  }
  const profile = await get("/auth/v1/user");
  if (!profile || typeof profile.id !== "string") throw Error("AUTH_FAILED");
  const access = parseAccountAccess(await get("/rest/v1/rpc/snoop_access_context", "POST"));
  if (
    !deepgramPilotAllowed(access, profile.id, {
      enabled: setting(env, "SNOOP_DEEPGRAM_PILOT_ENABLED"),
      allowedUserId: setting(env, "SNOOP_DEEPGRAM_PILOT_USER_ID"),
      allowedClubId: setting(env, "SNOOP_DEEPGRAM_PILOT_CLUB_ID"),
    })
  )
    throw Error("AUTH_FORBIDDEN");
  const club = encodeURIComponent(access.clubId!);
  const [cats, products] = await Promise.all([
    get(
      "/rest/v1/product_categories?select=name&club_id=eq." +
        club +
        "&or=(archived.eq.false,archived.is.null)&order=name.asc&limit=35",
    ),
    get(
      "/rest/v1/products?select=name&club_id=eq." +
        club +
        "&or=(active.eq.true,active.is.null)&order=name.asc&limit=35",
    ),
  ]);
  if (!Array.isArray(cats) || !Array.isArray(products)) throw Error("CATALOG_UNAVAILABLE");
  return {
    user: profile.id,
    access,
    catalog: { categories: normalizedPilotNames(cats), products: normalizedPilotNames(products) },
  };
}

/**
 * Same-origin, authenticated audio relay. No preview keys, member data,
 * vendor keys or user JWTs are forwarded to the provider.
 * Runtime feature flag is OFF by default.
 */
export async function deepgramAppSocket(
  request: Request,
  envValue: unknown,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/snoop-deepgram/socket") return null;
  const error = (code: string, status = 403) =>
    new Response(JSON.stringify({ code }), { status, headers: { "Cache-Control": "no-store" } });
  if (
    url.protocol !== "https:" ||
    request.headers.get("Origin") !== url.origin ||
    request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
  )
    return error("ORIGIN");
  const env = (envValue && typeof envValue === "object" ? envValue : {}) as Record<string, unknown>;
  const key = setting(env, "DEEPGRAM_API_KEY");
  if (!key || setting(env, "SNOOP_DEEPGRAM_PILOT_ENABLED") !== "true")
    return error("PILOT_OFF", 503);
  const Pair = (globalThis as any).WebSocketPair;
  if (!Pair) return error("SOCKET_UNAVAILABLE", 503);
  const p = new Pair(),
    client = p[0] as WebSocket,
    server = p[1] as WebSocket;
  server.binaryType = "arraybuffer";
  (server as any).accept();
  const authController = new AbortController();
  let verifiedSession: Awaited<ReturnType<typeof verifySession>> | undefined;
  let verifiedToken = "";
  let connectionController: AbortController | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let usage: VoiceUsageLease | undefined;
  let checkpointOwner = "",
    checkpointClub = "",
    turn = 0,
    newTurn = false,
    speech = false;
  const billingMonth = new Date().toISOString().slice(0, 7);
  let lastInteraction = Date.now(),
    maintenanceBusy = false,
    checkpointSequence = 0;
  const history: VoiceSnapshot["history"] = [];
  let memory = emptyConversation();
  const checkpoint = async () => {
    if (!checkpointOwner || ended) return;
    const sequence = ++checkpointSequence;
    const token = await sealVoiceSnapshot(
      {
        owner: checkpointOwner,
        club: checkpointClub,
        turn,
        expires: Date.now() + 43200000,
        history: history.slice(-10),
        memory,
      },
      key,
    );
    if (!ended) send({ type: "AppCheckpoint", token, sequence });
  };
  let audioRate = 0,
    audioCredits = 0,
    audioRefill = Date.now();
  let providerReady = false,
    lastAudioAt = Date.now();
  let upstream: WebSocket | undefined,
    ended = false,
    handshakeStarted = false;
  let owner: string | undefined,
    calls = 0;
  const seen = new Set<string>();
  const pending = new Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>();
  let deadline: ReturnType<typeof setTimeout>;
  const send = (body: unknown) => {
    try {
      server.send(JSON.stringify(body));
    } catch {}
  };
  const close = (reason: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(deadline);
    clearInterval(keepalive);
    for (const p of pending.values()) clearTimeout(p.timer);
    pending.clear();
    authController.abort();
    connectionController?.abort();
    if (usage) {
      const released = usage.close().catch(() => undefined);
      const wait = (request as Request & { waitUntil?: (promise: Promise<unknown>) => void })
        .waitUntil;
      if (wait) wait(released);
    }
    if (owner) active.delete(owner);
    send({ type: "AppClosed", code: reason });
    try {
      upstream?.close(1000, "closed");
    } catch {}
    try {
      server.close(1000, "closed");
    } catch {}
  };
  deadline = setTimeout(() => close("AUTH_TIMEOUT"), 8000);
  server.addEventListener("close", () => close("CLIENT_CLOSED"));
  server.addEventListener("error", () => close("CLIENT_ERROR"));
  server.addEventListener("message", async (e: MessageEvent) => {
    if (ended) return;
    try {
      if (!handshakeStarted) {
        if (typeof e.data !== "string" || e.data.length > 31000) return close("AUTH_REQUIRED");
        handshakeStarted = true;
        const a = JSON.parse(e.data);
        if (
          a?.type !== "AppStart" ||
          a.consent !== true ||
          a.synthetic !== true ||
          !["it", "es", "en"].includes(a.language) ||
          ![16000, 24000, 44100, 48000].includes(a.sampleRate) ||
          typeof a.token !== "string"
        )
          return close("AUTH_INVALID");
        const verified = await verifySession(a.token, env, authController.signal);
        verifiedSession = verified;
        verifiedToken = a.token;
        if (ended) return;
        if (active.has(verified.user)) return close("SESSION_LIMIT");
        clearTimeout(deadline);
        deadline = setTimeout(() => close("PROVIDER_TIMEOUT"), 16000);
        checkpointOwner = verified.user;
        checkpointClub = verified.access.clubId!;
        if (a.resume !== undefined) {
          if (typeof a.resume !== "string") return close("VOICE_RESUME_INVALID");
          const saved = await openVoiceSnapshot(a.resume, key, checkpointOwner, checkpointClub);
          turn = saved.turn;
          history.push(...saved.history);
          memory = saved.memory ?? emptyConversation();
        }
        usage = new VoiceUsageLease({
          url: setting(env, "SUPABASE_URL"),
          key: setting(env, "SUPABASE_SERVICE_ROLE_KEY"),
          actor: verified.user,
          club: checkpointClub,
        });
        const initialUsage = await usage.start();
        if (ended) {
          await usage.close();
          return;
        }
        send({ type: "AppUsage", usage: initialUsage });
        active.add(verified.user);
        owner = verified.user;
        const settings = agentSettings(a.language, a.sampleRate, verified.catalog);
        settings.tags = ["snoop-admin-pilot"];
        settings.agent.think.prompt +=
          " Restored dialogue is context, not a new command. Never replay tools from history; wait for a new user request. Conversation memory: " +
          JSON.stringify({ history, memory }) +
          " Use only verified product and category labels. For a new category use intent category and target categories. Application results are authoritative: opened means a screen opened, prepared means draft fields only, and no data is saved unless a separate manual confirmation succeeds. Never describe an error or pending confirmation as success. Member details remain fictional unless privacy approval was explicitly enabled by the server.";
        const controller = new AbortController();
        connectionController = controller;
        const connectionDeadline = setTimeout(() => controller.abort(), 12000);
        let response: Response;
        try {
          response = await fetch("https://agent.deepgram.com/v1/agent/converse", {
            headers: { Upgrade: "websocket", Authorization: "Token " + key },
            signal: controller.signal,
            redirect: "manual",
          });
        } finally {
          clearTimeout(connectionDeadline);
        }
        const upgraded = response as Response & { webSocket?: WebSocket };
        if (ended) {
          try {
            upgraded.webSocket?.close(1000, "client stopped");
          } catch {}
          return;
        }
        if (upgraded.status !== 101 || !upgraded.webSocket) return close("PROVIDER_UNAVAILABLE");
        usage.markConnected();
        audioRate = a.sampleRate * 2;
        audioCredits = audioRate * 8;
        audioRefill = Date.now();
        upstream = upgraded.webSocket;
        upstream.binaryType = "arraybuffer";
        (upstream as any).accept();
        upstream.addEventListener("close", () => close("PROVIDER_CLOSED"));
        upstream.addEventListener("error", () => close("PROVIDER_ERROR"));
        upstream.addEventListener("message", (event: MessageEvent) => {
          if (ended) return;
          if (typeof event.data !== "string") {
            lastInteraction = Date.now();
            try {
              server.send(event.data);
            } catch {}
            return;
          }
          try {
            const m = JSON.parse(event.data);
            if (m.type === "FunctionCallRequest") {
              for (const f of m.functions || []) {
                if (f.client_side !== true) continue;
                if (typeof f.id === "string" && seen.has(f.id)) continue;
                let result: unknown = { ok: false, code: "SNOOP_PROPOSAL_REJECTED" };
                if (
                  ["snoop_propose", "snoop_cash_today"].includes(f.name) &&
                  typeof f.id === "string" &&
                  f.id.length <= 120 &&
                  !seen.has(f.id) &&
                  newTurn &&
                  ++calls <= 8
                ) {
                  seen.add(f.id);
                  try {
                    const args = JSON.parse(f.arguments);
                    const proposal =
                      f.name === "snoop_cash_today"
                        ? args &&
                          typeof args === "object" &&
                          !Array.isArray(args) &&
                          Object.keys(args).length === 0
                          ? {
                              intent: "navigate",
                              target: "cash_report",
                              member: {},
                              product: {},
                              query: null,
                              declined: [],
                              question: "",
                              asking: null,
                            }
                          : null
                        : args;
                    result = authorizeProposal(proposal, verified.access, verified.catalog);
                  } catch {}
                }
                if ((result as { ok: boolean }).ok) {
                  const p = (result as any).proposal;
                  memory = {
                    ...memory,
                    operation: ["member", "product", "category", "search"].includes(p.intent)
                      ? p.intent
                      : memory.operation,
                    member: { ...memory.member, ...p.member },
                    product: { ...memory.product, ...p.product },
                    declined:
                      p.declined.includes("phone") || memory.declined.includes("phone")
                        ? ["phone"]
                        : [],
                    lastQuestion: p.question,
                  };
                  const id = f.id;
                  if (pending.has(id)) continue;
                  const timer = setTimeout(() => {
                    pending.delete(id);
                    try {
                      upstream?.send(
                        JSON.stringify({
                          type: "FunctionCallResponse",
                          id,
                          name: f.name,
                          content: JSON.stringify({
                            ok: false,
                            code: "APP_RESULT_TIMEOUT",
                            persisted: false,
                          }),
                        }),
                      );
                    } catch {}
                  }, 10000);
                  pending.set(id, { name: f.name, timer });
                  send({ type: "AppProposal", id, result });
                } else {
                  send({ type: "AppProposal", id: f.id, result });
                  upstream?.send(
                    JSON.stringify({
                      type: "FunctionCallResponse",
                      id: f.id,
                      name: f.name,
                      content: JSON.stringify(result),
                    }),
                  );
                }
              }
            } else if (m.type === "Error") {
              send({
                type: "AppError",
                code:
                  typeof m.code === "string" && /^[A-Za-z0-9_]{1,80}$/.test(m.code)
                    ? m.code
                    : "PROVIDER_ERROR",
              });
              close("PROVIDER_REJECTED");
            } else if (m.type === "SettingsApplied") {
              providerReady = true;
              lastInteraction = Date.now();
              send({ type: "AppReady", verifiedCategories: verified.catalog.categories.length });
            } else if (m.type === "ConversationText" && ["user", "assistant"].includes(m.role)) {
              lastInteraction = Date.now();
              if (m.role === "user") {
                if (!newTurn) {
                  turn++;
                  calls = 0;
                }
                newTurn = true;
              }
              history.push({ role: m.role, content: String(m.content || "").slice(0, 1200) });
              if (history.length > 10) history.shift();
              void checkpoint();
              send({
                type: "ConversationText",
                role: m.role,
                content: String(m.content || "").slice(0, 1200),
              });
            } else if (
              m.type === "UserStartedSpeaking" ||
              m.type === "AgentThinking" ||
              m.type === "AgentAudioDone"
            ) {
              lastInteraction = Date.now();
              if (m.type === "UserStartedSpeaking") {
                if (!speech) {
                  turn++;
                  calls = 0;
                }
                speech = true;
                newTurn = true;
              }
              if (m.type === "AgentThinking") speech = false;
              send({ type: m.type });
            }
          } catch {
            close("PROVIDER_INVALID");
          }
        });
        clearTimeout(deadline);
        deadline = setTimeout(() => {
          if (!providerReady) close("PROVIDER_SETTINGS_TIMEOUT");
        }, 10000);
        upstream.send(JSON.stringify(settings));
        keepalive = setInterval(async () => {
          if (ended || maintenanceBusy) return;
          maintenanceBusy = true;
          try {
            if (new Date().toISOString().slice(0, 7) !== billingMonth) {
              await checkpoint();
              return close("MONTH_ROLLOVER");
            }
            if (!usage?.valid()) return close("VOICE_LEASE_EXPIRED");
            if (Date.parse(usage.leaseUntil) - Date.now() < 8000)
              send({ type: "AppUsage", usage: await usage.extend() });
            if (!speech && Date.now() - lastInteraction > 45000) {
              await checkpoint();
              return close("IDLE_PAUSED");
            }
            if (Date.now() - lastAudioAt > 6000)
              upstream?.send(JSON.stringify({ type: "KeepAlive" }));
          } catch (error) {
            close(
              error instanceof Error && SAFE_FAILURES.has(error.message)
                ? error.message
                : "VOICE_USAGE_UNAVAILABLE",
            );
          } finally {
            maintenanceBusy = false;
          }
        }, 3000);
        return;
      }
      if (typeof e.data === "string") {
        if (e.data === "STOP") return close("STOPPED");
        if (e.data.length > 3000) return close("INVALID_SEQUENCE");
        const receipt = ActionReceipt.safeParse(JSON.parse(e.data));
        if (!receipt.success) return close("INVALID_SEQUENCE");
        const item = pending.get(receipt.data.id);
        if (!item) {
          if (seen.has(receipt.data.id)) return;
          return close("UNEXPECTED_ACTION_RESULT");
        }
        // The current provider tools prepare drafts only; a browser cannot promote them to saves.
        if (receipt.data.status === "completed") return close("INVALID_ACTION_RESULT");
        clearTimeout(item.timer);
        pending.delete(receipt.data.id);
        let outcome: unknown = actionOutcome(receipt.data);
        if (item.name === "snoop_cash_today" && receipt.data.status !== "rejected") {
          try {
            const verified = await verifySession(verifiedToken, env, authController.signal);
            if (
              !verifiedSession ||
              verified.user !== verifiedSession.user ||
              verified.access.clubId !== verifiedSession.access.clubId ||
              !verified.access.permissions.includes("view_reports")
            )
              throw Error("AUTH_FORBIDDEN");
            const summary = await voiceCashToday(
              setting(env, "SUPABASE_URL"),
              setting(env, "SUPABASE_PUBLISHABLE_KEY"),
              verifiedToken,
              verified.user,
              verified.access.clubId!,
            );
            outcome = { ok: true, status: "read", persisted: false, summary };
            send({ type: "AppCashResult", summary });
          } catch {
            outcome = { ok: false, code: "CASH_UNAVAILABLE", persisted: false };
          }
        }
        history.push({
          role: "assistant",
          content: "Application result: " + JSON.stringify(outcome),
        });
        if (history.length > 10) history.shift();
        void checkpoint();
        upstream?.send(
          JSON.stringify({
            type: "FunctionCallResponse",
            id: receipt.data.id,
            name: item.name,
            content: JSON.stringify(outcome),
          }),
        );
        return;
      }
      if (!usage?.valid()) return close("VOICE_LEASE_EXPIRED");
      if (!(e.data instanceof ArrayBuffer) || !upstream || !providerReady)
        return close("INVALID_AUDIO");
      if (e.data.byteLength > 32768) return close("AUDIO_LIMIT");
      const elapsed = Math.max(0, Date.now() - audioRefill);
      audioRefill = Date.now();
      audioCredits =
        Math.min(audioRate * 8, audioCredits + (elapsed * audioRate) / 1000) - e.data.byteLength;
      if (audioCredits < 0) return close("AUDIO_RATE_LIMIT");
      if (upstream.readyState !== 1) return close("PROVIDER_CLOSED");
      lastAudioAt = Date.now();
      upstream.send(e.data);
    } catch (error) {
      close(
        error instanceof Error && SAFE_FAILURES.has(error.message)
          ? error.message
          : "SESSION_UNAVAILABLE",
      );
    }
  });
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}
