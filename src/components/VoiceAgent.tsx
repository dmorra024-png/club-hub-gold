import { useEffect, useRef, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { Mic, MicOff, Loader2, Ear } from "lucide-react";
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
    to: "/cuotas",
    rx: /\b(incassi|ingresos|registro quote|incassi quote|informe cuotas|report quote)\b/i,
    label: "Ingresos asociativos",
  },
  { to: "/ajustes/cuotas", rx: /\b(cuotas|cuotas? mensual|planes)\b/i, label: "Cuotas" },
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
  hideIdleControls = false,
  access,
  userId,
}: {
  clubName?: string | null;
  hideIdleControls?: boolean;
  access: AccountAccess;
  userId: string;
}) {
  const [language, setLanguage] = useState("es-ES");
  const [feedback, setFeedback] = useState("");
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
    ...access.permissions,
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

        // Informational research must never fall through to member/product search.
        const informational = informationalVoiceCommand(text);
        if (informational) {
          allow("/geneticas");
          window.sessionStorage.setItem(
            "snoop:genetics-query",
            JSON.stringify({ at: Date.now(), query: informational.query }),
          );
          if (path === "/geneticas") window.dispatchEvent(new Event("snoop:genetics-query"));
          else navigate({ to: "/geneticas" });
          toast.info("Revisa el nombre y pulsa Buscar. No se ha guardado nada.");
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
          // Product creation must reach the parent form parser, not only the
          // stock-list category filter listening to productos-voice.
          if (/\\b(?:crea|crear|creare|nuevo|nuovo|nueva|alta|añadir|anadir|agregar|registrar)\\b[\\s\\S]{0,80}\\b(?:producto|prodotti|prodotto|productos)\\b/i.test(text)) {
            window.dispatchEvent(new CustomEvent("snoop:productos-command", { detail: { text, tab: "nuevo" } }));
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
      } finally {
        processingRef.current = false;
      }
    },
    [navigate],
  );

  const dictation = useWhisperDictation({
    scope,
    language: language.startsWith("it") ? "it" : "es",
    available: aiStatus,
    transcribe: (data) => transcribe({ data }),
    onTranscript: handleTranscript,
  });
  const enabled = dictation.phase === "recording",
    busy = dictation.phase === "starting" || dictation.phase === "processing";
  const toggle = useCallback(() => {
    if (enabled) dictation.finish();
    else if (!busy) void dictation.start();
  }, [enabled, busy, dictation.start, dictation.finish]);
  useEffect(() => {
    window.addEventListener("snoop:voice-start", toggle);
    return () => window.removeEventListener("snoop:voice-start", toggle);
  }, [toggle]);
  return (
    <>
      {(feedback || dictation.error || busy || enabled) && (
        <aside
          aria-label="Respuesta del asistente"
          className="snoop-voice-feedback fixed right-4 bottom-44 z-40 max-h-[35svh] overflow-auto max-w-[min(90vw,380px)] rounded-lg border border-neon/30 bg-card p-3 text-sm shadow-lg"
        >
          <p role={dictation.error ? "alert" : "status"}>
            {dictation.error ||
              (busy
                ? "Procesando el dictado…"
                : enabled
                  ? "Escuchando. Pulsa el micrófono para enviar el audio a Cloudflare Whisper."
                  : feedback)}
          </p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              setFeedback("");
              dictation.cancel();
            }}
          >
            {busy || enabled ? "Cancelar dictado" : "Cerrar"}
          </button>
        </aside>
      )}
      <select
        hidden={hideIdleControls && !enabled && !busy}
        aria-label="Idioma de voz / Lingua voce"
        value={language}
        onChange={(e) => {
          dictation.cancel();
          setLanguage(e.target.value);
          try {
            window.localStorage.setItem("snoop:voice-language", e.target.value);
          } catch {}
          window.dispatchEvent(new Event("snoop:voice-language"));
        }}
        className="snoop-voice-language fixed bottom-24 right-5 z-40 rounded border border-neon/30 bg-card p-1 text-xs text-neon"
      >
        <option value="es-ES">ES</option>
        <option value="it-IT">IT</option>
      </select>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || access.status !== "active"}
        hidden={hideIdleControls && !enabled && !busy}
        aria-label={enabled ? "Apagar Snoop" : "Encender Snoop"}
        title="Audio a Cloudflare Whisper; interpretación administrativa local. Pulsa otra vez para enviar."
        className={`snoop-voice-toggle fixed z-40 bottom-5 right-5 md:bottom-8 md:right-8 h-16 w-16 rounded-full flex items-center justify-center transition-all ${enabled ? "bg-gradient-neon text-primary-foreground glow-neon animate-pulse" : "bg-card border border-neon/40 text-neon"}`}
      >
        {busy ? (
          <Loader2 className="w-6 h-6 animate-spin" />
        ) : enabled ? (
          <Ear className="w-7 h-7" />
        ) : (
          <MicOff className="w-7 h-7" />
        )}
      </button>
    </>
  );
}
