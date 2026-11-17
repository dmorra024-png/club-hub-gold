import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Mic, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { expiryBadge } from "@/lib/snoop";
import { Html5Qrcode } from "html5-qrcode";

export const Route = createFileRoute("/_authenticated/soci/gestisci")({
  component: GestisciSoci,
});

type Row = {
  id: string;
  member_number: string;
  first_name: string;
  last_name: string;
  dni_number: string;
  city: string | null;
  expires_at: string;
  plan?: { name: string } | null;
};

function extractMemberNumber(text: string): string | null {
  // Accept "SNOOP:0000123", a bare 7-digit code, or 7+ digits spoken with spaces
  const upper = text.toUpperCase();
  const tagged = upper.match(/SNOOP[:\s-]*([0-9]{4,9})/);
  if (tagged) return tagged[1].padStart(7, "0").slice(-7);
  const digits = text.replace(/\D+/g, "");
  if (digits.length >= 6 && digits.length <= 9) return digits.padStart(7, "0").slice(-7);
  return null;
}

function GestisciSoci() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const navigate = useNavigate();
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("members")
      .select(
        "id, member_number, first_name, last_name, dni_number, city, expires_at, plan:membership_plans(name)",
      )
      .order("member_number");
    setRows((data as any) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function openByMemberNumber(num: string) {
    const match = rowsRef.current.find((r) => r.member_number === num);
    if (match) {
      toast.success(`Socio ${num} · ${match.first_name} ${match.last_name}`);
      navigate({ to: "/soci/$id", params: { id: match.id } });
    } else {
      toast.error(`Ningún socio con número ${num}`);
    }
  }

  function runVoiceSearch(query: string) {
    // Try member number first (QR or dictated digits)
    const num = extractMemberNumber(query);
    if (num) {
      openByMemberNumber(num);
      return;
    }

    setQ(query);
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const scored = rowsRef.current
      .map((r) => {
        const hay = norm(
          `${r.first_name} ${r.last_name} ${r.dni_number} ${r.member_number} ${r.city ?? ""}`,
        );
        let score = 0;
        for (const t of tokens) {
          if (hay.includes(t)) score += 2;
          else if (t.length >= 3) {
            // partial: any word in hay starts with token or vice versa
            const words = hay.split(/\s+/);
            if (words.some((w) => w.startsWith(t.slice(0, 3)) || t.startsWith(w.slice(0, 3))))
              score += 1;
          }
        }
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const exact = scored.filter((x) => x.score === tokens.length * 2);
    if (exact.length === 1) {
      toast.success(`Abriendo ficha de ${exact[0].r.first_name} ${exact[0].r.last_name}`);
      navigate({ to: "/soci/$id", params: { id: exact[0].r.id } });
    } else if (scored.length === 0) {
      toast.error("No se encontró ningún socio");
    } else if (scored.length === 1) {
      toast.success(`Abriendo ficha de ${scored[0].r.first_name} ${scored[0].r.last_name}`);
      navigate({ to: "/soci/$id", params: { id: scored[0].r.id } });
    } else {
      toast.message(`${scored.length} resultados similares`);
    }
  }

  useEffect(() => {
    function onVoiceSearch(e: Event) {
      const detail = (e as CustomEvent).detail as { query?: string } | undefined;
      const query = (detail?.query ?? "").trim();
      if (!query) return;
      runVoiceSearch(query);
    }
    window.addEventListener("snoop:search-members", onVoiceSearch as EventListener);
    return () => window.removeEventListener("snoop:search-members", onVoiceSearch as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  useEffect(() => {
    if (loading) return;
    try {
      const raw = window.localStorage.getItem("snoop:member-search-pending");
      if (!raw) return;
      window.localStorage.removeItem("snoop:member-search-pending");
      const { query, at } = JSON.parse(raw);
      if (query && Date.now() - at < 15000) runVoiceSearch(String(query));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows]);

  const filtered = rows.filter((r) => {
    const query = q.trim().toLowerCase();
    if (!query) return true;
    const haystack =
      `${r.first_name} ${r.last_name} ${r.dni_number} ${r.member_number} ${r.city ?? ""}`.toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    return tokens.every((t) => haystack.includes(t));
  });

  return (
    <SnoopLayout
      title="Gestionar socios"
      subtitle={`${rows.length} socio${rows.length === 1 ? "" : "s"} registrado${rows.length === 1 ? "" : "s"}`}
    >
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neon-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nº socio, nombre, DNI o ciudad..."
            className="w-full bg-input border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm focus:border-neon focus:ring-2 focus:ring-neon/20 outline-none transition"
          />
        </div>
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="flex items-center justify-center gap-2 px-5 py-2.5 border border-neon/40 text-neon rounded-lg font-display font-semibold uppercase tracking-[0.2em] text-xs hover:bg-neon/10"
        >
          <QrCode className="w-4 h-4" /> Escanear QR
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("snoop:voice-start"))}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-neon text-primary-foreground rounded-lg font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon"
        >
          <Mic className="w-4 h-4" /> Buscar socio
        </button>
      </div>

      {loading ? (
        <div className="text-muted-foreground text-sm">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card/60 border border-border rounded-2xl p-12 text-center">
          <div className="text-muted-foreground">No hay socios{q && " que coincidan"}.</div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => {
            const badge = expiryBadge(r.expires_at);
            return (
              <Link
                key={r.id}
                to="/soci/$id"
                params={{ id: r.id }}
                className="flex items-center gap-4 bg-card/60 hover:bg-card border border-border hover:border-neon/50 rounded-xl p-4 transition group"
              >
                <div className="w-11 h-11 rounded-full bg-neon/10 border border-neon/30 flex items-center justify-center font-display text-neon">
                  {r.first_name[0]?.toUpperCase()}
                  {r.last_name[0]?.toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[11px] tracking-[0.25em] text-neon">
                      #{r.member_number}
                    </span>
                    <span className="font-display text-foreground truncate">
                      {r.first_name} {r.last_name}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {r.dni_number}
                    {r.city && ` · ${r.city}`}
                    {r.plan?.name && ` · ${r.plan.name}`}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border ${badge.color}`}
                >
                  {badge.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {scanOpen && (
        <QrScannerModal
          onClose={() => setScanOpen(false)}
          onResult={(text) => {
            setScanOpen(false);
            const num = extractMemberNumber(text);
            if (num) openByMemberNumber(num);
            else toast.error("Código QR no reconocido");
          }}
        />
      )}
    </SnoopLayout>
  );
}

function QrScannerModal({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (text: string) => void;
}) {
  const elId = "snoop-qr-reader";
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let started = false;
    const scanner = new Html5Qrcode(elId);

    const safeStop = async () => {
      try {
        // @ts-ignore - getState exists at runtime: 2 = SCANNING
        const state = typeof scanner.getState === "function" ? scanner.getState() : 0;
        if (started && state === 2) await scanner.stop();
      } catch {}
      try {
        scanner.clear();
      } catch {}
    };

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => {
          if (cancelled) return;
          cancelled = true;
          safeStop().finally(() => onResultRef.current(decoded));
        },
        () => {},
      )
      .then(() => {
        started = true;
        if (cancelled) safeStop();
      })
      .catch((e: any) =>
        setError(e?.message ?? "No se pudo abrir la cámara. Concede permiso o usa HTTPS."),
      );

    return () => {
      cancelled = true;
      safeStop();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-neon/40 rounded-2xl p-5 glow-neon-soft">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim font-display">
            Escanear QR del socio
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-neon"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div id={elId} className="w-full rounded-lg overflow-hidden bg-black aspect-square" />
        {error && <p className="text-xs text-destructive mt-3">{error}</p>}
        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Apunta al QR del carnet o di el número de 7 cifras al micrófono.
        </p>
      </div>
    </div>
  );
}
