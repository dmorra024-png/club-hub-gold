import {
  ConversationProposal,
  emptyConversation,
  reduceConversation,
  screenTarget,
  targetPath,
  conversationAllowed,
  type ConversationMemoryValue,
} from "@/lib/snoop-conversation";
import {
  conversationModeStatus,
  interpretSnoopConversation,
} from "@/lib/snoop-conversation.functions";
import {
  planSnoopTurn,
  projectSnoopTurn,
  sketchSupports,
  bindSnoopCommand,
} from "@/lib/snoop-orchestrator";
import { premiumVoiceIntent } from "@/lib/premium-voice";
import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Mic, X, Loader2, Square, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { informationalVoiceCommand } from "@/lib/informational-voice";
import { parseAdministrativeDictation } from "@/lib/member-administration";
import {
  transcribeAudio,
  getAdministrativeAiStatus,
  suggestVoiceNavigation,
} from "@/lib/voice-agent.functions";

import { useWhisperDictation } from "@/hooks/useWhisperDictation";
import {
  administrativeIntent,
  cleanVoiceCommand,
  voiceIntentAllowed,
  voiceMemberDraft,
  voiceDraftSummary,
} from "@/lib/administrative-voice";
import { privateVoiceCommand } from "@/lib/private-voice";
import type { AccountAccess } from "@/lib/access-context";

// Client-side navigation intents (so home wake word can dispatch commands quickly).
// Order matters: more specific intents first.
const NAV_INTENTS: Array<{ to: string; rx: RegExp; label: string; tab?: string }> = [
  {
    to: "/productos",
    rx: /\b(crea|crear|creare|nuevo|nuovo|alta|nueva|a[nñ]adir|agregar|registrar)\b[\s\S]{0,45}\b(prod(?:u[cç]?t[oa]|ott[oi])|produvto|productos?)\b/i,
    label: "Crear producto",
    tab: "nuevo",
  },
  {
    to: "/productos",
    rx: /\b(crea|crear|creare|nueva|nuova|alta|a[nñ]adir|agregar)\b[\s\S]{0,45}\b(categor[ií]a|categoria|categorie)\b/i,
    label: "Crear categoría",
    tab: "categoria",
  },
  {
    to: "/soci/nuovo",
    rx: /\b(nuevo|nuovo|crear|crea|creare|alta|registrar)\b[\s\S]{0,35}\b(socio|miembro)\b/i,
    label: "Nuevo socio",
  },
  {
    to: "/soci/gestisci",
    rx: /\b(gestionar socios?|gestiona socios?|buscar socios?|busca socios?|socios|ver socios|gestion[eó] socios?)\b/i,
    label: "Gestionar socios",
  },
  {
    to: "/caja",
    rx: /\b(incassi|ingresos|quote|cuotas|registro quote|incassi quote|informe cuotas|report quote)\b/i,
    label: "Caja",
  },
  { to: "/ajustes/cuotas", rx: /\b(planes)\b/i, label: "Cuotas" },
  {
    to: "/ajustes/colaboradores",
    rx: /\b(colaboradores|colaborador|colaboradoras|staff|equipo)\b/i,
    label: "Colaboradores",
  },
  { to: "/ajustes", rx: /\b(ajustes|configuraci[oó]n|settings|impostazioni)\b/i, label: "Ajustes" },
  { to: "/caja", rx: /\b(caja|cassa|cash|ventas del d[ií]a|informe)\b/i, label: "Caja" },
  {
    to: "/productos",
    rx: /\b(producto|productos|prodotti|inventario|stock)\b/i,
    label: "Productos",
  },
  { to: "/", rx: /\b(inicio|home|principal|men[uú] principal)\b/i, label: "Inicio" },
];

// Acepta "snoop ..." a secas, además de "hola/oye/hey/ok snoop".
const WAKE_RX = /\b(?:hola|oye|hey|ok|okay|vale)?\s*,?\s*snoop\b[\s,:]*/i;

function normalizeVoiceText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function cleanMemberLookup(value: string) {
  return value
    .replace(WAKE_RX, "")
    .replace(
      /^(?:busca(?:r|me)?|cerca|cercar|trova(?:mi)?|encuentra|encontrar|abre|abrir|aprimi|portami|lleva(?:me)?|ficha|scheda)\s+/i,
      "",
    )
    .replace(/^(?:el|la|un|una)?\s*(?:socio|miembro|ficha|scheda)\s+(?:de\s+)?/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function looksLikeMemberLookup(value: string) {
  const t = normalizeVoiceText(value);
  return /\b(busca|buscar|buscame|cerca|trova|trovami|encuentra|ficha|scheda)\b/.test(t);
}

export function VoiceAgent({
  clubName,
  access,
  userId,
  onPhaseChange,
}: {
  clubName?: string | null;
  access: AccountAccess;
  userId: string;
  onPhaseChange?: (phase: import("@/hooks/useWhisperDictation").DictationPhase) => void;
}) {
  const [conversationMode, setConversationMode] = useState<"off" | "pilot" | "real">("off");
  const [conversationModes, setConversationModes] = useState({ pilot: false, real: false });
  const [syntheticConfirmed, setSyntheticConfirmed] = useState(false);
  const conversationMemory = useRef<ConversationMemoryValue>(emptyConversation());
  const conversationStatus = useServerFn(conversationModeStatus),
    interpretConversation = useServerFn(interpretSnoopConversation);
  const [language, setLanguage] = useState("es-ES");
  const [feedback, setFeedback] = useState("");
  const [panelOpen, setPanelOpen] = useState(false),
    [manual, setManual] = useState(""),
    [transcript, setTranscript] = useState("");
  const consentKey = `snoop:voice-consent:v2:${userId}:${access.clubId ?? ""}`;
  const [consentFor, setConsentFor] = useState({ key: "", allowed: false });
  const consent = consentFor.key === consentKey && consentFor.allowed;
  const closeWhenIdle = useRef(false);
  const [sessionActive, setSessionActive] = useState(false),
    [continuous, setContinuous] = useState(true),
    [consentPrompt, setConsentPrompt] = useState(false),
    [stage, setStage] = useState("Escuchando"),
    [speaking, setSpeaking] = useState(false),
    [clarification, setClarification] = useState(""),
    [fault, setFault] = useState("");
  const sessionEpoch = useRef(0);
  const conversationGeneration = useRef(0);
  const activeRef = useRef(false),
    cancelRef = useRef<() => void>(() => {}),
    recordingPath = useRef(""),
    executing = useRef(false);
  const stopSession = useCallback(() => {
    activeRef.current = false;
    conversationMemory.current = emptyConversation();
    conversationGeneration.current++;
    sessionEpoch.current++;
    window.dispatchEvent(new Event("snoop:conversation-reset"));
    setSessionActive(false);
    setSpeaking(false);
    setFeedback("");
    setFault("");
    setTranscript("");
    setManual("");
    setClarification("");
    setTimings([]);
    cancelRef.current();
  }, []);
  const aiBudget = useRef({ count: 0, blocked: false });
  const [commandAiConsent, setCommandAiConsent] = useState(false);
  const [timings, setTimings] = useState<import("@/hooks/useWhisperDictation").VoiceTiming[]>([]);
  useEffect(() => {
    let allowed = false;
    try {
      allowed = localStorage.getItem(consentKey) === "cloudflare-whisper";
      setContinuous(localStorage.getItem(consentKey + ":mode") !== "single");
    } catch {}
    setConsentFor({ key: consentKey, allowed });
  }, [consentKey]);
  useEffect(() => {
    if (!panelOpen) return;
    let mounted = true;
    conversationStatus()
      .then((value) => {
        if (mounted)
          setConversationModes({ pilot: value.pilot === true, real: value.real === true });
      })
      .catch(() => {
        if (mounted) setConversationModes({ pilot: false, real: false });
      });
    return () => {
      mounted = false;
    };
  }, [panelOpen, userId, access.clubId]);
  const aiStatus = useServerFn(getAdministrativeAiStatus),
    transcribe = useServerFn(transcribeAudio);
  const proposeNavigation = useServerFn(suggestVoiceNavigation);
  const processingRef = useRef(false);
  const voiceDestination = useRef<string | null>(null);
  const routerNavigate = useNavigate();
  const navigate = useCallback(
    (options: any) => {
      voiceDestination.current = options.to;
      return routerNavigate(options);
    },
    [routerNavigate],
  );
  const location = useLocation(),
    locRef = useRef(location);
  locRef.current = location;
  const accessRef = useRef({ access, userId });
  accessRef.current = { access, userId };
  const scope = [
    userId,
    access.clubId,
    access.status,
    access.role,
    ...[...access.permissions].sort(),
  ].join(":");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("snoop:voice-language") || navigator.language;
      setLanguage(saved.startsWith("it") ? "it-IT" : "es-ES");
    } catch {
      setLanguage(navigator.language.startsWith("it") ? "it-IT" : "es-ES");
    }
  }, []);
  useEffect(() => {
    stopSession();
    setFeedback("");
    setCommandAiConsent(false);
    setConversationMode("off");
    setSyntheticConfirmed(false);
    setConversationModes({ pilot: false, real: false });
    aiBudget.current = { count: 0, blocked: false };
    setTranscript("");
    setManual("");
    setClarification("");
    setTimings([]);
    window.dispatchEvent(new Event("snoop:conversation-reset"));
  }, [scope, stopSession]);
  // --- Process a final transcript ---
  const handleTranscript = useCallback(
    async (raw: string) => {
      const text = cleanVoiceCommand(raw);
      if (!text) return;
      if (processingRef.current) return;
      processingRef.current = true;

      try {
        const path = locRef.current.pathname;
        const current = accessRef.current;
        if (!current.userId || current.access.status !== "active" || !current.access.clubId)
          throw new Error("Acceso no disponible. Revisa tu sesión.");
        const scope = { userId: current.userId, clubId: current.access.clubId };
        const allow = (to: string) => {
          if (!voiceIntentAllowed(current.access, to))
            throw new Error("No tienes permiso para esta función.");
        };
        const lower = text.toLowerCase();
        const normalized = normalizeVoiceText(text);

        const premium = premiumVoiceIntent(text, path);
        if (premium) {
          allow(premium.to);
          if (premium.productQuery !== undefined) {
            const command = { text: `buscar ${premium.productQuery}`, at: Date.now() };
            if (path === "/productos")
              window.dispatchEvent(new CustomEvent("snoop:productos-command", { detail: command }));
            else window.sessionStorage.setItem("snoop:productos-cmd", JSON.stringify(command));
          }
          if (premium.productCreate || premium.productTab) {
            const tab = premium.productTab ?? "nuevo";
            const command = { text, tab, at: Date.now() };
            if (path === "/productos")
              window.dispatchEvent(new CustomEvent("snoop:productos-command", { detail: command }));
            else {
              localStorage.setItem("snoop:productos-tab", tab);
              sessionStorage.setItem("snoop:productos-cmd", JSON.stringify(command));
            }
          }
          if (premium.cashReport) {
            // Open the existing report tab only; never open a cash session or record money.
            window.sessionStorage.setItem(
              "snoop:cash-report-open",
              JSON.stringify({ ...scope, at: Date.now() }),
            );
          }
          if (path !== premium.to || premium.search)
            await navigate({ to: premium.to as any, search: premium.search as any });
          if (premium.cashReport) window.dispatchEvent(new Event("snoop:cash-report-open"));
          setFeedback(
            premium.requiresMember
              ? "Selecciona un socio para continuar. No se ha creado ningún pedido."
              : "Pantalla preparada. No se ha guardado nada.",
          );
          return;
        }
        const informational = informationalVoiceCommand(text);
        if (informational) {
          allow("/productos");
          const command = { text: `buscar ${informational.query}`, at: Date.now() };
          if (path === "/productos")
            window.dispatchEvent(new CustomEvent("snoop:productos-command", { detail: command }));
          else {
            window.sessionStorage.setItem("snoop:productos-cmd", JSON.stringify(command));
            await navigate({ to: "/productos" });
          }
          return;
        }
        if (
          path === "/productos" &&
          document.querySelector("[data-snoop-product-form]") &&
          /^(?:no\b|cambia\b|corrige\b|correggi\b|modifica\b)/i.test(text)
        ) {
          allow("/productos");
          window.dispatchEvent(
            new CustomEvent("snoop:productos-command", { detail: { text, tab: "nuevo" } }),
          );
          return;
        }
        if (
          path === "/productos" &&
          document.querySelector("[data-snoop-product-form]") &&
          /^(?:nombre|nome|categor[ií]a|stock|cantidad|precio|prezzo)\b/i.test(text)
        ) {
          allow("/productos");
          window.dispatchEvent(
            new CustomEvent("snoop:productos-command", { detail: { text, tab: "nuevo" } }),
          );
          return;
        }
        const intent = administrativeIntent(text, path);
        if (intent) {
          allow(intent.to);
          if (intent.kind === "member-draft") {
            window.sessionStorage.setItem(
              "snoop:member-draft",
              voiceMemberDraft(intent.fields, scope),
            );
            if (path === intent.to) window.dispatchEvent(new Event("snoop:member-draft"));
            else await navigate({ to: intent.to });
            const message =
              voiceDraftSummary(intent.fields) || "Indica los campos que quieres completar.";
            setFeedback(message + " · Revisa y confirma en el formulario. Nada guardado.");
            toast.info("Borrador preparado. Revisa los campos antes de guardar.");
          } else if (intent.kind === "member-search") {
            window.sessionStorage.removeItem("snoop:member-search-pending");
            if (path === intent.to)
              window.dispatchEvent(
                new CustomEvent("snoop:search-members", { detail: { query: intent.query } }),
              );
            else {
              if (intent.query)
                window.sessionStorage.setItem(
                  "snoop:member-search-pending",
                  JSON.stringify({ version: 2, query: intent.query, at: Date.now(), ...scope }),
                );
              await navigate({ to: intent.to });
            }
            setFeedback(intent.query ? "Búsqueda local preparada." : "Gestionar socios");
          } else if (intent.kind === "navigate") {
            await navigate({ to: intent.to as any });
          } else
            setFeedback(
              "No identifiqué un campo. Di nombre, apellido, nacimiento, documento, ciudad, teléfono o cuota. No se ha cambiado nada.",
            );
          return;
        }

        // --- 1) Global navigation intents (always win — user said a section name) ---
        const navHit = NAV_INTENTS.find((n) => n.rx.test(lower) || n.rx.test(normalized));
        if (navHit) {
          allow(navHit.to);
          if (navHit.to === "/soci/nuovo") {
            window.sessionStorage.setItem(
              "snoop:member-draft",
              JSON.stringify({ at: Date.now(), fields: parseAdministrativeDictation(text) }),
            );
            if (path === "/soci/nuovo") window.dispatchEvent(new Event("snoop:member-draft"));
          }
          if (path !== navHit.to) {
            if (navHit.tab) {
              try {
                window.localStorage.setItem("snoop:productos-tab", navHit.tab);
              } catch {}
              // Forward the full transcript so the destination page can auto-parse it
              try {
                window.sessionStorage.setItem(
                  "snoop:productos-cmd",
                  JSON.stringify({ text, at: Date.now() }),
                );
              } catch {}
            }
            navigate({ to: navHit.to as any });
          } else {
            // ya estamos ahí: dispara evento por si la página quiere reaccionar
            if (navHit.tab)
              window.dispatchEvent(
                new CustomEvent("snoop:productos-command", { detail: { text, tab: navHit.tab } }),
              );
            else
              window.dispatchEvent(new CustomEvent("snoop:productos-voice", { detail: { text } }));
          }
          return;
        }

        if (looksLikeMemberLookup(text) && /\b(socio|miembro|soci|socios)\b/i.test(text)) {
          allow("/soci/gestisci");
          const query = cleanMemberLookup(text);
          if (query.length > 1) {
            if (path !== "/soci/gestisci") {
              try {
                window.sessionStorage.setItem(
                  "snoop:member-search-pending",
                  JSON.stringify({ query, at: Date.now() }),
                );
              } catch {}
              navigate({ to: "/soci/gestisci" });
            } else {
              window.dispatchEvent(new CustomEvent("snoop:search-members", { detail: { query } }));
            }
            return;
          }
        }

        // --- 2) Productos: any voice = category filter OR search ---
        if (path === "/productos") {
          allow("/productos");
          if (document.querySelector("[data-snoop-product-form]")) {
            window.dispatchEvent(
              new CustomEvent("snoop:productos-command", { detail: { text, tab: "nuevo" } }),
            );
            return;
          }
          // Product creation must reach the parent form parser, not only the
          // stock-list category filter listening to productos-voice.
          if (
            /\b(?:crea|crear|creare|nuevo|nuovo|nueva|alta|añadir|anadir|agregar|registrar)\b[\s\S]{0,80}\b(?:producto|prodotti|prodotto|productos)\b/i.test(
              text,
            )
          ) {
            window.dispatchEvent(
              new CustomEvent("snoop:productos-command", { detail: { text, tab: "nuevo" } }),
            );
          } else {
            window.dispatchEvent(new CustomEvent("snoop:productos-voice", { detail: { text } }));
          }
          return;
        }

        // From elsewhere: "categoría flores", "ver flores en productos", etc.
        const catMatch = lower.match(
          /(?:categor[ií]a|ver|mostrar|abre|abrir|ir a|ve a)\s+([a-záéíóúñ\s]+?)(?:\s+en\s+productos)?\.?$/i,
        );
        if (
          catMatch &&
          /\b(flores?|extracci|hash|comestibles?|bebidas?|merch|vapes?|cigarr|joints?|prerolls?|edibles?)/i.test(
            catMatch[1],
          )
        ) {
          const cat = catMatch[1].trim();
          try {
            window.sessionStorage.setItem(
              "snoop:productos-pending",
              JSON.stringify({ text: cat, at: Date.now() }),
            );
          } catch {}
          navigate({ to: "/productos" });
          return;
        }

        // --- 3) Route-specific shortcuts ---
        if (path === "/soci/nuovo") {
          const payload = JSON.stringify({ text, at: Date.now() });
          window.sessionStorage.setItem("snoop:new-member-transcript", payload);
          window.dispatchEvent(
            new StorageEvent("storage", { key: "snoop:new-member-transcript", newValue: payload }),
          );
          return;
        }

        if (path === "/soci/gestisci" || path === "/soci") {
          const cleaned = text
            .replace(
              /^(buscar?|busca|buscame|encuentra|encontrar|cerca|cercar|trova|trovami|busca a|busca el|busca la)\s+/i,
              "",
            )
            .replace(/[.,;:!?]+$/g, "")
            .trim();
          window.dispatchEvent(
            new CustomEvent("snoop:search-members", { detail: { query: cleaned } }),
          );
          return;
        }

        if (/^\/soci\/[^/]+\/pedido/.test(path)) {
          window.dispatchEvent(new CustomEvent("snoop:pedido-transcript", { detail: { text } }));
          return;
        }

        if (path.startsWith("/soci/") && path !== "/soci/nuovo" && path !== "/soci/gestisci") {
          if (
            /(hacer|nuevo|crear)\s+(un\s+)?(pedido|orden|ordine)/i.test(lower) ||
            /^(pedido|ordine|orden)\.?$/i.test(lower.trim())
          ) {
            window.dispatchEvent(
              new CustomEvent("snoop:member-action", { detail: { action: "order" } }),
            );
            return;
          }
          if (/(renovar|renueva|rinnova)/i.test(lower)) {
            window.dispatchEvent(
              new CustomEvent("snoop:member-action", { detail: { action: "renew" } }),
            );
            return;
          }
          if (/(volver|atr[aá]s|indietro|back)/i.test(lower)) {
            navigate({ to: "/soci/gestisci" });
            return;
          }
        }

        const command = privateVoiceCommand(text);
        if (command.navigateTo) {
          allow(command.navigateTo);
          if (command.permission && !current.access.permissions.includes(command.permission))
            throw new Error("No tienes permiso para esta función.");
          if (command.memberDraft)
            window.sessionStorage.setItem(
              "snoop:member-draft",
              voiceMemberDraft(command.memberDraft, scope),
            );
          await navigate({ to: command.navigateTo as any });
        }
        setFeedback(command.reply);
      } catch (e: any) {
        toast.error(e.message ?? "Error en el asistente");
        return false;
      } finally {
        processingRef.current = false;
      }
    },
    [navigate],
  );

  const fieldEdits = useRef(0),
    recordingEdits = useRef(0);
  useEffect(() => {
    const changed = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".premium-voice-panel")) return;
      fieldEdits.current++;
    };
    document.addEventListener("input", changed);
    return () => document.removeEventListener("input", changed);
  }, []);
  const dictation = useWhisperDictation({
    scope,
    language: language.startsWith("it") ? "it" : "es",
    available: aiStatus,
    transcribe: (data) => transcribe({ data }),
    continuous,
    onInterrupt: stopSession,
    onTiming: (timing) => {
      setTimings((old) => [...old.slice(-19), timing]);
      window.dispatchEvent(new CustomEvent("snoop:voice-timing", { detail: timing }));
    },
    onSpeechActivity: setSpeaking,
    onStart: () => {
      setFault("");
      closeWhenIdle.current = false;
      recordingEdits.current = fieldEdits.current;
      recordingPath.current = locRef.current.pathname;
      setStage("Escuchando");
    },
    onTranscript: async (text) => {
      setSpeaking(false);
      setClarification("");
      if (!continuous) {
        activeRef.current = false;
        setSessionActive(false);
        closeWhenIdle.current = true;
      }
      setStage("Interpretando");
      if (recordingPath.current !== locRef.current.pathname) {
        setFeedback("Pantalla cambiada. Repite el comando.");
        return;
      }
      if (fieldEdits.current !== recordingEdits.current) {
        setFeedback("Conservo tu edición manual. Repite el dictado.");
        return;
      }
      const interpretationStart = performance.now();
      if (conversationMode !== "off") {
        if (
          /^(?:snoop[, ]*)?(?:terminar|detener escucha|stop(?: snoop)?|fermati|ferm[aá]ti|termina)[.!?]*$/i.test(
            text.trim(),
          )
        ) {
          stopSession();
          return;
        }
        if (
          !commandAiConsent ||
          !conversationModes[conversationMode] ||
          (conversationMode === "pilot" && !syntheticConfirmed)
        ) {
          stopSession();
          setFeedback("Modo conversacional no autorizado. Revisa los ajustes.");
          return;
        }
        const epoch = sessionEpoch.current,
          revision = fieldEdits.current,
          path = locRef.current.pathname,
          identity = JSON.stringify(accessRef.current),
          generation = conversationGeneration.current;
        const snapshot = (kind: string) => {
          let value: any = null;
          window.dispatchEvent(
            new CustomEvent("snoop:ai-form", {
              detail: { kind, respond: (v: any) => (value = v) },
            }),
          );
          return value;
        };
        const member = path === "/soci/nuovo" ? snapshot("member") : null;
        const product = path === "/productos" ? snapshot("product") : null;
        const context = {
          ...conversationMemory.current,
          ...(member ? { member } : {}),
          ...(product ? { product } : {}),
        };
        const aiStart = performance.now();
        const response = await interpretConversation({
          data: {
            mode: conversationMode,
            consent: true,
            synthetic: conversationMode === "pilot",
            text,
            screen: screenTarget(path),
            context,
          },
        });
        const aiMs = performance.now() - aiStart;
        if (
          epoch !== sessionEpoch.current ||
          revision !== fieldEdits.current ||
          path !== locRef.current.pathname ||
          identity !== JSON.stringify(accessRef.current) ||
          generation !== conversationGeneration.current ||
          (continuous && !activeRef.current)
        )
          return { aiMs, interpretationMs: aiMs, executionMs: 0 };
        const parsed = ConversationProposal.safeParse(response.proposal);
        if (response.error || !parsed.success) {
          stopSession();
          setFeedback(
            response.error === "quota"
              ? "Cuota IA agotada. Usa el formulario."
              : "SNOOP no disponible. No se cambió ningún campo.",
          );
          return { aiMs, interpretationMs: aiMs, executionMs: 0 };
        }
        const proposal = parsed.data;
        if (!conversationAllowed(accessRef.current.access, proposal)) {
          setClarification("No tienes permiso para esta función.");
          return;
        }
        if (proposal.intent === "stop") {
          stopSession();
          return;
        }
        const executionStart = performance.now();
        executing.current = true;
        try {
          const to = proposal.target ? targetPath[proposal.target] : null;
          if (to && to !== path) await navigate({ to: to as any });
          if (
            proposal.target &&
            ["product_create", "categories", "products", "stock"].includes(proposal.target)
          ) {
            const until = performance.now() + 5000;
            while (!document.querySelector("[data-snoop-products-page]")) {
              if (epoch !== sessionEpoch.current && locRef.current.pathname !== to) return;
              if (performance.now() > until) throw new Error("SNOOP_FORM_UNAVAILABLE");
              await new Promise((r) => setTimeout(r, 30));
            }
            window.dispatchEvent(
              new CustomEvent("snoop:ai-products", {
                detail: { target: proposal.target, patch: proposal.product, query: proposal.query },
              }),
            );
          }
          if (
            generation !== conversationGeneration.current ||
            revision !== fieldEdits.current ||
            (to && locRef.current.pathname !== to)
          )
            return;
          if (proposal.target === "cash_report") {
            const until = performance.now() + 5000;
            let opened = false;
            while (!opened && performance.now() < until) {
              if (generation !== conversationGeneration.current || revision !== fieldEdits.current)
                return;
              const tab = Array.from(
                document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              ).find((t) => t.textContent === "Informe de caja");
              if (tab && !tab.disabled) {
                tab.focus();
                tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
                opened = true;
              } else await new Promise((r) => setTimeout(r, 30));
            }
            if (!opened) throw new Error("SNOOP_REPORT_UNAVAILABLE");
          }
          const kind =
            proposal.intent === "member"
              ? "member"
              : proposal.intent === "product"
                ? "product"
                : null;
          if (kind) {
            const until = performance.now() + 5000;
            while (!snapshot(kind)) {
              if (
                (!activeRef.current && continuous) ||
                generation !== conversationGeneration.current ||
                revision !== fieldEdits.current
              )
                return;
              if (performance.now() > until) throw new Error("SNOOP_FORM_UNAVAILABLE");
              await new Promise((r) => setTimeout(r, 30));
            }
            let applied: any = null;
            window.dispatchEvent(
              new CustomEvent("snoop:ai-form", {
                detail: {
                  kind,
                  patch:
                    kind === "member"
                      ? { ...(to !== path ? context.member : {}), ...proposal.member }
                      : { ...(to !== path ? context.product : {}), ...proposal.product },
                  respond: (v: any) => (applied = v),
                },
              }),
            );
            if (!applied) {
              setClarification("Categoría no identificada. Selecciónala en el formulario.");
              return;
            }
          }
          if (proposal.intent === "search" && proposal.target === "members")
            window.dispatchEvent(
              new CustomEvent("snoop:search-members", { detail: { query: proposal.query ?? "" } }),
            );
          conversationMemory.current = reduceConversation(context, proposal);
          setClarification(proposal.question || "Revisa los datos. Nada guardado.");
        } catch {
          setClarification("No se pudo preparar el formulario. No se guardó nada.");
        } finally {
          executing.current = false;
        }
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        return { aiMs, interpretationMs: aiMs, executionMs: performance.now() - executionStart };
      }
      let intent = planSnoopTurn(text, locRef.current.pathname);
      let aiMs = 0;
      if (intent.kind === "stop") {
        stopSession();
        setFeedback("Escucha terminada.");
        return;
      }
      const commandText = intent.kind === "command" ? intent.text : "";
      const routeCommand =
        intent.kind === "command" &&
        (premiumVoiceIntent(commandText, locRef.current.pathname) ||
          (!Object.keys(parseAdministrativeDictation(commandText)).length &&
            NAV_INTENTS.some((n) => n.rx.test(commandText))));
      if (
        !routeCommand &&
        locRef.current.pathname === "/soci/nuovo" &&
        voiceIntentAllowed(accessRef.current.access, "/soci/nuovo")
      ) {
        let reply: { handled: boolean; message: string } | undefined;
        window.dispatchEvent(
          new CustomEvent("snoop:member-conversation", {
            detail: {
              text,
              language,
              respond: (result: typeof reply) => {
                reply = result;
              },
            },
          }),
        );
        if (reply?.handled) {
          setClarification(reply.message);
          const interpretationMs = performance.now() - interpretationStart;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          );
          return {
            interpretationMs,
            executionMs: performance.now() - interpretationStart - interpretationMs,
          };
        }
      }
      let interpretationMs = performance.now() - interpretationStart;
      setTranscript(text);
      if (intent.kind === "uncertain") {
        setClarification(intent.message);
        const projection = projectSnoopTurn(text, locRef.current.pathname);
        const safe =
          projection.sketch.symbols.length > 0 &&
          !projection.sketch.symbols.some((s) => ["commit", "negate", "stop"].includes(s));
        if (safe && commandAiConsent && !aiBudget.current.blocked && aiBudget.current.count < 10) {
          aiBudget.current.count++;
          const epoch = sessionEpoch.current;
          const path = locRef.current.pathname;
          const revision = fieldEdits.current;
          const identity = JSON.stringify(accessRef.current);
          const aiStart = performance.now();
          try {
            const proposal = await proposeNavigation({
              data: { sketch: projection.sketch, consent: true },
            });
            aiMs = performance.now() - aiStart;
            if (proposal.error) {
              aiBudget.current.blocked = true;
              if (activeRef.current && sessionEpoch.current === epoch)
                setClarification(
                  proposal.error === "quota"
                    ? "Cuota IA agotada. Usa el formulario o comandos locales."
                    : "SNOOP temporalmente limitado. Usa el formulario o comandos locales.",
                );
              return {
                interpretationMs: performance.now() - interpretationStart,
                executionMs: 0,
                aiMs,
              };
            }
            if (
              activeRef.current &&
              sessionEpoch.current === epoch &&
              locRef.current.pathname === path &&
              fieldEdits.current === revision &&
              JSON.stringify(accessRef.current) === identity &&
              proposal.command &&
              sketchSupports(proposal.command, projection.sketch)
            ) {
              const target =
                premiumVoiceIntent(proposal.command, path)?.to ??
                NAV_INTENTS.find((n) => n.rx.test(proposal.command!))?.to;
              if (target && voiceIntentAllowed(accessRef.current.access, target)) {
                intent = {
                  kind: "command",
                  text: bindSnoopCommand(proposal.command, projection.localReference),
                };
                setClarification("");
              }
            }
          } catch {
            aiMs = performance.now() - aiStart;
            aiBudget.current.blocked = true;
            if (activeRef.current && sessionEpoch.current === epoch)
              setClarification("SNOOP no disponible. Usa un comando local o el formulario.");
          }
        }
        if (intent.kind === "uncertain")
          return {
            interpretationMs: performance.now() - interpretationStart,
            executionMs: 0,
            aiMs,
          };
      }
      interpretationMs = performance.now() - interpretationStart;
      setManual(intent.text);
      executing.current = true;
      setStage("Ejecutando");
      try {
        const applied = await handleTranscript(intent.text);
        if (applied === false) {
          setClarification("No tienes permiso para esta función.");
          return;
        }
        const selector = /^Crear socio\b/i.test(intent.text)
          ? "[data-snoop-member-form]"
          : /^Crear producto\b/i.test(intent.text)
            ? "[data-snoop-product-form]"
            : null;
        if (selector) {
          const until = performance.now() + 5000;
          while (!document.querySelector(selector)?.getClientRects().length) {
            if (continuous && !activeRef.current) return;
            if (performance.now() > until) {
              stopSession();
              setFeedback("No se pudo abrir el formulario. Reintenta.");
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      } finally {
        executing.current = false;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (/^Crear socio\b/i.test(intent.text)) {
        let ready = false;
        const until = performance.now() + 1000;
        while (!ready && locRef.current.pathname === "/soci/nuovo" && performance.now() < until) {
          window.dispatchEvent(
            new CustomEvent("snoop:member-conversation", {
              detail: {
                text: null,
                language,
                respond: (reply: { message: string }) => {
                  ready = true;
                  setClarification(reply.message);
                },
              },
            }),
          );
          if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      return {
        interpretationMs,
        executionMs: performance.now() - interpretationStart - interpretationMs,
        aiMs,
      };
    },
  });
  cancelRef.current = dictation.cancel;
  useEffect(() => {
    if (dictation.error) {
      stopSession();
      setFault(dictation.error.slice(0, 160));
      setFeedback(dictation.error.slice(0, 160));
    }
  }, [dictation.error, stopSession]);
  useEffect(() => {
    if (
      dictation.phase !== "idle" ||
      !continuous ||
      !sessionActive ||
      !activeRef.current ||
      dictation.error
    )
      return;
    const timer = setTimeout(() => {
      if (activeRef.current && document.visibilityState === "visible" && navigator.onLine)
        void dictation.start();
    }, 150);
    return () => clearTimeout(timer);
  }, [dictation.phase, sessionActive, dictation.error, dictation.start, continuous]);
  useEffect(() => {
    sessionEpoch.current++;
    setClarification("");
    if (voiceDestination.current === location.pathname) {
      voiceDestination.current = null;
      return;
    }
    voiceDestination.current = null;
    conversationGeneration.current++;
    if (activeRef.current) {
      if (continuous) dictation.cancel();
      else stopSession();
    }
  }, [location.pathname]);
  useEffect(() => {
    onPhaseChange?.(dictation.phase);
  }, [dictation.phase, onPhaseChange]);
  useEffect(() => () => onPhaseChange?.("idle"), [onPhaseChange]);
  const enabled = dictation.phase === "recording",
    busy = dictation.phase === "starting" || dictation.phase === "processing";
  // Start events never toggle/stop an active recording. The hook serializes starts.
  const startRecording = useCallback(() => {
    if (activeRef.current) return;
    if (!consent) {
      setConsentPrompt(true);
      return;
    }
    setConsentPrompt(false);
    setFault("");
    setPanelOpen(!continuous);
    setFeedback("");
    activeRef.current = true;
    setSessionActive(true);
    void dictation.start();
  }, [consent, dictation.start, stopSession, continuous]);
  useEffect(() => {
    if (dictation.phase === "idle" && closeWhenIdle.current) {
      closeWhenIdle.current = false;
      setPanelOpen(false);
    }
  }, [dictation.phase]);
  useEffect(() => {
    window.addEventListener("snoop:voice-start", startRecording);
    return () => window.removeEventListener("snoop:voice-start", startRecording);
  }, [startRecording]);
  useEffect(() => {
    const toggle = () => {
      if (activeRef.current) stopSession();
      else startRecording();
    };
    window.addEventListener("snoop:voice-toggle", toggle);
    return () => window.removeEventListener("snoop:voice-toggle", toggle);
  }, [startRecording, stopSession]);
  useEffect(() => {
    const open = () => {
      stopSession();
      setPanelOpen(true);
    };
    window.addEventListener("snoop:voice-open", open);
    return () => window.removeEventListener("snoop:voice-open", open);
  }, []);
  useEffect(() => {
    setPanelOpen(false);
    closeWhenIdle.current = false;
    stopSession();
    setConsentPrompt(false);
    setManual("");
    setTranscript("");
  }, [scope]);
  useEffect(() => {
    if (location.pathname !== "/caja" || !voiceIntentAllowed(access, "/caja")) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const openReport = (attempt = 0) => {
      if (!active) return;
      let pending: any;
      try {
        pending = JSON.parse(sessionStorage.getItem("snoop:cash-report-open") || "null");
      } catch {
        return;
      }
      if (!pending) return;
      if (
        !Number.isFinite(pending.at) ||
        pending.userId !== userId ||
        pending.clubId !== access.clubId ||
        Date.now() - pending.at > 15000 ||
        Date.now() < pending.at
      ) {
        sessionStorage.removeItem("snoop:cash-report-open");
        return;
      }
      const tab = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (t) => t.textContent === "Informe de caja",
      );
      if (tab && !tab.matches(":disabled")) {
        // Radix Tabs selects on keyboard activation, not a synthetic click alone.
        tab.focus();
        tab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        sessionStorage.removeItem("snoop:cash-report-open");
      } else if (attempt < 300) timer = setTimeout(() => openReport(attempt + 1), 50);
    };
    const event = () => openReport();
    openReport();
    window.addEventListener("snoop:cash-report-open", event);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("snoop:cash-report-open", event);
    };
  }, [scope, location.pathname]);
  const shortError = /Permiso|denegado/i.test(fault)
    ? "Permite el micrófono para continuar."
    : /conex|fetch|network/i.test(fault)
      ? "Sin conexión. Puedes usar el teclado."
      : /tarda|timeout/i.test(fault)
        ? "La voz tarda demasiado. Reintenta."
        : "Voz no disponible. Puedes usar el teclado.";
  const status =
    dictation.phase === "processing"
      ? stage === "Escuchando"
        ? "Transcribiendo"
        : stage
      : dictation.phase === "starting"
        ? "Activando micrófono"
        : "SNOOP ESCUCHANDO";
  return (
    <>
      {(sessionActive || consentPrompt || feedback || dictation.error) && !panelOpen && (
        <aside
          className={`snoop-listening ${speaking ? "is-speaking" : ""}`}
          aria-label="Sesión de voz"
          data-phase={dictation.phase}
          data-active={sessionActive}
        >
          <span className="snoop-listening-dot" aria-hidden="true" />
          <span role="status">
            {consentPrompt
              ? "Permite transcribir con Cloudflare Whisper. El audio no se guarda."
              : sessionActive
                ? dictation.phase === "processing" || dictation.phase === "starting"
                  ? status
                  : clarification || status
                : fault
                  ? shortError
                  : feedback || dictation.error}
          </span>
          {consentPrompt && (
            <button
              onClick={() => {
                setConsentFor({ key: consentKey, allowed: true });
                try {
                  localStorage.setItem(consentKey, "cloudflare-whisper");
                } catch {}
                setConsentPrompt(false);
                setPanelOpen(!continuous);
                activeRef.current = true;
                setSessionActive(true);
                void dictation.start();
              }}
            >
              Permitir y escuchar
            </button>
          )}
          <button
            aria-label="Terminar escucha"
            onClick={() => {
              stopSession();
              setConsentPrompt(false);
              setFeedback("");
            }}
          >
            <X size={18} />
          </button>
          <button
            aria-label="Ajustes de voz"
            onClick={() => {
              stopSession();
              setPanelOpen(true);
            }}
          >
            <Settings2 size={16} />
          </button>
        </aside>
      )}
      {panelOpen ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="SNOOP"
          className="premium-voice-panel"
          data-phase={dictation.phase}
        >
          <header>
            <strong>SNOOP</strong>
            <button
              type="button"
              aria-label="Cerrar SNOOP"
              onClick={() => {
                closeWhenIdle.current = false;
                stopSession();
                setPanelOpen(false);
                setFeedback("");
              }}
            >
              <X size={20} />
            </button>
          </header>
          <p className="text-xs text-muted-foreground">
            Comandos administrativos · Revisa y confirma siempre en el formulario.
          </p>
          <label className="text-xs">
            Interpretación SNOOP
            <select
              aria-label="Modo conversacional"
              value={conversationMode}
              onChange={(e) => {
                stopSession();
                setConversationMode(e.target.value as any);
                setCommandAiConsent(false);
                setSyntheticConfirmed(false);
              }}
            >
              <option value="off">Local / navegación privada</option>
              <option value="pilot" disabled={!conversationModes.pilot}>
                PILOT · solo datos sintéticos
              </option>
              <option value="real" disabled={!conversationModes.real}>
                REAL · requiere revisión de privacidad
              </option>
            </select>
          </label>
          {conversationMode === "pilot" && (
            <label className="text-xs flex gap-2">
              <input
                type="checkbox"
                checked={syntheticConfirmed}
                onChange={(e) => setSyntheticConfirmed(e.target.checked)}
              />
              Confirmo que usaré exclusivamente datos sintéticos.
            </label>
          )}
          <label className="text-xs flex gap-2">
            <input
              type="checkbox"
              checked={commandAiConsent}
              onChange={(e) => setCommandAiConsent(e.target.checked)}
            />
            {conversationMode === "off"
              ? "Permitir sugerencias IA de navegación sin datos personales (requiere configuración autorizada)."
              : conversationMode === "pilot"
                ? "Permitir conversación Cloudflare con datos sintéticos."
                : "Permitir contexto mínimo Cloudflare según la revisión de privacidad."}
          </label>
          <label className="text-xs">
            Idioma de voz / Lingua voce
            <select
              aria-label="Idioma de voz / Lingua voce"
              value={language}
              disabled={busy || enabled}
              onChange={(e) => {
                dictation.cancel();
                setLanguage(e.target.value);
                localStorage.setItem("snoop:voice-language", e.target.value);
                window.dispatchEvent(new Event("snoop:voice-language"));
              }}
            >
              <option value="es-ES">Español</option>
              <option value="it-IT">Italiano</option>
            </select>
          </label>
          <label className="premium-voice-consent">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => {
                stopSession();
                setContinuous(e.target.checked);
                try {
                  localStorage.setItem(
                    consentKey + ":mode",
                    e.target.checked ? "continuous" : "single",
                  );
                } catch {}
              }}
            />
            Continuar escuchando
          </label>
          <label className="premium-voice-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || enabled}
              onChange={(e) => {
                const allowed = e.target.checked;
                setConsentFor({ key: consentKey, allowed });
                try {
                  if (allowed) localStorage.setItem(consentKey, "cloudflare-whisper");
                  else localStorage.removeItem(consentKey);
                } catch {}
                if (allowed) {
                  activeRef.current = true;
                  setSessionActive(true);
                  void dictation.start();
                } else {
                  closeWhenIdle.current = false;
                  dictation.cancel();
                }
              }}
            />
            Autorizo la transcripción con Cloudflare Whisper (recordar en este dispositivo). SNOOP
            no conserva la grabación.
          </label>
          <button
            type="button"
            className={`premium-record ${enabled ? "is-listening" : ""}`}
            aria-label={enabled ? "Apagar SNOOP" : "Encender SNOOP"}
            disabled={busy || !consent}
            onClick={
              enabled
                ? dictation.finish
                : () => {
                    activeRef.current = true;
                    setSessionActive(true);
                    void dictation.start();
                  }
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : enabled ? <Square /> : <Mic />}
            {busy
              ? "Procesando…"
              : enabled
                ? "Escuchando · Terminaré cuando dejes de hablar"
                : "Iniciar dictado"}
          </button>
          {(feedback || dictation.error || fault || enabled) && (
            <p role={dictation.error || fault ? "alert" : "status"}>
              {dictation.error ||
                fault ||
                (enabled
                  ? "Escuchando. El audio se envía al finalizar, con tu permiso."
                  : feedback)}
            </p>
          )}
          {dictation.hint && <p role="status">{dictation.hint}</p>}
          {(enabled || busy) && (
            <button type="button" onClick={stopSession}>
              Cancelar dictado
            </button>
          )}
          {transcript && (
            <p className="text-xs text-muted-foreground" aria-label="Transcripción">
              {transcript}
            </p>
          )}
          {timings.length > 0 && (
            <p aria-label="Medición de voz">
              Última frase: captura {Math.round(timings.at(-1)!.captureMs)} ms · transcripción{" "}
              {Math.round(timings.at(-1)!.transcriptionMs)} ms · interpretación{" "}
              {Math.round(timings.at(-1)!.interpretationMs)} ms. HTTP y modelo no separables en
              cliente.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && !enabled && manual.trim()) {
                void handleTranscript(manual);
                setPanelOpen(false);
              }
            }}
          >
            <label>
              También puedes escribir el comando
              <input
                aria-label="Comando escrito"
                value={manual}
                disabled={busy || enabled}
                onChange={(e) => setManual(e.target.value)}
                maxLength={12000}
                placeholder="Buscar socio Carlos García"
              />
            </label>
            <button type="submit" disabled={busy || enabled || !manual.trim()}>
              Aplicar comando
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
