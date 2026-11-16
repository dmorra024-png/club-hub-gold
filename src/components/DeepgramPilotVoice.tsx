import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { deepgramPilotCatalog } from "@/lib/deepgram-pilot.functions";
import { targetPath, type ConversationProposalValue } from "@/lib/snoop-conversation";
import type { DictationPhase } from "@/hooks/useWhisperDictation";

type Language = "it" | "es" | "en";
type Entry = { role: "user" | "assistant"; content: string };
type ProposalResult = { ok: boolean; proposal?: ConversationProposalValue; code?: string };
type AudioState = {
  ctx: AudioContext;
  stream: MediaStream;
  socket: WebSocket;
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
}: {
  onPhaseChange?: (phase: DictationPhase) => void;
}) {
  const navigate = useNavigate();
  const catalog = useServerFn(deepgramPilotCatalog);
  const audio = useRef<AudioState | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
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
      try { sound.stop(); } catch {}
    }
    state.sounds = [];
    state.playEnd = state.ctx.currentTime;
    setStatus("Parla ora per interrompere SNOOP");
  }, []);

  const stop = useCallback((reason = "Microfono spento") => {
    generation.current++;
    const state = audio.current;
    audio.current = null;
    if (state) {
      try { if (state.socket.readyState === WebSocket.OPEN) state.socket.send("STOP"); } catch {}
      try { state.socket.close(); } catch {}
      for (const sound of state.sounds) { try { sound.stop(); } catch {} }
      try { state.node.disconnect(); } catch {}
      try { state.source.disconnect(); } catch {}
      try { state.sink.disconnect(); } catch {}
      state.stream.getTracks().forEach((track) => track.stop());
      void state.ctx.close();
    }
    setStatus(reason);
    setRunning(false);
    onPhaseChange?.("idle");
  }, [onPhaseChange]);

  useEffect(() => {
    const handleToggle = () => setOpen((value) => !value);
    window.addEventListener("snoop:voice-toggle", handleToggle);
    return () => window.removeEventListener("snoop:voice-toggle", handleToggle);
  }, []);
  useEffect(() => {
    const onHidden = () => { if (document.hidden) stop(); };
    const onPageHide = () => stop();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      stop();
    };
  }, [stop]);
  useEffect(() => {
    if (!open && audio.current) stop();
  }, [open, stop]);

  const play = useCallback((data: ArrayBuffer) => {
    const state = audio.current;
    if (!state || state.suppressed || !data.byteLength) return;
    const length = Math.floor(data.byteLength / 2);
    const buffer = state.ctx.createBuffer(1, length, 24000);
    const pcm = buffer.getChannelData(0), view = new DataView(data);
    for (let i = 0; i < length; i++) pcm[i] = view.getInt16(i * 2, true) / 32768;
    const sound = state.ctx.createBufferSource();
    sound.buffer = buffer;
    sound.connect(state.ctx.destination);
    const at = Math.max(state.ctx.currentTime + 0.015, state.playEnd);
    state.playEnd = at + buffer.duration;
    state.sounds.push(sound);
    sound.onended = () => { state.sounds = state.sounds.filter((s) => s !== sound); };
    sound.start(at);
    setStatus("SNOOP sta parlando");
  }, []);

  const start = async () => {
    if (audio.current || !consent) return;
    const current = ++generation.current;
    let ctx: AudioContext | undefined;
    let stream: MediaStream | undefined;
    let socket: WebSocket | undefined;
    try {
      // Audio activation stays in the click event for mobile Safari.
      ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume();
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
      setVerifiedCount(names.categories.length);
      const { data: auth } = await supabase.auth.getSession();
      if (!auth.session?.access_token) throw Error("Sessione scaduta");
      if (![16000, 24000, 44100, 48000].includes(ctx.sampleRate))
        throw Error("Frequenza audio non supportata");
      const worklet = "class Capture extends AudioWorkletProcessor {process(inputs){const a=inputs[0]?.[0];if(a){this.v??=new Float32Array(2048);this.n??=0;for(const x of a){this.v[this.n++]=x;if(this.n===2048){const b=new ArrayBuffer(4096),d=new DataView(b);for(let i=0;i<2048;i++)d.setInt16(i*2,Math.max(-32768,Math.min(32767,this.v[i]*32768)),true);this.port.postMessage(b,[b]);this.n=0;}}}return true;}}registerProcessor('snoop-app-capture',Capture);";
      const blob = URL.createObjectURL(new Blob([worklet], { type: "application/javascript" }));
      try { await ctx.audioWorklet.addModule(blob); }
      finally { URL.revokeObjectURL(blob); }
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
      const target = (location.protocol === "https:" ? "wss://" : "ws://") +
        location.host + "/api/snoop-deepgram/socket";
      socket = new WebSocket(target);
      socket.binaryType = "arraybuffer";
      const state: AudioState = {
        ctx, stream, socket, node, source, sink, sounds: [],
        playEnd: 0, ready: false, suppressed: false,
      };
      audio.current = state;
      setLines([]);
      setProposal(null);
      setRunning(true);
      onPhaseChange?.("starting");
      socket.onopen = () => {
        if (generation.current !== current) return;
        socket?.send(JSON.stringify({
          type: "AppStart", token: auth.session?.access_token,
          consent: true, synthetic: true, language, sampleRate: ctx?.sampleRate,
        }));
      };
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (generation.current !== current || audio.current !== state || !state.ready ||
            socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128000) return;
        // Half duplex: never transcribe the agent's audio playback.
        if (state.ctx.currentTime < state.playEnd + 0.12) return;
        state.socket.send(event.data);
      };
      socket.onmessage = (event: MessageEvent) => {
        if (generation.current !== current) return;
        if (event.data instanceof ArrayBuffer) { play(event.data); return; }
        try {
          const message = JSON.parse(event.data);
          if (message.type === "AppReady") {
            state.ready = true;
            onPhaseChange?.("recording");
            setStatus("SNOOP ti ascolta · massimo 90 secondi");
          } else if (message.type === "ConversationText" &&
                     ["user", "assistant"].includes(message.role)) {
            setLines((prev) => [...prev, {
              role: message.role, content: String(message.content).slice(0, 1200),
            }].slice(-8));
          } else if (message.type === "UserStartedSpeaking") {
            state.suppressed = false;
            interrupt();
            state.suppressed = false;
            setStatus("Ti ascolto…");
          } else if (message.type === "AppProposal") {
            const result = message.result as ProposalResult;
            setProposal(result.ok ? result.proposal ?? null : null);
            if (!result.ok) setStatus(
              result.code === "SNOOP_UNKNOWN_CATEGORY"
                ? "Categoria non verificata: nessuna assegnazione"
                : "Proposta non autorizzata: nessun dato modificato",
            );
          } else if (message.type === "AppClosed") {
            stop("Sessione terminata: " + String(message.code || "STOP"));
          }
        } catch { stop("Risposta vocale non valida"); }
      };
      socket.onerror = () => stop("Connessione Deepgram non disponibile");
      socket.onclose = () => {
        if (generation.current === current) stop("Connessione chiusa, microfono spento");
      };
    } catch (error) {
      if (!audio.current) {
        stream?.getTracks().forEach((track) => track.stop());
        void ctx?.close();
        socket?.close();
      }
      if (generation.current === current) stop(
        error instanceof Error ? error.message : "Impossibile attivare SNOOP",
      );
    }
  };

  return open ? (
    <section role="dialog" aria-label="SNOOP JARVIS 3" style={{
      position: "fixed", left: 12, right: 12, bottom: 78, zIndex: 100,
      borderRadius: 18, padding: 18, background: "#0e1933", color: "#f7df9d",
      border: "1px solid #a98b4c", maxWidth: 520, margin: "0 auto",
      boxShadow: "0 14px 50px #0008",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>SNOOP · JARVIS 3</strong>
        <button type="button" onClick={() => { stop(); setOpen(false); }}
          aria-label="Chiudi assistente">✕</button>
      </div>
      <p role="status">{status}</p>
      <label>Lingua{" "}
        <select value={language} disabled={running}
          onChange={(event) => setLanguage(event.target.value as Language)}>
          <option value="es">Español</option>
          <option value="it">Italiano</option>
          <option value="en">English</option>
        </select>
      </label>
      <p style={{ fontSize: 12 }}>
        Prova riservata all'amministratore. Invii audio di prova e solo nomi di
        categorie/prodotti a Deepgram. Non pronunciare dati personali reali.
        Sessione massima 90 s; servizio a consumo.
      </p>
      <label style={{ display: "flex", gap: 8 }}>
        <input type="checkbox" checked={consent} disabled={running}
          onChange={(e) => setConsent(e.target.checked)} />
        Acconsento al test vocale con dati fittizi.
      </label>
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button type="button" disabled={running || !consent}
          onClick={() => void start()}>Avvia JARVIS</button>
        <button type="button" disabled={!running} onClick={() => stop()}>Ferma</button>
        <button type="button" disabled={!running} onClick={interrupt}>Interrompi</button>
      </div>
      {verifiedCount !== null && <p>Categorie verificate: {verifiedCount}</p>}
      <div aria-live="polite" style={{ maxHeight: 140, overflow: "auto" }}>
        {lines.map((line, i) => (
          <p key={i} style={{ fontSize: 13 }}>
            <b>{line.role === "user" ? "Tu" : "SNOOP"}:</b> {line.content}
          </p>
        ))}
      </div>
      {proposal && (
        <div>
          <p>Bozza proposta (nessun dato salvato): {proposal.product?.name || proposal.member?.first_name || proposal.question || proposal.target}</p>
          {proposal.target && (
            <button type="button" onClick={() => {
              const target = targetPath[proposal.target!];
              if (target) { stop(); setOpen(false); void navigate({ to: target as any }); }
            }}>
              Apri sezione proposta
            </button>
          )}
        </div>
      )}
    </section>
  ) : null;
}
