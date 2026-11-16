import { authorizeProposal, agentSettings } from "./policy.ts";
interface Env {
  DEEPGRAM_API_KEY: string;
  VOICE_PREVIEW_KEY: string;
  [key: string]: unknown;
}
const ORIGIN = "https://snoop-voice-lab.dmorra024.workers.dev";
const BUILD = "__LAB_BUILD_SHA__";
const MAX_MS = 90000,
  MAX_BYTES = 10000000;
const security = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "microphone=(self), camera=()",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self' blob:; style-src 'self'; connect-src 'self' wss://snoop-voice-lab.dmorra024.workers.dev; worker-src 'self' blob:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};
export function safeJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...security, "Content-Type": "application/json" },
  });
}
async function equal(a: unknown, b: unknown) {
  if (typeof a !== "string" || typeof b !== "string" || !b || a.length > 512) return false;
  const hash = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  return [...new Uint8Array(x)].reduce((n, v, i) => n | (v ^ new Uint8Array(y)[i]), 0) === 0;
}
async function authorized(key: unknown, env: Env) {
  return (
    (await equal(key, env.VOICE_PREVIEW_KEY)) ||
    (await equal(typeof key === "string" ? await digest(key) : "", "__LAB_PROBE_HASH__"))
  );
}
async function digest(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
const sessions = new Map<string, number>();
export async function labFetch(request: Request, env: Env): Promise<Response | null> {
  const u = new URL(request.url);
  if (!u.pathname.startsWith("/deepgram")) return null;
  if (u.hostname !== "snoop-voice-lab.dmorra024.workers.dev" && u.hostname !== "localhost")
    return safeJson({ code: "LAB_WRONG_HOST" }, 403);
  if (request.method === "GET" && u.pathname === "/deepgram/health")
    return safeJson({
      lab: true,
      syntheticOnly: true,
      provider: "Deepgram Voice Agent",
      build: BUILD,
      probeSlot: "__LAB_PROBE_HASH__".slice(0, 16),
      keyConfigured: !!env.DEEPGRAM_API_KEY,
      maxSessionSeconds: MAX_MS / 1000,
      productionConnected: false,
    });
  if (request.method === "POST" && u.pathname === "/deepgram/credit") {
    if (request.headers.get("Origin") && request.headers.get("Origin") !== ORIGIN)
      return safeJson({ code: "LAB_ORIGIN_REJECTED" }, 403);
    if (!(await authorized(request.headers.get("X-Preview-Key"), env)))
      return safeJson({ code: "LAB_UNAUTHORIZED" }, 401);
    const headers = { Authorization: `Token ${env.DEEPGRAM_API_KEY}` };
    try {
      const p = await fetch("https://api.deepgram.com/v1/projects", {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (!p.ok) return safeJson({ available: false, stage: "projects", http: p.status });
      const projects = ((await p.json()) as any).projects;
      if (!Array.isArray(projects) || projects.length !== 1)
        return safeJson({ available: false, code: "LAB_BALANCE_SCOPE_NOT_UNIQUE" });
      const id = projects[0].project_id;
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return safeJson({ available: false, code: "LAB_BALANCE_INVALID_SCOPE" });
      const r = await fetch(`https://api.deepgram.com/v1/projects/${id}/balances`, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) return safeJson({ available: false, stage: "balances", http: r.status });
      const balances = ((await r.json()) as any).balances;
      return safeJson({
        available: true,
        balances: balances.map((b: any) => ({ amount: b.amount, units: b.units })),
        observedAt: new Date().toISOString(),
      });
    } catch {
      return safeJson({ available: false, code: "LAB_BALANCE_UNAVAILABLE" });
    }
  }
  if (u.pathname !== "/deepgram/socket") return null;
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
    return safeJson({ code: "LAB_WEBSOCKET_REQUIRED" }, 426);
  if (request.headers.get("Origin") !== ORIGIN)
    return safeJson({ code: "LAB_ORIGIN_REJECTED" }, 403);
  const pair = new WebSocketPair(),
    client = pair[0],
    socket = pair[1];
  socket.binaryType = "arraybuffer";
  socket.accept();
  let upstream: WebSocket | undefined,
    closed = false,
    connecting = false,
    ready = false,
    bytes = 0,
    toolCount = 0;
  const seen = new Set<string>();
  const send = (x: unknown) => {
    try {
      socket.send(JSON.stringify(x));
    } catch {}
  };
  const close = (code = "LAB_STOPPED") => {
    if (closed) return;
    closed = true;
    clearTimeout(deadline);
    clearInterval(keepalive);
    clearTimeout(sessionDeadline);
    send({ type: "LabClosed", code });
    try {
      upstream?.close(1000, "lab session ended");
    } catch {}
    try {
      socket.close(1000, "lab session ended");
    } catch {}
  };
  const deadline = setTimeout(() => close("LAB_AUTH_TIMEOUT"), 8000);
  let keepalive: ReturnType<typeof setInterval>;
  let sessionDeadline: ReturnType<typeof setTimeout>;
  socket.addEventListener("close", () => close());
  socket.addEventListener("error", () => close("LAB_SOCKET_ERROR"));
  socket.addEventListener("message", async (event) => {
    try {
      if (closed) return;
      if (!upstream) {
        if (connecting) return close("LAB_INVALID_SEQUENCE");
        connecting = true;
        if (typeof event.data !== "string" || event.data.length > 2048)
          return close("LAB_AUTH_REQUIRED");
        const auth = JSON.parse(event.data);
        const envelopeValid =
          auth.type === "LabStart" &&
          auth.synthetic === true &&
          ["it", "es"].includes(auth.language) &&
          [16000, 24000, 44100, 48000].includes(auth.sampleRate);
        const credentialValid = await authorized(auth.key, env);
        if (!envelopeValid || !credentialValid) {
          send({
            type: "LabAuthRejected",
            build: BUILD,
            envelopeValid,
            credentialValid,
            probeSlot: "__LAB_PROBE_HASH__".slice(0, 16),
          });
          return close("LAB_UNAUTHORIZED");
        }
        if (auth.expectedBuild && auth.expectedBuild !== BUILD) return close("LAB_BUILD_PENDING");
        if (!env.DEEPGRAM_API_KEY) return close("LAB_DEEPGRAM_KEY_MISSING");
        // Bounded per-isolate burst guard; not a global billing cap.
        const bucket = await digest(auth.key);
        const now = Date.now();
        for (const [k, t] of sessions) if (now - t > 90000) sessions.delete(k);
        if (sessions.has(bucket)) return close("LAB_SESSION_ALREADY_ACTIVE");
        sessions.set(bucket, now);
        socket.addEventListener("close", () => sessions.delete(bucket));
        clearTimeout(deadline);
        sessionDeadline = setTimeout(() => close("LAB_SESSION_LIMIT_90S"), MAX_MS);
        const handshakeController = new AbortController();
        const handshakeTimeout = setTimeout(() => handshakeController.abort(), 12000);
        let response: Response;
        try {
          response = await fetch("https://agent.deepgram.com/v1/agent/converse", {
            headers: { Upgrade: "websocket", Authorization: `Token ${env.DEEPGRAM_API_KEY}` },
            redirect: "manual",
            signal: handshakeController.signal,
          });
        } finally {
          clearTimeout(handshakeTimeout);
        }
        if (response.status !== 101 || !response.webSocket) {
          send({ type: "LabError", code: "DEEPGRAM_CONNECT_FAILED", http: response.status });
          return close();
        }
        const privateProbe = await equal(await digest(auth.key), "__LAB_PROBE_HASH__");
        upstream = response.webSocket;
        upstream.binaryType = "arraybuffer";
        upstream.accept();
        if (closed) {
          upstream.close(1000, "lab stopped during connect");
          return;
        }
        upstream.addEventListener("close", () => close("DEEPGRAM_CLOSED"));
        upstream.addEventListener("error", () => close("DEEPGRAM_SOCKET_ERROR"));
        upstream.addEventListener("message", (e) => {
          if (closed) return;
          if (typeof e.data !== "string") {
            try {
              socket.send(e.data);
            } catch {}
            return;
          }
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "FunctionCallRequest") {
              for (const f of msg.functions || []) {
                if (f.client_side !== true) continue;
                let result: any = { ok: false, code: "SNOOP_PROPOSAL_REJECTED" };
                if (
                  f.name === "snoop_propose" &&
                  typeof f.id === "string" &&
                  !seen.has(f.id) &&
                  ++toolCount <= 30
                ) {
                  seen.add(f.id);
                  try {
                    result = authorizeProposal(JSON.parse(f.arguments));
                  } catch {}
                }
                send({ type: "LabProposal", ...result });
                upstream!.send(
                  JSON.stringify({
                    type: "FunctionCallResponse",
                    id: f.id,
                    name: f.name,
                    content: JSON.stringify(result),
                  }),
                );
              }
              return;
            }
            if (msg.type === "SettingsApplied") {
              ready = true;
              send({
                type: "LabReady",
                language: auth.language,
                maxSessionSeconds: 90,
                build: BUILD,
                probeSlot: "__LAB_PROBE_HASH__".slice(0, 16),
              });
            }
            // Never forward raw provider errors or headers; no audio/transcript logging.
            if (msg.type === "Error") {
              send({
                type: "LabError",
                code:
                  typeof msg.code === "string" && /^[A-Za-z0-9_]{1,80}$/.test(msg.code)
                    ? msg.code
                    : "DEEPGRAM_AGENT_ERROR",
                stage: ready ? "conversation" : "settings",
                ...(privateProbe
                  ? {
                      detail: String(msg.description ?? msg.message ?? "")
                        .replaceAll(env.DEEPGRAM_API_KEY, "[REDACTED]")
                        .replaceAll(env.VOICE_PREVIEW_KEY, "[REDACTED]")
                        .replaceAll(auth.key, "[REDACTED]")
                        .slice(0, 300),
                    }
                  : {}),
              });
              return close();
            }
            if (
              [
                "Welcome",
                "SettingsApplied",
                "ConversationText",
                "UserStartedSpeaking",
                "AgentStartedSpeaking",
                "AgentThinking",
                "AgentAudioDone",
                "AgentAudioStart",
                "Usage",
                "FunctionCallCancelled",
              ].includes(msg.type)
            ) {
              const out: any = { type: msg.type };
              for (const k of [
                "role",
                "content",
                "request_id",
                "ttt_latency",
                "tts_latency",
                "ttfb",
                "total_latency",
              ])
                if (typeof msg[k] === "string" || typeof msg[k] === "number") out[k] = msg[k];
              send(out);
            }
          } catch {
            close("DEEPGRAM_PROTOCOL_ERROR");
          }
        });
        upstream.send(JSON.stringify(agentSettings(auth.language, auth.sampleRate)));
        keepalive = setInterval(() => {
          try {
            upstream?.send(JSON.stringify({ type: "KeepAlive" }));
          } catch {
            close();
          }
        }, 5000);
        return;
      }
      if (typeof event.data === "string") {
        if (event.data === "STOP") close();
        else close("LAB_CLIENT_MESSAGE_REJECTED");
        return;
      }
      if (!ready) return;
      if (!(event.data instanceof ArrayBuffer)) return close("LAB_AUDIO_FORMAT_REJECTED");
      bytes += event.data.byteLength;
      if ((event.data as ArrayBuffer).byteLength > 32768 || bytes > MAX_BYTES)
        return close("LAB_AUDIO_LIMIT");
      upstream.send(event.data);
    } catch {
      close("LAB_TRANSPORT_ERROR");
    }
  });
  return new Response(null, { status: 101, webSocket: client });
}
