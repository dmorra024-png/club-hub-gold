import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowLeft as ArrowLeftIcon,
  Camera,
  CameraOff,
  KeyboardIcon,
  Users,
} from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/control-acceso")({
  validateSearch: (search: Record<string, unknown>) => ({
    scanner: search.scanner === true || search.scanner === "true",
  }),
  component: ControlAccesoPage,
});

type Recent = {
  id: string;
  direction: "in" | "out";
  created_at: string;
  member_number: string;
  first_name: string;
  last_name: string;
};

function ControlAccesoPage() {
  const { scanner: openScanner } = Route.useSearch();
  const { access, can, loading: accessLoading, accessError } = useAuth();
  const canScan = can("manage_members");
  const scanPermission = useRef(false);
  scanPermission.current = canScan;
  const autoStarted = useRef(false);
  const clubId = access.clubId;
  const [scannerOn, setScannerOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const cameraLife = useRef(0);
  const cameraPending = useRef(false);
  const cameraMounted = useRef(false);
  const cameraFailed = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [insideNow, setInsideNow] = useState(0);
  const [inToday, setInToday] = useState(0);
  const [outToday, setOutToday] = useState(0);
  const readerRef = useRef<Html5Qrcode | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastScanRef = useRef<{ code: string; t: number }>({ code: "", t: 0 });

  async function refreshStats() {
    if (!clubId || !scanPermission.current) return;
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("check_ins")
      .select("id,direction,created_at,member_id,members(member_number,first_name,last_name)")
      .eq("club_id", clubId)
      .order("created_at", { ascending: false })
      .limit(50);
    const list: Recent[] = ((data as any[]) ?? []).map((r) => ({
      id: r.id,
      direction: r.direction,
      created_at: r.created_at,
      member_number: r.members?.member_number ?? "",
      first_name: r.members?.first_name ?? "",
      last_name: r.members?.last_name ?? "",
    }));
    setRecents(list);

    // Today counts
    const today = list.filter((r) => new Date(r.created_at) >= startToday);
    setInToday(today.filter((r) => r.direction === "in").length);
    setOutToday(today.filter((r) => r.direction === "out").length);

    // Inside now: for each member seen today, direction of last event
    const seen = new Map<string, "in" | "out">();
    for (const r of list) {
      if (!seen.has(r.member_number)) seen.set(r.member_number, r.direction);
    }
    let inside = 0;
    seen.forEach((v) => {
      if (v === "in") inside++;
    });
    setInsideNow(inside);
  }
  useEffect(() => {
    refreshStats(); /* eslint-disable-next-line */
  }, [clubId, canScan]);

  // Focus manual input for hardware scanners
  useEffect(() => {
    if (!openScanner) inputRef.current?.focus();
  }, [openScanner]);

  function parseCode(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Accept "SNOOP:0000123" or raw digits
    const m = trimmed.match(/(?:SNOOP:)?([A-Za-z0-9_-]{3,32})/);
    return m ? m[1] : null;
  }

  async function registerScan(rawCode: string) {
    if (!scanPermission.current) {
      toast.error("Sin permiso de gestión de socios");
      return;
    }
    if (!clubId) {
      toast.error("Sin club");
      return;
    }
    const code = parseCode(rawCode);
    if (!code) {
      toast.error("Código no válido");
      return;
    }
    // De-bounce identical scans within 3s
    const now = Date.now();
    if (lastScanRef.current.code === code && now - lastScanRef.current.t < 3000) return;
    lastScanRef.current = { code, t: now };

    setBusy(true);
    try {
      const { data: member } = await supabase
        .from("members")
        .select("id, first_name, last_name, member_number")
        .eq("club_id", clubId)
        .eq("member_number", code)
        .maybeSingle();
      if (!member) {
        toast.error(`Socio ${code} no encontrado`);
        return;
      }

      // Determine direction: alternate based on last event today
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      const { data: last } = await supabase
        .from("check_ins")
        .select("direction")
        .eq("club_id", clubId)
        .eq("member_id", (member as any).id)
        .gte("created_at", startToday.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextDir: "in" | "out" = (last as any)?.direction === "in" ? "out" : "in";

      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("check_ins").insert({
        club_id: clubId,
        member_id: (member as any).id,
        direction: nextDir,
        scanned_by: u.user?.id ?? null,
      });
      if (error) throw error;

      toast.success(
        `${nextDir === "in" ? "✓ Entrada" : "↩ Salida"} · ${(member as any).first_name} ${(member as any).last_name}`,
      );
      refreshStats();
    } catch (e: any) {
      toast.error(e.message ?? "Error al registrar");
    } finally {
      setBusy(false);
      setManualCode("");
      inputRef.current?.focus();
    }
  }

  async function toggleCamera() {
    if (!scanPermission.current) return;
    if (cameraPending.current) return;
    const version = ++cameraLife.current;
    if (scannerOn) {
      try {
        await readerRef.current?.stop();
      } catch {}
      try {
        await readerRef.current?.clear();
      } catch {}
      readerRef.current = null;
      setScannerOn(false);
      setScanning(false);
      return;
    }
    cameraPending.current = true;
    cameraFailed.current = false;
    setCameraStarting(true);
    try {
      const reader = new Html5Qrcode("qr-reader");
      readerRef.current = reader;
      await reader.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (scanning) return;
          setScanning(true);
          registerScan(decoded).finally(() => setTimeout(() => setScanning(false), 1200));
        },
        () => {},
      );
      if (version !== cameraLife.current) {
        await reader.stop().catch(() => {});
        return;
      }
      setScannerOn(true);
    } catch (e: any) {
      if (version === cameraLife.current)
        toast.error(e?.message ?? "No se pudo acceder a la cámara");
    } finally {
      cameraPending.current = false;
      if (cameraMounted.current) {
        if (version !== cameraLife.current && !cameraFailed.current) autoStarted.current = false;
        setCameraStarting(false);
      }
    }
  }

  useEffect(() => {
    if (!openScanner || !clubId || !canScan || autoStarted.current) return;
    // Let the route settle; StrictMode's probe mount must not acquire a camera.
    const timer = setTimeout(() => {
      if (
        !cameraMounted.current ||
        !scanPermission.current ||
        autoStarted.current ||
        cameraPending.current
      )
        return;
      autoStarted.current = true;
      void toggleCamera();
    }, 0);
    return () => clearTimeout(timer);
  }, [openScanner, clubId, canScan, cameraStarting]);
  useEffect(() => {
    if (!accessLoading && (!canScan || accessError)) {
      cameraLife.current++;
      const reader = readerRef.current;
      readerRef.current = null;
      setScannerOn(false);
      setCameraStarting(false);
      if (reader)
        void Promise.resolve()
          .then(() => reader.stop())
          .catch(() => {});
    }
  }, [accessLoading, canScan, accessError]);
  useEffect(() => {
    cameraMounted.current = true;
    return () => {
      cameraMounted.current = false;
      autoStarted.current = false;
      cameraLife.current++;
      const reader = readerRef.current;
      if (reader)
        void Promise.resolve()
          .then(() => reader.stop())
          .catch(() => {});
    };
  }, []);

  useEffect(() => {
    const element = document.getElementById("qr-reader");
    const failed = () => {
      cameraFailed.current = true;
      cameraLife.current++;
      const reader = readerRef.current;
      readerRef.current = null;
      setScannerOn(false);
      setCameraStarting(false);
      if (reader)
        void Promise.resolve()
          .then(() => reader.stop())
          .catch(() => {});
      toast.error(
        "No se pudo reproducir la cámara. Revisa los permisos o utiliza el código manual.",
      );
    };
    element?.addEventListener("snoop:camera-play-error", failed);
    return () => element?.removeEventListener("snoop:camera-play-error", failed);
  }, []);

  if (!accessLoading && !canScan) return <Navigate to="/" />;

  return (
    <SnoopLayout
      title="Control de acceso"
      subtitle="Escanea el QR del socio para registrar entrada o salida"
    >
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <Stat label="Dentro ahora" value={insideNow} icon={Users} accent />
        <Stat label="Entradas hoy" value={inToday} icon={ArrowRight} />
        <Stat label="Salidas hoy" value={outToday} icon={ArrowLeftIcon} />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Camera scanner */}
        <div className="bg-card/60 border border-neon/25 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-neon-dim">
              <Camera className="w-4 h-4 text-neon" /> Cámara
            </div>
            <button
              onClick={toggleCamera}
              disabled={cameraStarting || !canScan}
              className="text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-neon/40 text-neon hover:bg-neon/10 flex items-center gap-1.5"
            >
              {scannerOn ? (
                <>
                  <CameraOff className="w-3.5 h-3.5" /> Detener
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" /> Empezar
                </>
              )}
            </button>
          </div>
          <div className="relative w-full aspect-square bg-black/60 rounded-xl overflow-hidden">
            {/* Html5Qrcode exclusively owns this empty element's children. */}
            <div id="qr-reader" className="w-full" />
            {!scannerOn && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-xs text-muted-foreground">
                {cameraStarting
                  ? "Solicitando acceso a la cámara…"
                  : 'Pulsa "Empezar" para activar la cámara'}
              </div>
            )}
          </div>
        </div>

        {/* Manual / hardware scanner */}
        <div className="bg-card/60 border border-neon/25 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-neon-dim mb-3">
            <KeyboardIcon className="w-4 h-4 text-neon" /> Lector físico / código manual
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualCode) registerScan(manualCode);
            }}
          >
            <input
              ref={inputRef}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Nº de socio o SNOOP:0000123"
              autoFocus={!openScanner}
              className="w-full bg-input border border-border rounded-lg px-4 py-3 text-lg font-mono focus:border-neon outline-none"
              disabled={busy || !canScan}
            />
            <button
              type="submit"
              disabled={busy || !manualCode || !canScan}
              className="mt-3 w-full bg-gradient-neon text-primary-foreground py-2.5 rounded-lg font-display uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
            >
              Registrar
            </button>
          </form>
          <p className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Enfoca este campo y pasa el código con tu lector USB/Bluetooth. Se registra
            automáticamente entrada o salida según el último movimiento del día.
          </p>
        </div>
      </div>

      {/* Recent list */}
      <div className="mt-8 bg-card/60 border border-neon/20 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-neon/15 text-[11px] uppercase tracking-[0.3em] text-neon-dim">
          Últimos movimientos
        </div>
        {recents.length === 0 ? (
          <div className="p-5 text-sm text-muted-foreground">Aún no hay registros de acceso.</div>
        ) : (
          <div className="divide-y divide-neon/10">
            {recents.map((r) => (
              <Link
                key={r.id}
                to="/soci"
                className="flex items-center justify-between px-5 py-3 hover:bg-neon/5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-widest px-2 py-1 rounded-full ${r.direction === "in" ? "bg-neon/15 text-neon border border-neon/40" : "bg-destructive/10 text-destructive border border-destructive/40"}`}
                  >
                    {r.direction === "in" ? (
                      <ArrowRight className="w-3 h-3" />
                    ) : (
                      <ArrowLeftIcon className="w-3 h-3" />
                    )}
                    {r.direction === "in" ? "Entrada" : "Salida"}
                  </span>
                  <div>
                    <div className="text-sm text-foreground">
                      {r.first_name} {r.last_name}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      Nº {r.member_number}
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString("es-ES")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </SnoopLayout>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: any;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${accent ? "border-neon/50 bg-neon/5 glow-neon-soft" : "border-neon/20 bg-card/60"}`}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-neon-dim">
        <Icon className="w-3.5 h-3.5 text-neon" /> {label}
      </div>
      <div className={`mt-2 font-display text-3xl ${accent ? "text-neon" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
