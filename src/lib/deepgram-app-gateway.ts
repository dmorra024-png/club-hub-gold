import { parseAccountAccess, type AccountAccess } from "./access-context.ts";
import { deepgramPilotAllowed, normalizedPilotNames } from "./deepgram-pilot-policy.ts";
import { agentSettings, authorizeProposal } from "../../lab/deepgram/policy.ts";
import type { CatalogVocabulary } from "../../lab/deepgram/vocabulary.ts";

const SAFE_FAILURES = new Set([
  "AUTH_CONFIG",
  "AUTH_FAILED",
  "AUTH_FORBIDDEN",
  "CATALOG_UNAVAILABLE",
]);
const active = new Set<string>();
const recent = new Map<string, { at: number; count: number }>();
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
  let connectionController: AbortController | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let providerReady = false,
    lastAudioAt = Date.now();
  let upstream: WebSocket | undefined,
    ended = false,
    handshakeStarted = false;
  let owner: string | undefined,
    bytes = 0,
    calls = 0;
  const seen = new Set<string>();
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
    authController.abort();
    connectionController?.abort();
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
        if (typeof e.data !== "string" || e.data.length > 7000) return close("AUTH_REQUIRED");
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
        if (ended) return;
        const now = Date.now();
        for (const [id, slot] of recent) if (now - slot.at > 3600000) recent.delete(id);
        const slot = recent.get(verified.user);
        if (active.has(verified.user) || (slot?.count ?? 0) >= 4 || (!slot && recent.size > 500))
          return close("SESSION_LIMIT");
        recent.set(verified.user, { at: slot?.at ?? now, count: (slot?.count ?? 0) + 1 });
        active.add(verified.user);
        owner = verified.user;
        const settings = agentSettings(a.language, a.sampleRate, verified.catalog);
        settings.tags = ["snoop-admin-pilot"];
        // The actual club has consented to a names-only catalogue, unlike the
        // isolated public lab. Keep members fictional and all operations drafts.
        settings.agent.think.prompt =
          settings.agent.think.prompt
            .replace(
              "ISOLATED SYNTHETIC voice laboratory",
              "AUTHENTICATED READ-ONLY club administrator pilot",
            )
            .replace(
              "Only fictional people and data are allowed. Do not request real identifiers, documents or club information.",
              "Use fictional people only. The server has supplied approved club product/category DISPLAY NAMES with administrator consent. Never request actual member identifiers, documents, financial values or private records.",
            )
            .replace(
              "This lab role permits member and informational product drafts/search only, not financial/reports access.",
              "You may propose navigation to existing app cash and report screens; SNOOP checks permissions locally. You cannot read or request financial values or perform transactions.",
            ) +
          " For an explicit stop request, call snoop_propose with intent stop and target null to stop capture immediately. " +
          " For a NEW category draft use intent category, target categories, " +
          "product.name as the requested label and do not claim it already exists. " +
          "For assignment to a product, category must match a verified catalogue label. " +
          "Every action is a non-persistent draft; only the manual app may save.";
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
        upstream = upgraded.webSocket;
        upstream.binaryType = "arraybuffer";
        (upstream as any).accept();
        upstream.addEventListener("close", () => close("PROVIDER_CLOSED"));
        upstream.addEventListener("error", () => close("PROVIDER_ERROR"));
        upstream.addEventListener("message", (event: MessageEvent) => {
          if (ended) return;
          if (typeof event.data !== "string") {
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
                let result: unknown = { ok: false, code: "SNOOP_PROPOSAL_REJECTED" };
                if (
                  f.name === "snoop_propose" &&
                  typeof f.id === "string" &&
                  !seen.has(f.id) &&
                  ++calls <= 30
                ) {
                  seen.add(f.id);
                  try {
                    result = authorizeProposal(
                      JSON.parse(f.arguments),
                      verified.access,
                      verified.catalog,
                    );
                  } catch {}
                }
                send({ type: "AppProposal", result });
                upstream?.send(
                  JSON.stringify({
                    type: "FunctionCallResponse",
                    id: f.id,
                    name: f.name,
                    content: JSON.stringify(result),
                  }),
                );
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
              send({ type: "AppReady", verifiedCategories: verified.catalog.categories.length });
            } else if (m.type === "ConversationText" && ["user", "assistant"].includes(m.role)) {
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
              send({ type: m.type });
            }
          } catch {
            close("PROVIDER_INVALID");
          }
        });
        clearTimeout(deadline);
        deadline = setTimeout(() => close("SESSION_LIMIT_90S"), 90000);
        upstream.send(JSON.stringify(settings));
        keepalive = setInterval(() => {
          if (Date.now() - lastAudioAt > 6000) {
            try {
              upstream?.send(JSON.stringify({ type: "KeepAlive" }));
            } catch {
              close("PROVIDER_ERROR");
            }
          }
        }, 8000);
        return;
      }
      if (typeof e.data === "string") {
        if (e.data === "STOP") return close("STOPPED");
        return close("INVALID_SEQUENCE");
      }
      if (!(e.data instanceof ArrayBuffer) || !upstream || !providerReady)
        return close("INVALID_AUDIO");
      bytes += e.data.byteLength;
      if (e.data.byteLength > 32768 || bytes > 10_000_000) return close("AUDIO_LIMIT");
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
