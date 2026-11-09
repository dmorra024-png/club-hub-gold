import { premiumVoiceIntent } from "@/lib/premium-voice";
import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Mic, X, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { informationalVoiceCommand } from "@/lib/informational-voice";
import { parseAdministrativeDictation } from "@/lib/member-administration";
import { transcribeAudio, getAdministrativeAiStatus } from "@/lib/voice-agent.functions";

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
  const [language, setLanguage] = useState("es-ES");
  const [feedback, setFeedback] = useState("");
  const [panelOpen, setPanelOpen] = useState(false),
    [manual, setManual] = useState(""),
    [transcript, setTranscript] = useState("");
  const consentKey = `snoop:voice-consent:v2:${userId}:${access.clubId ?? ""}`;
  const [consentFor, setConsentFor] = useState({ key: "", allowed: false });
  const consent = consentFor.key === consentKey && consentFor.allowed;
  const closeWhenIdle = useRef(false);
  useEffect(() => {
    let allowed = false;
    try {
      allowed = localStorage.getItem(consentKey) === "cloudflare-whisper";
    } catch {}
    setConsentFor({ key: consentKey, allowed });
  }, [consentKey]);
  const aiStatus = useServerFn(getAdministrativeAiStatus),
    transcribe = useServerFn(transcribeAudio);
  const processingRef = useRef(false);
  const navigate = useNavigate(),
    location = useLocation(),
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
    location.pathname,
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
    setFeedback("");
  }, [scope]);
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
    onStart: () => {
      closeWhenIdle.current = false;
      recordingEdits.current = fieldEdits.current;
    },
    onTranscript: (text) => {
      if (fieldEdits.current !== recordingEdits.current) {
        toast.info("Se conserva tu edición manual. Repite el dictado si lo necesitas.");
        closeWhenIdle.current = true;
        return;
      }
      toast.info(`Transcripción: ${text.slice(0, 180)}`);
      setTranscript(text);
      setManual(text);
      return handleTranscript(text).then((result) => {
        closeWhenIdle.current = result !== false;
      });
    },
  });
  useEffect(() => {
    onPhaseChange?.(dictation.phase);
  }, [dictation.phase, onPhaseChange]);
  useEffect(() => () => onPhaseChange?.("idle"), [onPhaseChange]);
  const enabled = dictation.phase === "recording",
    busy = dictation.phase === "starting" || dictation.phase === "processing";
  // Start events never toggle/stop an active recording. The hook serializes starts.
  const startRecording = useCallback(() => {
    setPanelOpen(true);
    if (consent) void dictation.start();
  }, [consent, dictation.start]);
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
    const open = () => setPanelOpen(true);
    window.addEventListener("snoop:voice-open", open);
    return () => window.removeEventListener("snoop:voice-open", open);
  }, []);
  useEffect(() => {
    setPanelOpen(false);
    closeWhenIdle.current = false;
    dictation.cancel();
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
  }, [scope]);
  return panelOpen ? (
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Voice 2.0"
      className="premium-voice-panel"
      data-phase={dictation.phase}
    >
      <header>
        <strong>Voice 2.0</strong>
        <button
          type="button"
          aria-label="Cerrar Voice 2.0"
          onClick={() => {
            closeWhenIdle.current = false;
            dictation.cancel();
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
          checked={consent}
          disabled={busy || enabled}
          onChange={(e) => {
            const allowed = e.target.checked;
            setConsentFor({ key: consentKey, allowed });
            try {
              if (allowed) localStorage.setItem(consentKey, "cloudflare-whisper");
              else localStorage.removeItem(consentKey);
            } catch {}
            if (allowed) void dictation.start();
            else {
              closeWhenIdle.current = false;
              dictation.cancel();
            }
          }}
        />
        Autorizo la transcripción con Cloudflare Whisper (recordar en este dispositivo). SNOOP no
        conserva la grabación.
      </label>
      <button
        type="button"
        className={`premium-record ${enabled ? "is-listening" : ""}`}
        aria-label={enabled ? "Apagar Snoop" : "Encender Snoop"}
        disabled={busy || !consent}
        onClick={enabled ? dictation.finish : startRecording}
      >
        {busy ? <Loader2 className="animate-spin" /> : enabled ? <Square /> : <Mic />}
        {busy
          ? "Procesando…"
          : enabled
            ? "Escuchando · Terminaré cuando dejes de hablar"
            : "Iniciar dictado"}
      </button>
      {(feedback || dictation.error || enabled) && (
        <p role={dictation.error ? "alert" : "status"}>
          {dictation.error ||
            (enabled ? "Escuchando. El audio se envía al finalizar, con tu permiso." : feedback)}
        </p>
      )}
      {dictation.hint && <p role="status">{dictation.hint}</p>}
      {(enabled || busy) && (
        <button type="button" onClick={() => dictation.cancel()}>
          Cancelar dictado
        </button>
      )}
      {transcript && (
        <p className="text-xs text-muted-foreground" aria-label="Transcripción">
          {transcript}
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
  ) : null;
}
