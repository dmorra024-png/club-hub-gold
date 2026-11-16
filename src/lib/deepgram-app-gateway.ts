import { parseAccountAccess, type AccountAccess } from "./access-context";
import { deepgramPilotAllowed, normalizedPilotNames } from "./deepgram-pilot-policy";
import { agentSettings, authorizeProposal } from "../../lab/deepgram/policy";
import type { CatalogVocabulary } from "../../lab/deepgram/vocabulary";

const active = new Set<string>();
const recent = new Map<string, { at: number; count: number }>();
const setting = (env: Record<string, unknown>, name: string) =>
  String(env[name] ?? process.env[name] ?? "");

async function verifySession(token: string, env: Record<string, unknown>): Promise<{
  user: string; access: AccountAccess; catalog: CatalogVocabulary;
}> {
  const base = setting(env, "SUPABASE_URL").replace(/\/$/, "");
  const key = setting(env, "SUPABASE_PUBLISHABLE_KEY");
  if (!/^https:\/\/[^/]+$/.test(base) || !key || token.length > 5000 || token.split(".").length !== 3)
    throw Error("AUTH_CONFIG");
  const headers = { Authorization: "Bearer " + token, apikey: key };
  async function get(path: string, method = "GET") {
    const res = await fetch(base + path, {
      method, headers: { ...headers, "Content-Type": "application/json" },
      body: method === "POST" ? "{}" : undefined,
      redirect: "error", signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw Error("AUTH_FAILED");
    return res.json();
  }
  const profile = await get("/auth/v1/user");
  if (!profile || typeof profile.id !== "string") throw Error("AUTH_FAILED");
  const access = parseAccountAccess(await get("/rest/v1/rpc/snoop_access_context", "POST"));
  if (!deepgramPilotAllowed(access, profile.id, {
    enabled: setting(env, "SNOOP_DEEPGRAM_PILOT_ENABLED"),
    allowedUserId: setting(env, "SNOOP_DEEPGRAM_PILOT_USER_ID"),
    allowedClubId: setting(env, "SNOOP_DEEPGRAM_PILOT_CLUB_ID"),
  })) throw Error("AUTH_FORBIDDEN");
  const club = encodeURIComponent(access.clubId!);
  const [cats, products] = await Promise.all([
    get("/rest/v1/product_categories?select=name&club_id=eq." + club +
      "&archived=eq.false&order=name.asc&limit=35"),
    get("/rest/v1/products?select=name&club_id=eq." + club +
      "&active=eq.true&order=name.asc&limit=35"),
  ]);
  if (!Array.isArray(cats) || !Array.isArray(products)) throw Error("CATALOG_UNAVAILABLE");
  return {
    user: profile.id, access,
    catalog: { categories: normalizedPilotNames(cats), products: normalizedPilotNames(products) },
  };
}

/**
 * Same-origin, authenticated audio relay. No preview keys, member data,
 * vendor keys or user JWTs are forwarded to the provider.
 * Runtime feature flag is OFF by default.
 */
export async function deepgramAppSocket(request: Request, envValue: unknown): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/snoop-deepgram/socket") return null;
  const error = (code: string, status = 403) =>
    new Response(JSON.stringify({ code }), { status, headers: { "Cache-Control": "no-store" } });
  if (url.protocol !== "https:" || request.headers.get("Origin") !== url.origin ||
      request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("ORIGIN");
  const env = (envValue && typeof envValue === "object" ? envValue : {}) as Record<string, unknown>;
  const key = setting(env, "DEEPGRAM_API_KEY");
  if (!key || setting(env, "SNOOP_DEEPGRAM_PILOT_ENABLED") !== "true")
    return error("PILOT_OFF", 503);
  const Pair = (globalThis as any).WebSocketPair;
  if (!Pair) return error("SOCKET_UNAVAILABLE", 503);
  const p = new Pair(), client = p[0] as WebSocket, server = p[1] as WebSocket;
  (server as any).accept();
  server.binaryType = "arraybuffer";
  let upstream: WebSocket | undefined, ended = false, handshakeStarted = false;
  let owner: string | undefined, bytes = 0, calls = 0;
  const seen = new Set<string>();
  let deadline: ReturnType<typeof setTimeout>;
  const send = (body: unknown) => { try { server.send(JSON.stringify(body)); } catch {} };
  const close = (reason: string) => {
    if (ended) return;
    ended = true;
    clearTimeout(deadline);
    if (owner) active.delete(owner);
    send({ type: "AppClosed", code: reason });
    try { upstream?.close(1000, "closed"); } catch {}
    try { server.close(1000, "closed"); } catch {}
  };
  deadline = setTimeout(() => close("AUTH_TIMEOUT"), 8000);
  server.addEventListener("close", () => close("CLIENT_CLOSED"));
  server.addEventListener("error", () => close("CLIENT_ERROR"));
  server.addEventListener("message", async (e: MessageEvent) => {
    if (ended) return;
    try {
      if (!handshakeStarted) {
        if (typeof e.data !== "string" || e.data.length > 7000)
          return close("AUTH_REQUIRED");
        handshakeStarted = true;
        const a = JSON.parse(e.data);
        if (a?.type !== "AppStart" || a.consent !== true || a.synthetic !== true ||
            !["it", "es", "en"].includes(a.language) ||
            ![16000, 24000, 44100, 48000].includes(a.sampleRate) ||
            typeof a.token !== "string") return close("AUTH_INVALID");
        const verified = await verifySession(a.token, env);
        if (ended) return;
        const now = Date.now();
        for (const [id, slot] of recent) if (now - slot.at > 3600000) recent.delete(id);
        const slot = recent.get(verified.user);
        if (active.has(verified.user) || (slot?.count ?? 0) >= 4 ||
            (!slot && recent.size > 500)) return close("SESSION_LIMIT");
        recent.set(verified.user, { at: slot?.at ?? now, count: (slot?.count ?? 0) + 1 });
        active.add(verified.user);
        owner = verified.user;
        const settings = agentSettings(a.language, a.sampleRate, verified.catalog);
        settings.tags = ["snoop-admin-pilot"];
        const response = await fetch("https://agent.deepgram.com/v1/agent/converse", {
          headers: { Upgrade: "websocket", Authorization: "Token " + key },
          signal: AbortSignal.timeout(12000), redirect: "manual",
        });
        if (ended) return;
        if (response.status !== 101 || !response.webSocket)
          return close("PROVIDER_UNAVAILABLE");
        upstream = response.webSocket;
        (upstream as any).accept();
        upstream.binaryType = "arraybuffer";
        upstream.addEventListener("close", () => close("PROVIDER_CLOSED"));
        upstream.addEventListener("error", () => close("PROVIDER_ERROR"));
        upstream.addEventListener("message", (event: MessageEvent) => {
          if (ended) return;
          if (typeof event.data !== "string") {
            try { server.send(event.data); } catch {}
            return;
          }
          try {
            const m = JSON.parse(event.data);
            if (m.type === "FunctionCallRequest") {
              for (const f of m.functions || []) {
                if (f.client_side !== true) continue;
                let result: unknown = { ok: false, code: "SNOOP_PROPOSAL_REJECTED" };
                if (f.name === "snoop_propose" && typeof f.id === "string" &&
                    !seen.has(f.id) && ++calls <= 30) {
                  seen.add(f.id);
                  try {
                    result = authorizeProposal(JSON.parse(f.arguments), verified.access, verified.catalog);
                  } catch {}
                }
                send({ type: "AppProposal", result });
                upstream?.send(JSON.stringify({
                  type: "FunctionCallResponse", id: f.id, name: f.name,
                  content: JSON.stringify(result),
                }));
              }
            } else if (m.type === "SettingsApplied") {
              send({ type: "AppReady", verifiedCategories: verified.catalog.categories.length });
            } else if (m.type === "ConversationText" &&
                       ["user", "assistant"].includes(m.role)) {
              send({ type: "ConversationText", role: m.role,
                content: String(m.content || "").slice(0, 1200) });
            } else if (m.type === "UserStartedSpeaking" || m.type === "AgentThinking") {
              send({ type: m.type });
            }
          } catch { close("PROVIDER_INVALID"); }
        });
        clearTimeout(deadline);
        deadline = setTimeout(() => close("SESSION_LIMIT_90S"), 90000);
        upstream.send(JSON.stringify(settings));
        return;
      }
      if (typeof e.data === "string") {
        if (e.data === "STOP") return close("STOPPED");
        return close("INVALID_SEQUENCE");
      }
      if (!(e.data instanceof ArrayBuffer) || !upstream) return close("INVALID_AUDIO");
      bytes += e.data.byteLength;
      if (bytes > 10_000_000) return close("AUDIO_LIMIT");
      if (upstream.readyState !== 1) return close("PROVIDER_CLOSED");
      upstream.send(e.data);
    } catch { close("SESSION_UNAVAILABLE"); }
  });
  return new Response(null, { status: 101, webSocket: client } as ResponseInit);
}
