import { useVoiceToolPort } from "@/hooks/useVoiceToolPort";
import { scopedMemberSearch } from "@/lib/administrative-voice";
import { spokenMemberQuery } from "@/lib/voice/member-query";
import { createPortal } from "react-dom";
import { extractMemberNumber, normalizeAdministrativeSearch } from "@/lib/member-administration";
import { decodeLegacyMemberQr, matchLegacyMember } from "@/lib/legacy-member-qr";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Mic, QrCode, X } from "lucide-react";
import { toast } from "sonner";
import { expiryBadge } from "@/lib/snoop";
import { Html5Qrcode } from "html5-qrcode";
import { verifySnoopSocioScan } from "@/lib/socio-qr-scanner.functions";

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

function GestisciSoci() {
  const routeContext = Route.useRouteContext();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [remoteVoiceMatches, setRemoteVoiceMatches] = useState<Array<{id:string;first_name:string;last_name:string}>>([]);
  const [loading, setLoading] = useState(true);
  const [scanOpen, setScanOpen] = useState(false);
  const navigate = useNavigate();
  useVoiceToolPort("members.search", { ready: () => !loading, search: (query) => runVoiceSearch(query) });
  // This page is reached by the central QR shortcut: open the existing member
  // scanner immediately, rather than the separate entry/exit scanner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("scanner") !== "true") return;
    setScanOpen(true);
    params.delete("scanner");
    const next =
      window.location.pathname +
      (params.size ? "?" + params.toString() : "") +
      window.location.hash;
    window.history.replaceState(window.history.state, "", next);
  }, []);

  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("members")
      .select(
        "id, member_number, first_name, last_name, dni_number, city, expires_at, plan:membership_plans!members_plan_id_fkey(name)",
      )
      .eq("club_id", routeContext.access.clubId!)
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

  async function runVoiceSearch(query: string) {
    // Voice UI and server share the same member-name normalizer.
    const memberQuery = spokenMemberQuery(query);
    setRemoteVoiceMatches([]);
    if (!memberQuery) {
      toast.error("Indica el nombre o número del socio.");
      return "not_found" as const;
    }
    const num = extractMemberNumber(memberQuery);
    if (num) {
      const found = rowsRef.current.some(r => r.member_number === num);
      openByMemberNumber(num);
      return found ? "opened" as const : "not_found" as const;
    }

    setQ(memberQuery);
    const norm = normalizeAdministrativeSearch;
    const tokens = norm(memberQuery).split(/\s+/).filter(Boolean);
    const local = rowsRef.current.filter((r) => {
      const hay = norm(`${r.first_name} ${r.last_name}`);
      return tokens.length > 0 && tokens.every((t) => hay.includes(t));
    });
    if (local.length === 1) {
      toast.success(`Abriendo ficha de ${local[0].first_name} ${local[0].last_name}`);
      navigate({ to: "/soci/$id", params: { id: local[0].id } });
      return "opened" as const;
    }
    if (local.length > 1) {
      toast.message(`${local.length} coincidencias. Selecciona el socio; no se abre una ficha por aproximación.`);
      return "multiple" as const;
    }

    // The local list can be paginated or incomplete. A zero local match is
    // NOT evidence that no member exists. Recheck through the authenticated
    // club-scoped RPC (same access rules as the voice agent).
    try {
      const { data, error } = await (supabase as any).rpc("snoop_voice_find_members", {
        p_query: memberQuery,
        p_club: routeContext.access.clubId!,
        p_limit: 7,
      });
      if (error || !Array.isArray(data)) {
        toast.error("Búsqueda no disponible. No se ha comprobado si existe el socio.");
        return "unavailable" as const;
      }
      const matches = data.filter(
        (row: unknown): row is { id: string; first_name: string; last_name: string } =>
          !!row && typeof row === "object" &&
          typeof (row as any).id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test((row as any).id) &&
          typeof (row as any).first_name === "string" &&
          typeof (row as any).last_name === "string",
      );
      if (matches.length === 1) {
        navigate({ to: "/soci/$id", params: { id: matches[0].id } });
        return "opened" as const;
      }
      if (matches.length > 1) {
        // The authorized RPC can find a member absent from the cached list.
        // Show its candidates privately to the operator; never guess one.
        setRemoteVoiceMatches(matches.slice(0,7));
        toast.message(`${matches.length} coincidencias. Indica el apellido o selecciona la ficha.`);
        return "multiple" as const;
      } else {
        toast.error("No se encontró el nombre en este club. Comprueba nombre y apellidos.");
        return "not_found" as const;
      }
    } catch {
      toast.error("Búsqueda no disponible. No se ha comprobado si existe el socio.");
      return "unavailable" as const;
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
      const raw = window.sessionStorage.getItem("snoop:member-search-pending");
      if (!raw) return;
      window.sessionStorage.removeItem("snoop:member-search-pending");
      const query = scopedMemberSearch(raw, {
        userId: routeContext.user.id,
        clubId: routeContext.access.clubId ?? "",
      });
      if (query) runVoiceSearch(query);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows]);

  const filtered = rows.filter((r) => {
    const query = normalizeAdministrativeSearch(q);
    if (!query) return true;
    const haystack = normalizeAdministrativeSearch(
      `${r.first_name} ${r.last_name} ${r.dni_number} ${r.member_number} ${r.city ?? ""}`,
    );
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
            onChange={(e) => { setRemoteVoiceMatches([]); setQ(e.target.value); }}
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
      </div>

      {remoteVoiceMatches.length > 0 && (
        <section className="mb-5 rounded-xl border border-neon/40 bg-card/60 p-4" aria-label="Coincidencias verificadas por búsqueda de voz">
          <p className="text-sm mb-3">Varios socios encontrados en este club. Selecciona la ficha correcta:</p>
          <div className="flex flex-col gap-2">
            {remoteVoiceMatches.map(match => (
              <Link key={match.id} to="/soci/$id" params={{id:match.id}}
                className="block rounded-lg border border-border p-3 text-sm hover:border-neon">
                {match.first_name} {match.last_name}
              </Link>
            ))}
          </div>
        </section>
      )}
      {loading ? (
        <div className="text-muted-foreground text-sm">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-card/60 border border-border rounded-2xl p-12 text-center">
          <div className="text-muted-foreground">No hay socios{q && " que coincidan"}.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 min-w-0 gap-3">
          {filtered.map((r) => {
            const badge = expiryBadge(r.expires_at);
            return (
              <Link
                key={r.id}
                to="/soci/$id"
                params={{ id: r.id }}
                className="min-w-0 flex items-center gap-4 bg-card/60 hover:bg-card border border-border hover:border-neon/50 rounded-xl p-4 transition group"
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
            if(text.startsWith("ssc2.")){
              // New Socio QR: authenticate, check club and consume server-side.
              void verifySnoopSocioScan({data:{token:text}})
                .then(({memberId})=>navigate({to:"/soci/$id/pedido",params:{id:memberId}}))
                .catch(()=>toast.error("QR SNOOP Socio no autorizado, caducado o ya utilizado."));
              return;
            }
            // Historical emailed/printed SNOOP QR: no re-issuance or wipe.
            const num = decodeLegacyMemberQr(text);
            if (!num) { toast.error("QR no reconocido. Usa el carnet SNOOP o introduce el número."); return; }
            const cached = matchLegacyMember(rowsRef.current,num);
            if (cached) {
              navigate({to:"/soci/$id/pedido",params:{id:cached.id}});
              return;
            }
            // A fresh exact query handles stale lists and older linked cards;
            // DB tenant scope is mandatory, never search across clubs.
            if(!routeContext.access.clubId){toast.error("Club no disponible.");return;}
            void supabase.from("members").select("id,member_number")
              .eq("club_id",routeContext.access.clubId).eq("member_number",num).limit(2)
              .then(({data,error})=>{
                if(error || !data || data.length!==1) {
                  toast.error("No se encontró un carnet único de este club. Comprueba el número.");
                  return;
                }
                navigate({to:"/soci/$id/pedido",params:{id:data[0].id}});
              });
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

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Escanear QR del socio"
      style={{ width: "100dvw", height: "100dvh" }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center p-4"
    >
      <div
        style={{ maxWidth: "min(28rem, calc(100dvw - 2rem))" }}
        className="w-full max-w-md min-w-0 max-h-[90dvh] overflow-y-auto bg-card border border-neon/40 rounded-2xl p-5 glow-neon-soft"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="min-w-0 flex-1 text-[10px] uppercase tracking-[0.3em] text-neon-dim font-display">
            Escanear QR del socio
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-10 h-10 flex items-center justify-center text-muted-foreground hover:text-neon"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div id={elId} className="w-full rounded-lg overflow-hidden bg-black aspect-square" />
        {error && (
          <p role="alert" className="text-xs text-destructive mt-3">
            {error}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Apunta al QR del carnet o di el número de 7 cifras al micrófono.
        </p>
      </div>
    </div>,
    document.body,
  );
}
