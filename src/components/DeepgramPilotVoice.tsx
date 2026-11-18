import { VoiceTransport } from "@/lib/voice/transport";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { deepgramPilotCatalog } from "@/lib/deepgram-pilot.functions";
import { type ConversationProposalValue } from "@/lib/snoop-conversation";
import type { DictationPhase } from "@/hooks/useWhisperDictation";

import { applyDeepgramDraft } from "@/lib/deepgram-draft-actions";
import { voiceOwner } from "@/lib/voice/application-ports";
import type { AccountAccess } from "@/lib/access-context";

type Language = "it" | "es" | "en";
type Entry = { role: "user" | "assistant"; content: string };
type ProposalResult = { ok: boolean; proposal?: ConversationProposalValue; code?: string };
type AudioState = {
  ctx: AudioContext;
  stream: MediaStream;
  transport: VoiceTransport;
  node: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
  sink: GainNode;
  sounds: AudioBufferSourceNode[];
  playEnd: number;
  ready: boolean;
  suppressed: boolean;
};

export function DeepgramPilotVoice({
  onPhaseChange,
  access,
}: {
  access: AccountAccess;
  onPhaseChange?: (phase: DictationPhase) => void;
}) {
  const navigate = useNavigate();
  const path = useLocation().pathname;
  const pathRef = useRef(path);
  pathRef.current = path;
  const accessRef = useRef(access);
  accessRef.current = access;
  const starting = useRef(false);
  const voiceValues = useRef<Record<string, Record<string, string>>>({});
  const utterancePath = useRef(path);
  const applying = useRef(false);
  const resumeRef = useRef<string | undefined>(undefined);
  const [usage, setUsage] = useState<{
    remainingSeconds: number;
    estimatedMicrousd: number | null;
  } | null>(null);
  const catalog = useServerFn(deepgramPilotCatalog);
  const audio = useRef<AudioState | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [audioSuspended, setAudioSuspended] = useState(false);
  const [status, setStatus] = useState("Pronto");
  const [language, setLanguage] = useState<Language>("es");
  const [consent, setConsent] = useState(false);
  const [lines, setLines] = useState<Entry[]>([]);
  const [proposal, setProposal] = useState<ConversationProposalValue | null>(null);
  const [verifiedCount, setVerifiedCount] = useState<number | null>(null);

  const interrupt = useCallback(() => {
    const state = audio.current;
    if (!state) return;
    state.suppressed = true;
    for (const sound of state.sounds) {
      try {
        sound.stop();
      } catch {}
    }
    state.sounds = [];
    state.playEnd = state.ctx.currentTime;
    setStatus("Parla ora per interrompere SNOOP");
  }, []);

  const stop = useCallback(
    (reason = "Microfono spento", preserveContext = false) => {
      generation.current++;
      starting.current = false;
      if (!preserveContext) {
        voiceValues.current = {};
        resumeRef.current = undefined;
      }
      setLines([]);
      setProposal(null);
      const state = audio.current;
      audio.current = null;
      if (state) {
        resumeRef.current = preserveContext ? state.transport.checkpoint : undefined;
        state.transport.stop();
        for (const sound of state.sounds) {
          try {
            sound.stop();
          } catch {}
        }
        try {
          state.node.disconnect();
        } catch {}
        try {
          state.source.disconnect();
        } catch {}
        try {
          state.sink.disconnect();
        } catch {}
        state.stream.getTracks().forEach((track) => track.stop());
        void state.ctx.close();
      }
      setStatus(reason);
      setRunning(false);
      setAudioSuspended(false);
      onPhaseChange?.("idle");
    },
    [onPhaseChange],
  );

  useEffect(() => {
    const handleToggle = () => setOpen((value) => !value);
    window.addEventListener("snoop:voice-toggle", handleToggle);
    return () => window.removeEventListener("snoop:voice-toggle", handleToggle);
  }, []);
  useEffect(() => {
    const onHidden = () => {
      if (document.hidden) stop("Micrófono pausado en segundo plano", true);
    };
    const onPageHide = () => stop("Micrófono pausado", true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      stop();
    };
  }, [stop]);
  useEffect(() => {
    if (!open && (audio.current || starting.current)) stop();
  }, [open, stop]);

  const play = useCallback((data: ArrayBuffer) => {
    const state = audio.current;
    if (!state || state.suppressed || !data.byteLength) return;
    const length = Math.floor(data.byteLength / 2);
    const buffer = state.ctx.createBuffer(1, length, 24000);
    const pcm = buffer.getChannelData(0),
      view = new DataView(data);
    for (let i = 0; i < length; i++) pcm[i] = view.getInt16(i * 2, true) / 32768;
    const sound = state.ctx.createBufferSource();
    sound.buffer = buffer;
    sound.connect(state.ctx.destination);
    const at = Math.max(state.ctx.currentTime + 0.015, state.playEnd);
    state.playEnd = at + buffer.duration;
    state.sounds.push(sound);
    sound.onended = () => {
      state.sounds = state.sounds.filter((s) => s !== sound);
      if (audio.current === state && state.sounds.length === 0 && state.ready)
        setStatus("SNOOP ti ascolta");
    };
    sound.start(at);
    setStatus("SNOOP sta parlando");
  }, []);

  const start = async () => {
    if (audio.current || starting.current || !consent) return;
    starting.current = true;
    setRunning(true);
    const current = ++generation.current;
    let ctx: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let transport: VoiceTransport | undefined;
    try {
      // Audio activation stays in the click event for mobile Safari.
      ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
      ctx.onstatechange = () => {
        if (audio.current?.ctx !== ctx) return;
        const paused = ctx?.state === "suspended" || (ctx?.state as string) === "interrupted";
        setAudioSuspended(paused);
        if (paused) setStatus("Audio sospeso dal dispositivo. Tocca Riattiva audio.");
      };
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (generation.current !== current) {
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close();
        return;
      }
      setStatus("Verificando sessione SNOOP…");
      // This call also verifies current club scope and the consented vocabulary.
      const names = await catalog({ data: { consent: true } });
      if (generation.current !== current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        return;
      }
      setVerifiedCount(names.categories.length);
      const { data: auth } = await supabase.auth.getSession();
      if (generation.current !== current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
        return;
      }
      if (!auth.session?.access_token) throw Error("Sessione scaduta");
      if (![16000, 24000, 44100, 48000].includes(ctx.sampleRate))
        throw Error("Frequenza audio non supportata");
      const worklet =
        "class Capture extends AudioWorkletProcessor {process(inputs){const a=inputs[0]?.[0];if(a){this.v??=new Float32Array(2048);this.n??=0;for(const x of a){this.v[this.n++]=x;if(this.n===2048){const b=new ArrayBuffer(4096),d=new DataView(b);for(let i=0;i<2048;i++)d.setInt16(i*2,Math.max(-32768,Math.min(32767,this.v[i]*32768)),true);this.port.postMessage(b,[b]);this.n=0;}}}return true;}}registerProcessor('snoop-app-capture',Capture);";
      const blob = URL.createObjectURL(new Blob([worklet], { type: "application/javascript" }));
      try {
        await ctx.audioWorklet.addModule(blob);
      } finally {
        URL.revokeObjectURL(blob);
      }
      if (generation.current !== current) {
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close();
        return;
      }
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "snoop-app-capture");
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      const target =
        (location.protocol === "https:" ? "wss://" : "ws://") +
        location.host +
        "/api/snoop-deepgram/socket";
      const state: AudioState = {
        ctx,
        stream,
        transport: null as unknown as VoiceTransport,
        node,
        source,
        sink,
        sounds: [],
        playEnd: 0,
        ready: false,
        suppressed: false,
      };
      audio.current = state;
      stream.getTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (generation.current === current) stop("Permesso microfono terminato");
        }),
      );
      setLines([]);
      setProposal(null);
      setRunning(true);
      onPhaseChange?.("starting");
      const supportsEchoCancellation =
        stream.getAudioTracks()[0]?.getSettings?.().echoCancellation === true;
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (generation.current !== current || audio.current !== state) return;
        // Native acoustic echo cancellation permits provider-side spoken interruption.
        // On devices that do not confirm AEC support, retain the safe manual fallback.
        if (!supportsEchoCancellation && state.ctx.currentTime < state.playEnd + 0.12) return;
        state.transport.capture(event.data);
      };
      let actionQueue = Promise.resolve();
      const receive = async (message: any) => {
        if (generation.current !== current) return;
        try {
          if (message.type === "AppUsage") {
            const u = message.usage;
            if (Number.isFinite(u?.remainingSeconds) && u.remainingSeconds >= 0)
              setUsage({
                remainingSeconds: u.remainingSeconds,
                estimatedMicrousd: Number.isFinite(u.estimatedMicrousd)
                  ? u.estimatedMicrousd
                  : null,
              });
          } else if (message.type === "AppReady") {
            state.ready = true;
            state.suppressed = false;
            onPhaseChange?.("recording");
            setStatus(
              supportsEchoCancellation
                ? "SNOOP ti ascolta · interruzione vocale attiva"
                : "SNOOP ti ascolta · per interrompere usa Interrompi",
            );
          } else if (
            message.type === "ConversationText" &&
            ["user", "assistant"].includes(message.role)
          ) {
            setLines((prev) =>
              [
                ...prev,
                {
                  role: message.role,
                  content: String(message.content).slice(0, 1200),
                },
              ].slice(-8),
            );
          } else if (message.type === "UserStartedSpeaking") {
            utterancePath.current = pathRef.current;
            interrupt();
            setStatus("Ti ascolto…");
          } else if (message.type === "AgentStartedSpeaking") {
            // Deepgram can begin the next audio response without an AgentThinking event.
            // A previous interruption must suppress the old response, not all future speech.
            state.suppressed = false;
            setStatus("SNOOP sta parlando");
          } else if (message.type === "AgentThinking") {
            state.suppressed = false;
            setStatus("SNOOP sta elaborando…");
          } else if (message.type === "AppProposal") {
            const result = message.result as ProposalResult;
            if (!result.ok || !result.proposal) {
              setStatus("Proposta rifiutata dai controlli SNOOP. Nessun dato modificato.");
              return;
            }
            if (result.proposal.intent === "stop") {
              stop();
              setOpen(false);
              return;
            }
            if (applying.current || pathRef.current !== utterancePath.current) {
              if (message.id)
                state.transport.send({
                  type: "AppActionResult",
                  id: message.id,
                  status: "rejected",
                  code: "STALE",
                  applied: [],
                  skipped: [],
                });
              setStatus("Pagina cambiata. Ripeti il comando.");
              return;
            }
            applying.current = true;
            try {
              const applied = await applyDeepgramDraft(result.proposal, {
                access: accessRef.current,
                owner: voiceOwner(auth.session!.user.id, accessRef.current.clubId!),
                path: () => pathRef.current,
                current: () => generation.current === current && audio.current === state,
                navigate: async (to) => {
                  await navigate({ to: to as any });
                  utterancePath.current = to;
                },
                last: voiceValues.current,
                reportDay: message.cashDay,
              });
              if (message.id)
                state.transport.send({
                  type: "AppActionResult",
                  id: message.id,
                  status:
                    applied.proposal.intent === "navigate" || applied.proposal.intent === "search"
                      ? "opened"
                      : "prepared",
                  applied: applied.applied,
                  skipped: applied.skipped,
                  code: applied.skipped.length ? "MANUAL_EDIT_PRESERVED" : "OK",
                });
              setProposal(applied.proposal);
              setStatus(
                applied.skipped.length
                  ? "Conservo le modifiche manuali. Verifica la bozza."
                  : "Bozza compilata. Conferma con il pulsante del modulo: niente salvato.",
              );
            } catch {
              if (message.id)
                state.transport.send({
                  type: "AppActionResult",
                  id: message.id,
                  status: "rejected",
                  applied: [],
                  skipped: [],
                  code: "FORM_UNAVAILABLE",
                });
              setStatus("Impossibile preparare il modulo. Nessun dato salvato.");
            } finally {
              applying.current = false;
            }
          } else if (message.type === "AppCashResult") {
            if (Number.isSafeInteger(message.summary?.cents))
              setStatus(
                `${message.summary.day}: ${(message.summary.cents / 100).toFixed(2)} € · ${message.summary.scope === "club" ? "club" : "tu actividad"}`,
              );
          } else if (message.type === "AppError") {
            stop("Deepgram: " + String(message.code || "PROVIDER_ERROR").slice(0, 80));
          } else if (message.type === "AppClosed") {
            stop("Sessione terminata: " + String(message.code || "STOP"));
          }
        } catch {
          stop("Risposta vocale non valida");
        }
      };
      transport = new VoiceTransport({
        url: target,
        sampleRate: ctx.sampleRate,
        resume: resumeRef.current,
        foreground: () => !document.hidden && generation.current === current,
        payload: async () => {
          const { data } = await supabase.auth.getSession();
          if (!data.session || data.session.user.id !== auth.session!.user.id)
            throw Error("SESSION_EXPIRED");
          return {
            type: "AppStart",
            token: data.session.access_token,
            consent: true,
            synthetic: true,
            language,
            sampleRate: state.ctx.sampleRate,
          };
        },
        binary: play,
        message: (m) => {
          if ((m as any)?.type === "AppProposal")
            actionQueue = actionQueue
              .then(() => receive(m))
              .catch(() => stop("Azione vocale interrotta"));
          else void receive(m);
        },
        phase: (phase) => {
          if (generation.current !== current) return;
          if (phase === "paused") {
            interrupt();
            setStatus("SNOOP en espera · micrófono local · sin conexión de pago");
          }
          if (phase === "reconnecting") setStatus("Reconectando SNOOP · conservo la conversación");
        },
        fatal: (code) => stop("SNOOP: " + code),
      });
      state.transport = transport;
      await transport.start();
    } catch (error) {
      if (!audio.current) {
        stream?.getTracks().forEach((track) => track.stop());
        void ctx?.close();
        transport?.stop();
      }
      if (generation.current === current)
        stop(error instanceof Error ? error.message : "Impossibile attivare SNOOP");
    } finally {
      if (generation.current === current) starting.current = false;
    }
  };

  return open ? (
    <section
      role="dialog"
      aria-label="SNOOP JARVIS 3"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: 78,
        zIndex: 100,
        borderRadius: 18,
        padding: running ? 12 : 18,
        background: "#0e1933",
        color: "#f7df9d",
        border: "1px solid #a98b4c",
        maxHeight: "70dvh",
        overflowY: "auto",
        maxWidth: 520,
        margin: "0 auto",
        boxShadow: "0 14px 50px #0008",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: running ? 13 : undefined }}>SNOOP · JARVIS 3</strong>
        <button
          type="button"
          onClick={() => {
            stop();
            setOpen(false);
          }}
          aria-label="Chiudi assistente"
        >
          ✕
        </button>
      </div>
      <p
        role="status"
        style={running ? { fontSize: 12, margin: "4px 0", lineHeight: 1.3 } : undefined}
      >
        {status}
      </p>
      <div hidden={running}>
        <label>
          Lingua{" "}
          <select
            value={language}
            disabled={running}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="es">Español</option>
            <option value="it">Italiano</option>
            <option value="en">English</option>
          </select>
        </label>
        <p style={{ fontSize: 12 }}>
          Deepgram procesa tu voz. No dictes datos personales reales sin la aprobación de
          privacidad. Los cambios se revisan antes de guardar.
        </p>
        <label style={{ display: "flex", gap: 8 }}>
          <input
            type="checkbox"
            checked={consent}
            disabled={running}
            onChange={(e) => setConsent(e.target.checked)}
          />
          Acepto el procesamiento de voz; uso datos ficticios al tratar datos de personas.
        </label>
      </div>
      {running && (
        <p style={{ fontSize: 11, margin: "4px 0" }}>
          Revisión antes de guardar · pausa automática cuando no se utiliza
        </p>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        {running && audioSuspended && (
          <button
            type="button"
            onClick={() => {
              void audio.current?.ctx
                .resume()
                .then(() => {
                  setAudioSuspended(false);
                  setStatus("SNOOP ti ascolta");
                })
                .catch(() => setStatus("Audio bloccato dal dispositivo. Ferma e riavvia SNOOP."));
            }}
          >
            Riattiva audio
          </button>
        )}
        {!running && (
          <button type="button" disabled={!consent} onClick={() => void start()}>
            Avvia JARVIS
          </button>
        )}
        <button type="button" disabled={!running} onClick={() => stop()}>
          Ferma
        </button>
        <button type="button" disabled={!running} onClick={interrupt}>
          Interrompi
        </button>
      </div>
      {usage && (
        <p style={{ fontSize: 11 }}>
          Voz disponible: {(usage.remainingSeconds / 60).toFixed(1)} min ·{" "}
          {usage.estimatedMicrousd === null
            ? "coste pendiente de tarifa verificada"
            : `estimación ${(usage.estimatedMicrousd / 1000000).toFixed(2)} USD`}
        </p>
      )}
      {!running && verifiedCount !== null && <p>Categorie verificate: {verifiedCount}</p>}
      <div aria-live="polite" style={{ maxHeight: running ? 44 : 140, overflow: "auto" }}>
        {(running ? lines.slice(-1) : lines).map((line, i) => (
          <p key={i} style={{ fontSize: 13, margin: running ? 0 : undefined }}>
            <b>{line.role === "user" ? "Tu" : "SNOOP"}:</b> {line.content}
          </p>
        ))}
      </div>
      {proposal && !running && (
        <div>
          <p>
            Bozza proposta (nessun dato salvato):{" "}
            {proposal.product?.name ||
              proposal.member?.first_name ||
              proposal.question ||
              proposal.target}
          </p>
          <small>Le modifiche rimangono nel modulo. Nessun salvataggio automatico.</small>
        </div>
      )}
    </section>
  ) : null;
}
