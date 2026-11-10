import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { useWhisperDictation } from "@/hooks/useWhisperDictation";
import { demoStatus, interpretSnoopDemo, transcribeSnoopDemo } from "@/lib/snoop-demo.functions";
import {
  emptyConversation, reduceConversation, ConversationProposal,
  type ConversationMemoryValue,
} from "@/lib/snoop-conversation";

export const Route = createFileRoute("/_authenticated/snoop-demo")({
  component: SnoopAiDemo,
});

const memberLabels = {
  first_name: "Nombre",
  last_name: "Apellidos",
  birth_date: "Fecha de nacimiento",
  city: "Ciudad",
  phone: "Teléfono",
};
const productLabels = { name: "Producto", category: "Categoría" };

function SnoopAiDemo() {
  const { user, access } = useAuth();
  const getStatus = useServerFn(demoStatus);
  const interpret = useServerFn(interpretSnoopDemo);
  const transcribe = useServerFn(transcribeSnoopDemo);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [language, setLanguage] = useState<"es" | "it">("es");
  const [kind, setKind] = useState<"member" | "product">("member");
  const [input, setInput] = useState("");
  const [memory, setMemory] = useState<ConversationMemoryValue>(emptyConversation());
  const memoryRef = useRef<ConversationMemoryValue>(emptyConversation());
  const [history, setHistory] = useState<Array<{ input: string; result: string }>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const request = useRef(false);
  const identity = [user?.id, access.clubId, access.status, access.role].join(":");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAvailable(false);
    void getStatus().then((v) => {
      if (active) setAvailable(v.available === true);
    }).catch(() => {
      if (active) setAvailable(false);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [getStatus, identity]);

  const reset = useCallback(() => {
    epoch.current++;
    memoryRef.current = emptyConversation();
    setMemory(memoryRef.current);
    setInput("");
    setHistory([]);
    setError("");
    setBusy(false);
    request.current = false;
  }, []);
  useEffect(() => { reset(); setConfirmed(false); setVoiceConsent(false); }, [identity, reset]);

  const send = useCallback(async (raw: string) => {
    const value = raw.trim();
    if (!value || !confirmed || !available || request.current || !user?.id || !access.clubId) return;
    const currentEpoch = epoch.current;
    request.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await interpret({
        data: {
          mode: "demo", owner: { userId: user.id, clubId: access.clubId },
          consent: true, synthetic: true, text: value,
          screen: kind === "member" ? "member_create" : "product_create",
          context: memoryRef.current,
        },
      });
      if (currentEpoch !== epoch.current) return;
      const result = ConversationProposal.parse(response);
      if (result.intent === "stop") {
        reset();
        return;
      }
      const next = reduceConversation(memoryRef.current, result);
      memoryRef.current = next;
      setMemory(next);
      setHistory((prev) => [...prev.slice(-9), { input: value, result: result.question || (
        result.target ? "Acción simulada: " + result.target : "Borrador actualizado · nada guardado"
      ) }]);
      setInput("");
    } catch {
      if (currentEpoch === epoch.current)
        setError("La IA no respondió o la propuesta fue rechazada. No se cambió ningún dato.");
    } finally {
      if (currentEpoch === epoch.current) {
        request.current = false;
        setBusy(false);
      }
    }
  }, [confirmed, available, user?.id, access.clubId, interpret, kind, reset]);

  const voice = useWhisperDictation({
    scope: "snoop-demo:" + identity + ":" + language + ":" + kind,
    language,
    continuous: false,
    available: async () => ({ available: available && confirmed && voiceConsent }),
    transcribe: (data) => transcribe({
      data: { ...data, synthetic: true, consent: true },
    }),
    onTranscript: async (text) => { await send(text); },
  });
  const changeKind = (value: "member" | "product") => {
    voice.cancel();
    reset();
    setKind(value);
  };
  return (
    <SnoopLayout title="SNOOP AI · DEMO" subtitle="Laboratorio temporal · Android, iPhone, iPad y tablets">
      <section className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-amber-500/30 bg-slate-950/80 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold text-amber-300">SNOOP AI · DEMO</h1>
        <p className="text-sm text-amber-100">Prueba Whisper + GLM con información inventada. Esta pantalla no guarda socios, productos ni movimientos. Nunca introduzcas datos reales.</p>
        {loading ? <p role="status">Verificando disponibilidad…</p> : !available ?
          <p role="alert">La IA DEMO no está habilitada en este entorno.</p> : null}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => {
            voice.cancel(); reset(); setConfirmed(e.target.checked);
          }} />
          Confirmo que usaré exclusivamente nombres y datos inventados.
        </label>
        <label className="block text-sm">Tipo de prueba
          <select className="mt-2 w-full rounded-lg border border-amber-400/40 bg-slate-900 p-3 text-white" value={kind} onChange={(e) => changeKind(e.target.value as "member" | "product")}>
            <option value="member">Socio inventado</option>
            <option value="product">Producto inventado</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Idioma
            <select className="mt-2 w-full rounded-lg border border-amber-400/40 bg-slate-900 p-3 text-white" value={language}
              onChange={(e) => { voice.cancel(); setLanguage(e.target.value as "es" | "it"); }}>
              <option value="es">Español</option><option value="it">Italiano</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm pt-7">
            <input type="checkbox" checked={voiceConsent} onChange={(e) => {
              voice.cancel(); setVoiceConsent(e.target.checked);
            }} />
            Autorizo Whisper para esta prueba
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={!available || !confirmed || !voiceConsent || busy || voice.phase === "starting" || voice.phase === "processing"}
            className="rounded-lg border border-amber-400 bg-amber-500/20 px-4 py-3 disabled:opacity-40"
            onClick={() => { if (voice.phase === "recording") voice.finish(); else void voice.start(); }}>
            {voice.phase === "recording" ? "Terminar grabación" : "Hablar con SNOOP"}
          </button>
          <button type="button" className="rounded-lg border border-white/30 px-4 py-3" onClick={() => {
            voice.cancel(); reset();
          }}>Reiniciar prueba</button>
        </div>
        {voice.phase !== "idle" && <p role="status">Micrófono: {voice.phase}</p>}
        {voice.error && <p role="alert" className="text-amber-200">{voice.error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="space-y-2">
          <label htmlFor="snoop-demo-message" className="block text-sm">O escribe la frase
            <textarea id="snoop-demo-message" value={input} maxLength={1200}
              onChange={(e) => setInput(e.target.value)}
              placeholder={kind === "member" ? "Crea un socio llamado Mario Rossi, nacido el 15/03/1990" : "Crea un producto llamado Mango Haze"}
              className="mt-2 min-h-24 w-full rounded-lg border border-amber-400/40 bg-slate-900 p-3 text-white" />
          </label>
          <button type="submit" disabled={!available || !confirmed || busy || !input.trim()}
            className="w-full rounded-lg bg-amber-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-40">
            {busy ? "Interpretando…" : "Interpretar con IA"}
          </button>
        </form>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <div className="space-y-2 rounded-xl border border-amber-500/25 p-4" aria-label="Vista previa temporal">
          <h2 className="text-lg text-amber-300">Vista previa · no se guarda</h2>
          {Object.entries(kind === "member" ? memberLabels : productLabels).map(([field, label]) => (
            <div key={field} className="flex justify-between gap-3 border-b border-white/10 py-2 text-sm">
              <span>{label}</span>
              <strong className="text-right">{(kind === "member" ? memory.member : memory.product)[field as keyof typeof memory.member] || "—"}</strong>
            </div>
          ))}
        </div>
        {history.length > 0 && <div className="space-y-3" aria-label="Conversación DEMO">
          {history.map((turn, index) => <div key={index} className="rounded-xl bg-slate-900 p-3 text-sm">
            <p className="text-white">{turn.input}</p>
            <p className="mt-2 text-amber-300">{turn.result}</p>
          </div>)}
        </div>}
      </section>
    </SnoopLayout>
  );
}
