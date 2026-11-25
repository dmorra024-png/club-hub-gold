import { pendingExecution } from "@/lib/voice/pending-execution";
import { getClubTheme } from "@/lib/club-theme-storage";
import {
  CaptureHealth,
  ServerAudioHealth,
  type ServerAudioHealthValue,
} from "@/lib/voice/audio-health";
import { PcmPlayback } from "@/lib/voice/pcm-playback";
import { VoiceTransport } from "@/lib/voice/transport";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { deepgramPilotCatalog } from "@/lib/deepgram-pilot.functions";
import { type ConversationProposalValue } from "@/lib/snoop-conversation";
import type { DictationPhase } from "@/hooks/useWhisperDictation";

import { applyDeepgramDraft } from "@/lib/deepgram-draft-actions";
import { applicationPorts, voiceOwner } from "@/lib/voice/application-ports";
import type { AccountAccess } from "@/lib/access-context";
import { RECORDS_CHANGED } from "@/components/FinancialRecordDialog";
import { voiceGeneticsSource } from "@/lib/voice/source-links";

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
  speaker: PcmPlayback;
  ready: boolean;
  captureHealth: CaptureHealth;
  serverHealth: ServerAudioHealthValue | null;
  healthTimer?: ReturnType<typeof setInterval>;
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
  const providerTurn = useRef<number | null>(null);
  const applying = useRef(false);
  const resumeRef = useRef<string | undefined>(undefined);
  const [usage, setUsage] = useState<{
    remainingSeconds: number;
    estimatedMicrousd: number | null;
  } | null>(null);
  const catalog = useServerFn(deepgramPilotCatalog);
  const audio = useRef<AudioState | null>(null);
  const activatingContext = useRef<AudioContext | null>(null);
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  expandedRef.current = expanded;
  const [running, setRunning] = useState(false);
  const [audioSuspended, setAudioSuspended] = useState(false);
  const [audioDiagnostic, setAudioDiagnostic] = useState<
    | (ReturnType<PcmPlayback["snapshot"]> & {
        microphoneLive: boolean;
        providerReady: boolean;
        connection: ReturnType<VoiceTransport["diagnostics"]>;
        input: ReturnType<CaptureHealth["snapshot"]>;
        server: ServerAudioHealthValue | null;
      })
    | null
  >(null);
  const [privateRecords, setPrivateRecords] = useState<Array<Record<string, unknown>>>([]);
  const [execution, setExecution] = useState<{
    id: string;
    token: string;
    enabled?: boolean;
    summary?: Record<string, unknown>;
    attested?: boolean;
    busy?: boolean;
    uncertain?: boolean;
  } | null>(null);
  const [status, setStatus] = useState("Pronto");
  const [language, setLanguage] = useState<Language>("es");
  const [consent, setConsent] = useState(false);
  const [lines, setLines] = useState<Entry[]>([]);
  const [proposal, setProposal] = useState<ConversationProposalValue | null>(null);
  const [citations, setCitations] = useState<{ name: string; sources: string[] } | null>(null);
  const [verifiedCount, setVerifiedCount] = useState<number | null>(null);

  const interrupt = useCallback(() => {
    const state = audio.current;
    if (!state) return;
    state.speaker.interrupt();
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
      setExpanded(false);
      setAudioDiagnostic(null);
      setLines([]);
      setProposal(null);
      setExecution(null);
      setPrivateRecords([]);
      setCitations(null);
      const state = audio.current;
      const pending = activatingContext.current;
      activatingContext.current = null;
      if (pending && pending !== state?.ctx) void pending.close().catch(() => {});
      audio.current = null;
      if (state) {
        resumeRef.current = preserveContext ? state.transport.checkpoint : undefined;
        clearInterval(state.healthTimer);
        state.node.port.onmessage = null;
        state.node.onprocessorerror = null;
        state.transport.stop();
        state.speaker.dispose();
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
        void state.ctx.close().catch(() => {});
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
    if (!state) return;
    state.speaker.push(data);
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
      activatingContext.current = ctx;
      // Both activation requests belong to this gesture. Waiting for resume can
      // deadlock Safari before the microphone permission that unlocks its audio session.
      void ctx.resume().catch(() => {
        if (generation.current === current) {
          setAudioSuspended(true);
          setStatus("Audio bloccato dal dispositivo. Tocca Riattiva audio.");
        }
      });
      ctx.onstatechange = () => {
        if (audio.current?.ctx !== ctx) return;
        const paused = ctx?.state === "suspended" || (ctx?.state as string) === "interrupted";
        setAudioSuspended(paused);
        audio.current?.speaker.contextChanged();
        if (paused) setStatus("Audio sospeso dal dispositivo. Tocca Riattiva audio.");
      };
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (generation.current !== current) {
        stream.getTracks().forEach((track) => track.stop());
        void ctx.close().catch(() => {});
        return;
      }
      setStatus("Verificando sessione SNOOP…");
      // This call also verifies current club scope and the consented vocabulary.
      const names = await catalog({ data: { consent: true } });
      if (generation.current !== current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
        return;
      }
      setVerifiedCount(names.categories.length);
      const { data: auth } = await supabase.auth.getSession();
      if (generation.current !== current) {
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
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
        void ctx.close().catch(() => {});
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
        speaker: new PcmPlayback(ctx, (notice) => {
          if (generation.current !== current) return;
          if (notice === "blocked") {
            setAudioSuspended(true);
            setStatus("Audio sospeso dal dispositivo. Tocca Riattiva audio.");
          } else if (notice === "playing") {
            setAudioSuspended(false);
            setStatus("SNOOP sta parlando");
          } else if (notice === "idle") setStatus("SNOOP ti ascolta");
          else
            setStatus(
              "Audio non riprodotto: " +
                {
                  overflow: "buffer pieno",
                  invalid: "formato non valido",
                  empty: "Deepgram non ha inviato audio",
                  silent: "Deepgram ha inviato audio senza segnale",
                }[notice],
            );
        }),
        ready: false,
        captureHealth: new CaptureHealth(),
        serverHealth: null,
      };
      audio.current = state;
      if (activatingContext.current === ctx) activatingContext.current = null;
      state.speaker.contextChanged();
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
        if (!state.captureHealth.record(event.data)) return;
        // Native acoustic echo cancellation permits provider-side spoken interruption.
        // On devices that do not confirm AEC support, retain the safe manual fallback.
        if (!supportsEchoCancellation && state.ctx.currentTime < state.speaker.playUntil + 0.12)
          return;
        state.transport.capture(event.data);
      };
      let actionQueue = Promise.resolve();
      const receive = async (message: any) => {
        if (generation.current !== current) return;
        try {
          if (message.type === "AppPrivateRecords" && Array.isArray(message.rows)) {
            setPrivateRecords(message.rows.slice(0, 6));
            setExpanded(true);
            setStatus(
              message.rows.length
                ? "Registros autorizados encontrados."
                : "No hay registros coincidentes.",
            );
          } else if (
            message.type === "AppAccessControlStatus" &&
            typeof message.enabled === "boolean"
          ) {
            setStatus(
              message.enabled ? "Controllo entrate attivo." : "Controllo entrate disattivato.",
            );
          } else if (message.type === "AppInspectionResult") {
            if (message.kind === "stock_locations")
              setStatus(
                `Almacén: ${String(message.summary.almacen)} · Stock: ${String(message.summary.dispensario)} · Total: ${String(message.summary.total)} ${message.summary.unit_type === "gr" ? "g" : "uds."}`,
              );
            else if (message.kind === "wallet_balance")
              setStatus(
                message.summary?.enabled && Number.isSafeInteger(message.summary.balanceCents)
                  ? `Saldo: ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(message.summary.balanceCents / 100)}`
                  : "Monedero no disponible para este socio.",
              );
            else if (
              message.kind === "cash_session" &&
              Number.isSafeInteger(message.summary?.recordedCents)
            )
              setStatus(
                `Ingresos de la sesión: ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(message.summary.recordedCents / 100)}. Fondo inicial separado.`,
              );
            else
              setStatus(
                `Consulta verificada: ${Array.isArray(message.summary?.records) ? message.summary.records.length : (message.summary?.count ?? 0)} registros.`,
              );
            if (
              message.kind === "member_history" &&
              Number.isInteger(message.turn) &&
              message.turn === providerTurn.current &&
              pathRef.current === utterancePath.current &&
              typeof message.destination?.memberId === "string"
            ) {
              await navigate({ to: "/soci/$id", params: { id: message.destination.memberId } });
              const owner = voiceOwner(auth.session!.user.id, accessRef.current.clubId!);
              const port = await applicationPorts.wait(
                owner,
                "member.sections",
                () => generation.current === current && accessRef.current.status === "active",
              );
              port.open?.("history");
            }
          } else if (message.type === "AppExecutionRejected") {
            setStatus(
              (
                {
                  VOICE_RECEIPT_CONFIRMATION_REQUIRED:
                    "Confirma que la recarga ya se ha cobrado antes de añadir créditos.",
                  VOICE_HUMAN_DOCUMENTS_REQUIRED:
                    "Completa documento y firma en el formulario existente. No se ha guardado nada.",
                  VOICE_AVALADOR_REQUIRED: "Selecciona un socio avalador existente del club.",
                  VOICE_DUAL_STOCK_REVIEW_REQUIRED:
                    "La rectificación por ubicación requiere el flujo actual Almacén/Dispensario. No se ha modificado stock.",
                  VOICE_LOCATION_CONFIRMATION_REQUIRED:
                    "Indica Almacén o Dispensario para la ficha del producto.",
                  VOICE_LEGACY_PRICE_UNSUPPORTED:
                    "La función de catálogo necesita verificación de precios decimales. No se ha cambiado ningún precio.",
                  VOICE_REQUIRED_FIELD: "Faltan campos obligatorios del club.",
                  VOICE_STATE_CHANGED: "Los datos han cambiado. Revisa una nueva propuesta.",
                  VOICE_REFERENCE_NOT_FOUND: "El registro no está disponible en este club.",
                  VOICE_WALLET_UNAVAILABLE: "Monedero no habilitado o socio no autorizado.",
                  VOICE_CASH_ALREADY_OPEN: "Ya tienes una caja abierta.",
                  VOICE_WHOLE_UNITS_REQUIRED: "Este producto requiere unidades enteras.",
                  VOICE_INSUFFICIENT_STOCK: "La rectificación dejaría existencias negativas.",
                  VOICE_WALLET_CREDITS_USED:
                    "Los créditos ya se han utilizado. Requiere conciliación administrativa.",
                  VOICE_DUPLICATE_NAME: "Ya existe un registro con ese nombre.",
                } as Record<string, string>
              )[String(message.code)] ?? "Operación no disponible. No se ha guardado nada.",
            );
          } else if (message.type === "AppExecutionPrepared") {
            if (
              typeof message.id === "string" &&
              typeof message.token === "string" &&
              (typeof message.enabled === "boolean" || typeof message.summary?.label === "string")
            ) {
              pendingExecution(
                window.sessionStorage,
                voiceOwner(auth.session!.user.id, accessRef.current.clubId!),
              ).save(message.id);
              setExecution({
                id: message.id,
                token: message.token,
                enabled: message.enabled,
                summary: message.summary,
              });
              setExpanded(true);
            }
          } else if (message.type === "AppExecutionExpired") {
            setExecution(null);
            setStatus("Conferma scaduta. Nessuna modifica eseguita.");
          } else if (message.type === "AppExecutionCancelRequested") {
            setExpanded(true);
            setStatus("Premi Annulla proposta per cancellare la modifica non confermata.");
          } else if (message.type === "AppExecutionResult") {
            if (
              ["completed", "cancelled"].includes(message.status) &&
              typeof message.id === "string"
            )
              pendingExecution(
                window.sessionStorage,
                voiceOwner(auth.session!.user.id, accessRef.current.clubId!),
              ).clear(message.id);
            setStatus(
              message.status === "completed"
                ? "Operazione completata e verificata dal server."
                : message.status === "cancelled"
                  ? "Proposta annullata. Nessuna operazione eseguita."
                  : message.status === "confirmation_required"
                    ? "Il server non registra un completamento. Richiedi una nuova conferma."
                    : "Esito incerto. Non ripetere: verifica lo stato dell'operazione.",
            );
            setExecution((current) =>
              ["completed", "confirmation_required", "cancelled"].includes(message.status)
                ? null
                : current
                  ? { ...current, busy: false, uncertain: message.status === "uncertain" }
                  : null,
            );
            if (
              message.status === "completed" &&
              typeof message.action === "string" &&
              auth.session?.user.id &&
              accessRef.current.clubId
            ) {
              const owner = voiceOwner(auth.session.user.id, accessRef.current.clubId);
              if (message.action === "theme.set") {
                try {
                  const clubId = accessRef.current.clubId;
                  const themeId = await getClubTheme(clubId);
                  if (generation.current === current && accessRef.current.clubId === clubId)
                    window.dispatchEvent(
                      new CustomEvent("snoop:club-theme-changed", { detail: { clubId, themeId } }),
                    );
                } catch {
                  setStatus("Tema salvato. Aggiorna la vista per ricaricare la palette.");
                }
              }
              const port =
                message.action.startsWith("category.") ||
                message.action.startsWith("product.") ||
                message.action.startsWith("stock.")
                  ? "products.page"
                  : message.action.startsWith("fee.")
                    ? "admin.membership_fee"
                    : message.action.startsWith("member.")
                      ? "member.sections"
                      : message.action.startsWith("cash.")
                        ? "cash.page"
                        : message.action.startsWith("finance.")
                          ? "finance.page"
                          : null;
              if (port) {
                try {
                  await applicationPorts.get(owner, port)?.refresh?.();
                } catch {
                  setStatus("Operazione salvata. Aggiorna la vista per leggere i dati.");
                }
              }
              if (
                message.action.startsWith("cash.") ||
                message.action.startsWith("wallet.") ||
                message.action === "member.renew" ||
                message.action === "member.create"
              )
                window.dispatchEvent(new Event(RECORDS_CHANGED));
            }
          } else if (message.type === "AppAudioHealth") {
            const parsed = ServerAudioHealth.safeParse(message);
            if (parsed.success) state.serverHealth = parsed.data;
          } else if (message.type === "AppUsage") {
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
            const oldRequest = pendingExecution(
              window.sessionStorage,
              voiceOwner(auth.session!.user.id, accessRef.current.clubId!),
            ).read();
            if (oldRequest) state.transport.send({ type: "AppExecutionRecover", id: oldRequest });
            state.speaker.beginResponse();
            if (state.ctx.state !== "running") {
              state.speaker.contextChanged();
              return;
            }
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
            providerTurn.current = Number.isInteger(message.turn) ? message.turn : null;
            utterancePath.current = pathRef.current;
            interrupt();
            setStatus("Ti ascolto…");
          } else if (message.type === "AgentStartedSpeaking") {
            // Deepgram can begin the next audio response without an AgentThinking event.
            // A previous interruption must suppress the old response, not all future speech.
            state.speaker.beginResponse();
            if (state.ctx.state !== "running") {
              setAudioSuspended(true);
              setStatus("Audio sospeso dal dispositivo. Tocca Riattiva audio.");
            }
          } else if (message.type === "AgentThinking") {
            state.speaker.beginResponse();
            setStatus("SNOOP sta elaborando…");
          } else if (message.type === "AgentAudioDone") {
            state.speaker.finishResponse();
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
                    applied.proposal.intent === "review"
                      ? "confirmation_required"
                      : ["navigate", "search", "member_section"].includes(applied.proposal.intent)
                        ? "opened"
                        : "prepared",
                  applied: applied.applied,
                  skipped: applied.skipped,
                  code: applied.skipped.length
                    ? "MANUAL_EDIT_PRESERVED"
                    : applied.proposal.intent === "review"
                      ? "CONFIRMATION_REQUIRED"
                      : "OK",
                });
              setProposal(applied.proposal);
              setStatus(
                applied.skipped.length
                  ? "Conservo le modifiche manuali. Verifica la bozza."
                  : applied.proposal.intent === "review"
                    ? "Rivedi i dati e conferma dal modulo. Nessun dato salvato."
                    : ["navigate", "search", "member_section"].includes(applied.proposal.intent)
                      ? "Sezione aperta. Nessun dato salvato."
                      : "Bozza compilata. Conferma con il pulsante del modulo: niente salvato.",
              );
            } catch (error) {
              const reason = error instanceof Error ? error.message : "";
              const reference =
                reason === "SNOOP_MEMBERSHIP_FEE_NOT_FOUND"
                  ? "REFERENCE_NOT_FOUND"
                  : reason === "SNOOP_MEMBERSHIP_FEE_AMBIGUOUS"
                    ? "AMBIGUOUS_REFERENCE"
                    : reason === "SNOOP_MEMBER_FIELD_DISABLED"
                      ? "FIELD_DISABLED"
                      : "FORM_UNAVAILABLE";
              if (message.id)
                state.transport.send({
                  type: "AppActionResult",
                  id: message.id,
                  status: "rejected",
                  applied: [],
                  skipped: [],
                  code: reference,
                });
              setStatus(
                reference === "REFERENCE_NOT_FOUND"
                  ? "Quota non trovata nel club. Indica il nome di una quota esistente. Nessun campo modificato."
                  : reference === "AMBIGUOUS_REFERENCE"
                    ? "Più quote hanno questo nome. Seleziona quella corretta nel modulo. Nessun campo modificato."
                    : reference === "FIELD_DISABLED"
                      ? "Il club ha disabilitato uno dei campi richiesti. Nessun campo modificato."
                      : error instanceof Error &&
                          error.message === "SNOOP_FORM_UNAVAILABLE_MEMBER_CARD"
                        ? "Apri la scheda del socio prima di modificarla. Nessun dato salvato."
                        : "Impossibile preparare il modulo. Nessun dato salvato.",
              );
            } finally {
              applying.current = false;
            }
          } else if (message.type === "AppCashResult") {
            if (Number.isSafeInteger(message.summary?.cents))
              setStatus(
                `${message.summary.day}: ${(message.summary.cents / 100).toFixed(2)} € · ${message.summary.scope === "club" ? "club" : "tu actividad"}`,
              );
          } else if (message.type === "AppCashPeriodResult") {
            const summary = message.summary;
            if (
              Number.isSafeInteger(summary?.cents) &&
              typeof summary.from === "string" &&
              typeof summary.to === "string"
            )
              setStatus(
                `${summary.from} – ${summary.to}: ${(summary.cents / 100).toFixed(2)} € · ${summary.scope === "club" ? "club" : summary.scope === "selected_collaborator" ? "colaborador seleccionado" : "tu actividad"}`,
              );
          } else if (
            message.type === "AppGeneticsResult" &&
            typeof message.name === "string" &&
            Array.isArray(message.sources)
          ) {
            setCitations({
              name: message.name.slice(0, 100),
              sources: message.sources
                .filter(
                  (s: unknown) => typeof s === "string" && voiceGeneticsSource(s, message.name),
                )
                .slice(0, 9),
            });
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
          if (phase === "paused" || phase === "reconnecting")
            setExecution((current) =>
              current ? { ...current, busy: false, uncertain: true } : null,
            );
          if (phase === "paused") {
            interrupt();
            setStatus("SNOOP en espera · micrófono local · sin conexión de pago");
          }
          if (phase === "reconnecting") {
            state.speaker.interrupt();
            setStatus("Reconectando SNOOP · conservo la conversación");
          }
        },
        fatal: (code) => stop("SNOOP: " + code),
      });
      state.transport = transport;
      let previousFault: string | null = null;
      const diagnostic = () => ({
        ...state.speaker.snapshot(),
        microphoneLive: state.stream.getAudioTracks().some((t) => t.readyState === "live"),
        providerReady: state.ready,
        input: state.captureHealth.snapshot(),
        server: state.serverHealth,
        connection: state.transport.diagnostics(),
      });
      state.node.onprocessorerror = () => state.captureHealth.processorFailed();
      state.healthTimer = setInterval(() => {
        if (audio.current !== state || document.hidden) return;
        const fault = state.captureHealth.fault(
          state.ctx.state === "running",
          state.stream.getAudioTracks().some((t) => t.muted),
        );
        if (fault && fault !== previousFault) {
          setStatus(
            {
              AUDIO_CONTEXT_BLOCKED: "Audio bloccato dal dispositivo. Tocca Riattiva audio.",
              AUDIO_PROCESSOR_ERROR: "Acquisizione audio interrotta: il processore non risponde.",
              MICROPHONE_MUTED: "Il sistema ha silenziato il microfono. Controlla il dispositivo.",
              CAPTURE_NO_FRAMES: "Microfono aperto ma senza campioni audio. Riavvia il microfono.",
            }[fault],
          );
        } else if (!fault && previousFault)
          setStatus(
            state.speaker.snapshot().scheduledNodes ? "SNOOP sta parlando" : "SNOOP ti ascolta",
          );
        previousFault = fault;
        if (accessRef.current.role === "admin" && expandedRef.current)
          setAudioDiagnostic(diagnostic());
      }, 1000);
      await transport.start();
    } catch (error) {
      if (!audio.current) {
        if (activatingContext.current === ctx) activatingContext.current = null;
        stream?.getTracks().forEach((track) => track.stop());
        void ctx?.close().catch(() => {});
        transport?.stop();
      }
      if (generation.current === current)
        stop(error instanceof Error ? error.message : "Impossibile attivare SNOOP");
    } finally {
      if (generation.current === current) starting.current = false;
    }
  };

  const compact = running && !expanded;
  return open ? (
    <section
      role="dialog"
      aria-label="SNOOP JARVIS 3"
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        top: compact ? "calc(env(safe-area-inset-top, 0px) + 8px)" : undefined,
        bottom: compact ? undefined : 78,
        zIndex: 100,
        borderRadius: 18,
        padding: compact ? 8 : running ? 12 : 18,
        background: "#0e1933",
        color: "#f7df9d",
        border: "1px solid #a98b4c",
        maxHeight: compact ? 120 : "70dvh",
        overflowY: "auto",
        width: compact ? "calc(100vw - 128px)" : undefined,
        maxWidth: compact ? 320 : 520,
        margin: "0 auto",
        boxShadow: "0 14px 50px #0008",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: running ? 13 : undefined }}>
          {compact ? "● SNOOP" : "SNOOP · JARVIS 3"}
        </strong>
        {running && (
          <button
            type="button"
            aria-label={compact ? "Dettagli SNOOP" : "Riduci SNOOP"}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            ⋯
          </button>
        )}
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
      {!!privateRecords.length && expanded && (
        <section aria-label="Registros autorizados">
          <ol>
            {privateRecords.map((row, index) => (
              <li key={String(row.ref)}>
                {index + 1}.{" "}
                {String(
                  row.name ??
                    row.description ??
                    row.reference ??
                    (row.opened_at
                      ? `Caja · ${String(row.opened_at)} · ${String(row.status)}`
                      : [row.first_name, row.last_name].filter(Boolean).join(" ")),
                )}
                {row.stock !== undefined
                  ? ` · ${row.stock_scope === "total" ? "Total inventario" : "Stock"}: ${String(row.stock)} ${row.unit_type === "gr" ? "g" : row.unit_type === "unit" ? "uds." : "(unidad no verificada)"}`
                  : ""}
                {row.amount_cents !== undefined
                  ? ` · ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(row.amount_cents) / 100)}`
                  : ""}
                {row.created_at
                  ? ` · ${new Date(String(row.created_at)).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`
                  : ""}
                {row.price_cents !== undefined
                  ? ` · ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(row.price_cents) / 100)}`
                  : ""}
              </li>
            ))}
          </ol>
        </section>
      )}
      {execution && (
        <section aria-label="Conferma operazione">
          {execution.summary ? (
            <>
              <strong>{String(execution.summary.label)}</strong>
              <dl>
                {Object.entries(execution.summary)
                  .filter(([key]) => key !== "label" && key !== "changes" && key !== "attestation")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt>
                        {(
                          {
                            name: "Registro",
                            category: "Categoría",
                            discount: "Descuento",
                            unit_type: "Unidad",
                            opened_at: "Apertura",
                            member_name: "Socio",
                            plan: "Cuota",
                            amount_cents: "Importe",
                            duration_days: "Duración (días)",
                            method: "Pago",
                            enabled: "Control de acceso",
                          } as Record<string, string>
                        )[key] ?? key}
                      </dt>
                      <dd>
                        {(key === "amount_cents" ||
                          key.endsWith("_cash_cents") ||
                          key === "price_cents") &&
                        typeof value === "number"
                          ? new Intl.NumberFormat("es-ES", {
                              style: "currency",
                              currency: "EUR",
                            }).format(value / 100)
                          : key === "percentage_basis_points" && typeof value === "number"
                            ? new Intl.NumberFormat("es-ES", {
                                style: "percent",
                                maximumFractionDigits: 2,
                              }).format(value / 10000)
                            : key === "method" && typeof value === "string"
                              ? ((
                                  {
                                    cash: "Efectivo",
                                    card: "Tarjeta",
                                    transfer: "Transferencia",
                                    other: "Otro",
                                  } as Record<string, string>
                                )[value] ?? value)
                              : typeof value === "boolean"
                                ? value
                                  ? "Sí"
                                  : "No"
                                : String(value ?? "")}
                      </dd>
                    </div>
                  ))}
                {execution.summary.changes && typeof execution.summary.changes === "object"
                  ? Object.entries(execution.summary.changes).map(([key, value]) => (
                      <div key={key}>
                        <dt>
                          {(
                            {
                              name: "Nombre",
                              buy_price_cents: "Importe adquisición",
                              sell_price_cents: "Importe catálogo",
                              delta: "Variación de inventario verificada",
                              description: "Descripción",
                              archived: "Archivado",
                              first_name: "Nombre",
                              last_name: "Apellidos",
                              birth_date: "Nacimiento",
                              city: "Ciudad",
                              phone: "Teléfono",
                              email: "Email",
                              unit_type: "Unidad",
                              is_smokeable: "Categoría fumable",
                              price_cents: "Importe",
                              duration_days: "Duración (días)",
                              percentage_basis_points: "Descuento",
                              active: "Activo",
                              valid_from: "Desde",
                              valid_until: "Hasta",
                              opening_cash_cents: "Fondo inicial",
                              closing_cash_cents: "Contante contado",
                              notes: "Notas",
                            } as Record<string, string>
                          )[key] ?? key}
                        </dt>
                        <dd>
                          {key.endsWith("_cents") && typeof value === "number"
                            ? new Intl.NumberFormat("es-ES", {
                                style: "currency",
                                currency: "EUR",
                              }).format(value / 100)
                            : key === "percentage_basis_points" && typeof value === "number"
                              ? new Intl.NumberFormat("es-ES", {
                                  style: "percent",
                                  maximumFractionDigits: 2,
                                }).format(value / 10000)
                              : typeof value === "boolean"
                                ? value
                                  ? "Sí"
                                  : "No"
                                : String(value ?? "")}
                        </dd>
                      </div>
                    ))
                  : null}
              </dl>
            </>
          ) : (
            <p>{execution.enabled ? "Attivare" : "Disattivare"} il controllo entrate del club?</p>
          )}
          {typeof execution.summary?.attestation === "string" && !execution.uncertain && (
            <label>
              <input
                type="checkbox"
                checked={execution.attested === true}
                onChange={(e) =>
                  setExecution((value) => (value ? { ...value, attested: e.target.checked } : null))
                }
              />
              {execution.summary.attestation}
            </label>
          )}
          <button
            type="button"
            disabled={
              execution.busy ||
              (!execution.uncertain &&
                typeof execution.summary?.attestation === "string" &&
                !execution.attested)
            }
            onClick={() => {
              if (!audio.current) return;
              setExecution({ ...execution, busy: true });
              audio.current.transport.send(
                execution.uncertain
                  ? { type: "AppExecutionCheck", id: execution.id }
                  : {
                      type: "AppExecutionConfirm",
                      id: execution.id,
                      token: execution.token,
                      confirmed: true,
                      ...(execution.attested ? { receiptConfirmed: true } : {}),
                    },
              );
            }}
          >
            {execution.uncertain ? "Verifica esito" : "Conferma modifica"}
          </button>
          <button
            type="button"
            disabled={execution.busy || execution.uncertain}
            onClick={() => {
              if (!audio.current) return;
              setExecution({ ...execution, busy: true });
              audio.current.transport.send({
                type: "AppExecutionCancel",
                id: execution.id,
                token: execution.token,
              });
            }}
          >
            Annulla proposta
          </button>
        </section>
      )}
      <p
        role="status"
        style={
          running
            ? {
                fontSize: 12,
                margin: "4px 0",
                lineHeight: 1.3,
                ...(compact ? { maxHeight: 32, overflow: "hidden" } : {}),
              }
            : undefined
        }
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
      {running && !compact && (
        <p style={{ fontSize: 11, margin: "4px 0" }}>
          Revisión antes de guardar · pausa automática cuando no se utiliza
        </p>
      )}
      <div
        style={{
          display: "flex",
          gap: 10,
          marginTop: compact ? 4 : 12,
          fontSize: compact ? 11 : undefined,
        }}
      >
        {running && audioSuspended && (
          <button
            type="button"
            onClick={() => {
              const state = audio.current;
              if (!state) return;
              void state.ctx
                .resume()
                .then(() => {
                  if (audio.current !== state) return;
                  const paused = state.ctx.state !== "running";
                  setAudioSuspended(paused);
                  state.speaker.contextChanged();
                  if (paused) setStatus("Audio ancora bloccato dal dispositivo.");
                  else if (!state.speaker.snapshot().scheduledNodes) setStatus("SNOOP ti ascolta");
                })
                .catch(() => setStatus("Audio bloccato dal dispositivo. Riprova Riattiva audio."));
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
      {access.role === "admin" && running && !compact && (
        <details>
          <summary>Diagnostica audio privata</summary>
          <button
            type="button"
            onClick={() => {
              const state = audio.current;
              setAudioDiagnostic(
                state
                  ? {
                      ...state.speaker.snapshot(),
                      microphoneLive: state.stream
                        .getAudioTracks()
                        .some((track) => track.readyState === "live"),
                      providerReady: state.ready,
                      connection: state.transport.diagnostics(),
                      input: state.captureHealth.snapshot(),
                      server: state.serverHealth,
                    }
                  : null,
              );
            }}
          >
            Aggiorna diagnostica audio
          </button>
          {audioDiagnostic && (
            <pre style={{ fontSize: 10, whiteSpace: "pre-wrap" }}>
              {JSON.stringify(audioDiagnostic, null, 2)}
            </pre>
          )}
          <small>Solo contatori in memoria: nessun audio, testo o identificativo.</small>
        </details>
      )}
      {usage && !compact && (
        <p style={{ fontSize: 11 }}>
          Voz disponible: {(usage.remainingSeconds / 60).toFixed(1)} min ·{" "}
          {usage.estimatedMicrousd === null
            ? "coste pendiente de tarifa verificada"
            : `estimación ${(usage.estimatedMicrousd / 1000000).toFixed(2)} USD`}
        </p>
      )}
      {citations && !compact && (
        <details style={{ fontSize: 11, marginTop: 4 }}>
          <summary>Fuentes · {citations.name}</summary>
          {citations.sources.length ? (
            citations.sources.map((source) => (
              <a
                key={source}
                href={source}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", overflowWrap: "anywhere" }}
              >
                {new URL(source).hostname}
              </a>
            ))
          ) : (
            <p>No hay fuentes verificadas disponibles.</p>
          )}
        </details>
      )}
      {!running && verifiedCount !== null && <p>Categorie verificate: {verifiedCount}</p>}
      <div
        hidden={compact}
        aria-live="polite"
        style={{ maxHeight: running ? 44 : 140, overflow: "auto" }}
      >
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
