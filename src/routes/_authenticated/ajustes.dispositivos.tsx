import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Scale, QrCode, PenLine, Loader2, Check, Plug, X } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

export const Route = createFileRoute("/_authenticated/ajustes/dispositivos")({
  component: Dispositivos,
});

type ScalePref = { connected: boolean; baudRate: number; label?: string };
type QrPref = { mode: "camera" | "hid"; connected: boolean };
type SigPref = { mode: "pad" | "external"; connected: boolean; label?: string };

function loadPref<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? { ...fallback, ...JSON.parse(v) } : fallback; } catch { return fallback; }
}
function savePref<T>(k: string, v: T) { localStorage.setItem(k, JSON.stringify(v)); }

function Dispositivos() {
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!loading && !isAdmin) nav({ to: "/" }); }, [loading, isAdmin, nav]);
  if (loading || !isAdmin) return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;

  return (
    <SnoopLayout title="Dispositivos" subtitle="Conecta báscula, lector QR y tableta de firma">
      <div className="grid gap-5 max-w-3xl">
        <ScaleCard />
        <QrCard />
        <SignatureCard />
      </div>
    </SnoopLayout>
  );
}

/* ---------------- Báscula (Web Serial) ---------------- */

function ScaleCard() {
  const [pref, setPref] = useState<ScalePref>(() => loadPref("snoop:device:scale", { connected: false, baudRate: 9600 }));
  const [port, setPort] = useState<any>(null);
  const [reading, setReading] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const readerRef = useRef<any>(null);
  const available = typeof navigator !== "undefined" && "serial" in navigator;

  async function connect() {
    if (!available) return toast.error("Tu navegador no soporta Web Serial. Usa Chrome o Edge en escritorio.");
    setBusy(true);
    try {
      const p = await (navigator as any).serial.requestPort();
      await p.open({ baudRate: pref.baudRate });
      setPort(p);
      const next = { ...pref, connected: true, label: "Báscula serie" };
      setPref(next); savePref("snoop:device:scale", next);
      toast.success("Báscula conectada");
      readLoop(p);
    } catch (e: any) {
      if (e?.name !== "NotFoundError") toast.error(e.message ?? "No se ha podido conectar");
    } finally { setBusy(false); }
  }

  async function readLoop(p: any) {
    try {
      const decoder = new TextDecoderStream();
      const closed = p.readable.pipeTo(decoder.writable).catch(() => {});
      const reader = decoder.readable.getReader();
      readerRef.current = reader;
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split(/[\r\n]+/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const m = line.match(/-?\d+(?:[.,]\d+)?/);
          if (m) setReading(m[0].replace(",", "."));
        }
      }
      await closed;
    } catch { /* ignore */ }
  }

  async function disconnect() {
    try { await readerRef.current?.cancel(); } catch {}
    try { await port?.close(); } catch {}
    setPort(null); setReading("");
    const next = { ...pref, connected: false };
    setPref(next); savePref("snoop:device:scale", next);
  }

  return (
    <Card icon={Scale} title="Báscula" subtitle="Lectura de peso en gramos vía USB serial">
      {!available && <Notice>Web Serial no está disponible en este navegador (usa Chrome/Edge en escritorio).</Notice>}
      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
        <label className="block">
          <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">Baudios</div>
          <select
            value={pref.baudRate}
            onChange={(e) => { const next = { ...pref, baudRate: Number(e.target.value) }; setPref(next); savePref("snoop:device:scale", next); }}
            className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm">
            {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        {pref.connected && port ? (
          <button onClick={disconnect} className="px-4 py-2 rounded-md border border-red-500/40 text-red-300 text-xs uppercase tracking-widest hover:bg-red-500/10">
            <X className="w-3 h-3 inline mr-1" /> Desconectar
          </button>
        ) : (
          <button onClick={connect} disabled={busy || !available}
            className="px-4 py-2 rounded-md bg-gradient-neon text-primary-foreground text-xs uppercase tracking-widest font-display glow-neon-soft disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : <Plug className="w-3 h-3 inline mr-1" />} Emparejar
          </button>
        )}
      </div>

      <div className="mt-4 rounded-lg border border-neon/20 bg-input/40 p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Lectura en vivo</div>
        <div className="font-display text-3xl text-neon mt-1">{reading || "—"} <span className="text-sm text-muted-foreground">g</span></div>
      </div>
    </Card>
  );
}

/* ---------------- Lector QR / barras ---------------- */

function QrCard() {
  const [pref, setPref] = useState<QrPref>(() => loadPref("snoop:device:qr", { mode: "camera", connected: true }));
  const [test, setTest] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function setMode(mode: QrPref["mode"]) {
    const next = { ...pref, mode, connected: true };
    setPref(next); savePref("snoop:device:qr", next);
  }

  return (
    <Card icon={QrCode} title="Lector QR / código de barras" subtitle="Cámara del dispositivo o lector USB tipo teclado">
      <div className="grid sm:grid-cols-2 gap-2">
        <button onClick={() => setMode("camera")}
          className={`px-4 py-3 rounded-lg border text-sm transition ${pref.mode === "camera" ? "border-neon bg-neon/10 text-neon" : "border-border bg-input text-foreground hover:border-neon/50"}`}>
          Cámara
        </button>
        <button onClick={() => setMode("hid")}
          className={`px-4 py-3 rounded-lg border text-sm transition ${pref.mode === "hid" ? "border-neon bg-neon/10 text-neon" : "border-border bg-input text-foreground hover:border-neon/50"}`}>
          Lector USB (modo teclado)
        </button>
      </div>

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">Prueba de escaneo</div>
        <input ref={inputRef} value={test} onChange={(e) => setTest(e.target.value)}
          placeholder="Escanea o escribe un código aquí…"
          className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
        {test && <div className="mt-2 text-xs text-neon flex items-center gap-1"><Check className="w-3 h-3" /> Recibido: {test}</div>}
      </div>
    </Card>
  );
}

/* ---------------- Tableta de firma ---------------- */

function SignatureCard() {
  const [pref, setPref] = useState<SigPref>(() => loadPref("snoop:device:signature", { mode: "pad", connected: true }));
  const sigRef = useRef<SignaturePadHandle>(null);
  const hidAvailable = typeof navigator !== "undefined" && "hid" in navigator;

  async function pairExternal() {
    if (!hidAvailable) return toast.error("Web HID no está disponible en este navegador.");
    try {
      const devices = await (navigator as any).hid.requestDevice({ filters: [] });
      if (!devices.length) return;
      const next = { ...pref, mode: "external" as const, connected: true, label: devices[0].productName ?? "Tableta HID" };
      setPref(next); savePref("snoop:device:signature", next);
      toast.success(`Emparejada: ${next.label}`);
    } catch (e: any) { toast.error(e.message ?? "Error de emparejamiento"); }
  }

  function usePad() {
    const next = { ...pref, mode: "pad" as const, connected: true };
    setPref(next); savePref("snoop:device:signature", next);
  }

  return (
    <Card icon={PenLine} title="Tableta de firma digital" subtitle="iPad / Wacom (pointer) o tableta HID externa">
      <div className="grid sm:grid-cols-2 gap-2">
        <button onClick={usePad}
          className={`px-4 py-3 rounded-lg border text-sm transition ${pref.mode === "pad" ? "border-neon bg-neon/10 text-neon" : "border-border bg-input text-foreground hover:border-neon/50"}`}>
          Pantalla táctil / lápiz
        </button>
        <button onClick={pairExternal}
          className={`px-4 py-3 rounded-lg border text-sm transition ${pref.mode === "external" ? "border-neon bg-neon/10 text-neon" : "border-border bg-input text-foreground hover:border-neon/50"}`}>
          Tableta externa (HID)
        </button>
      </div>
      {!hidAvailable && pref.mode === "external" && <Notice>Web HID no está disponible aquí; usa Chrome/Edge en escritorio.</Notice>}
      {pref.label && <div className="mt-2 text-xs text-neon">Conectada: {pref.label}</div>}

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-2">Prueba de trazo</div>
        <SignaturePad ref={sigRef} height={180} />
        <button onClick={() => sigRef.current?.clear()} className="mt-2 text-xs text-muted-foreground hover:text-neon uppercase tracking-widest">Limpiar</button>
      </div>
    </Card>
  );
}

/* ---------------- helpers ---------------- */

function Card({ icon: Icon, title, subtitle, children }: any) {
  return (
    <div className="bg-card/60 border border-neon/25 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full border border-neon/40 flex items-center justify-center text-neon"><Icon className="w-5 h-5" /></div>
        <div>
          <div className="font-display text-lg text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Notice({ children }: any) {
  return <div className="mb-3 text-xs rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 px-3 py-2">{children}</div>;
}
