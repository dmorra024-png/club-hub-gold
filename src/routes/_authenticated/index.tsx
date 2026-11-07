import { clubDayRange, cashAmounts } from "@/lib/cash-summary";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { SnoopLayout } from "@/components/SnoopLayout";
import { Package, Settings, Users, ShieldCheck, Banknote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/")({
  component: Home,
});

function Home() {
  const { access, isAdmin, isSuperAdmin, can, user } = useAuth();
  const [cashCents, setCashCents] = useState<number | null>(null);
  const [cashError, setCashError] = useState(false);
  const [cashScope, setCashScope] = useState("");
  const clubName = access.clubName ?? "—";
  const canSeeCash = can("use_cash") || can("view_reports");

  const scope = [access.clubId, user?.id, isAdmin].join(":");
  useEffect(() => {
    if (!access.clubId || !user?.id || !canSeeCash || isSuperAdmin) {
      setCashCents(null);
      return;
    }
    let canceled = false;
    let request = 0;
    setCashCents(null);
    setCashError(false);
    setCashScope(scope);
    async function loadCash() {
      const version = ++request;
      try {
        const { start, end } = clubDayRange();
        let orders = supabase
          .from("orders")
          .select("id,total_cents")
          .eq("club_id", access.clubId!)
          .gte("created_at", start)
          .lt("created_at", end);
        let receipts = supabase
          .from("membership_receipts")
          .select("id,amount_cents")
          .eq("club_id", access.clubId!)
          .gte("recorded_at", start)
          .lt("recorded_at", end);
        if (!isAdmin) {
          orders = orders.eq("created_by", user!.id);
          receipts = receipts.eq("recorded_by", user!.id);
        }
        const [sales, fees] = await Promise.all([orders, receipts]);
        if (canceled || version !== request) return;
        if (sales.error || fees.error) {
          setCashError(true);
          setCashCents(null);
        } else {
          setCashError(false);
          setCashCents(cashAmounts(sales.data ?? [], fees.data ?? []).totalCents);
        }
      } catch {
        if (!canceled && version === request) {
          setCashError(true);
          setCashCents(null);
        }
      }
    }
    void loadCash();
    const refresh = () => {
      if (document.visibilityState === "visible") void loadCash();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      canceled = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [access.clubId, user?.id, canSeeCash, isAdmin, isSuperAdmin]);

  if (isSuperAdmin) return <SnoopHome />;

  const cards = [
    { label: "Socios", to: "/soci" as const, icon: Users, enabled: can("manage_members") },
    {
      label: "Productos",
      to: "/productos" as const,
      icon: Package,
      enabled: can("manage_products"),
    },
    { label: "Caja", to: "/caja" as const, icon: Banknote, enabled: can("use_cash") },
  ];
  return (
    <SnoopLayout>
      <div className="relative isolate mx-auto w-full max-w-3xl pb-14 pt-6 sm:pt-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[-10%] top-0 h-80 rounded-full bg-neon/10 blur-[90px]"
        />
        <div className="relative text-center mb-8 sm:mb-10">
          <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-[0.08em] text-white">
            <span className="text-neon">SNOOP</span>
          </h1>
          <h2 className="mt-2 text-xl sm:text-2xl font-semibold text-white">{clubName}</h2>
          <p className="mt-3 text-[10px] sm:text-xs tracking-[0.25em] uppercase text-neon/80">
            Tu operación, en control
          </p>
          <div className="mx-auto mt-4 h-px max-w-64 bg-gradient-to-r from-transparent via-neon to-transparent" />
        </div>

        <section
          aria-label="Resumen de hoy"
          className="relative overflow-hidden rounded-[2rem] border border-neon/60 bg-gradient-to-br from-slate-800/80 via-[#07140e] to-[#031409] p-6 sm:p-9 shadow-[0_0_35px_rgba(57,255,20,0.13)]"
        >
          <div
            aria-hidden="true"
            className="absolute -right-14 top-5 h-52 w-52 rounded-full border border-neon/20 bg-neon/10 blur-2xl"
          />
          <div className="relative z-10">
            <p className="text-xl text-white">Hola,</p>
            <h2 className="mt-1 text-2xl sm:text-3xl font-bold text-white">{clubName}</h2>
            <p className="mt-1 text-sm text-white/60">Resumen de hoy</p>
          </div>
          <div
            aria-hidden="true"
            className="relative mx-auto my-7 flex h-32 sm:h-44 max-w-sm items-center justify-center"
          >
            <div className="absolute inset-5 rounded-[40%] border border-neon/30 bg-neon/5 shadow-[0_0_55px_rgba(57,255,20,0.12)] motion-safe:animate-pulse motion-reduce:animate-none" />
            <div className="relative -rotate-6 rounded-2xl border border-neon/60 bg-[#052416]/90 px-12 py-7 shadow-[12px_12px_0_rgba(57,255,20,0.12),0_0_35px_rgba(57,255,20,0.20)]">
              <span className="font-display text-2xl font-bold tracking-wider text-white">
                SNOOP
              </span>
            </div>
          </div>
          {canSeeCash && (
            <div className="relative z-10 mt-3 border-t border-neon/25 pt-5 text-center">
              <Banknote className="mx-auto mb-2 h-6 w-6 text-neon" />
              <div className="text-3xl font-bold text-white" aria-live="polite">
                {cashScope !== scope
                  ? "—"
                  : cashError
                    ? "No disponible"
                    : cashCents === null
                      ? "—"
                      : new Intl.NumberFormat("es-ES", {
                          style: "currency",
                          currency: "EUR",
                        }).format(cashCents / 100)}
              </div>
              <p className="mt-1 text-xs uppercase tracking-[0.25em] text-neon">Caja hoy</p>
            </div>
          )}
        </section>

        <nav aria-label="Accesos principales" className="mt-7 grid grid-cols-3 gap-2 sm:gap-4">
          {cards.map(({ label, to, icon: Icon, enabled }) =>
            enabled ? (
              <Link
                key={to}
                to={to}
                className="group min-w-0 rounded-2xl border border-neon/40 bg-gradient-to-b from-[#14251c]/90 to-[#031109] px-2 py-6 text-center text-white shadow-[0_8px_25px_rgba(0,0,0,0.3)] transition hover:border-neon hover:shadow-[0_0_24px_rgba(57,255,20,0.19)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon"
              >
                <Icon className="mx-auto mb-3 h-7 w-7 text-neon" />
                <span className="block text-xs sm:text-base font-semibold">{label}</span>
                <span
                  aria-hidden="true"
                  className="mt-3 inline-block rounded-full bg-neon/10 px-3 text-xl text-neon group-hover:bg-neon/20"
                >
                  →
                </span>
              </Link>
            ) : (
              <div
                key={to}
                aria-disabled="true"
                className="min-w-0 rounded-2xl border border-neon/20 bg-[#031109] px-2 py-6 text-center text-white/40"
              >
                <Icon className="mx-auto mb-3 h-7 w-7" />
                <span className="block text-xs sm:text-base font-semibold">{label}</span>
                <span className="mt-3 inline-block text-[10px]">Sin permiso</span>
              </div>
            ),
          )}
        </nav>
        {isAdmin && (
          <div className="mt-6 text-center">
            <Link className="text-xs text-neon/70 underline" to="/ajustes">
              Ajustes
            </Link>
          </div>
        )}
      </div>
    </SnoopLayout>
  );
}

function SnoopHome() {
  return (
    <SnoopLayout>
      <div className="flex flex-col items-center justify-center text-center py-6">
        <div className="text-[10px] uppercase tracking-[0.35em] text-neon-dim">Plataforma</div>
        <h1 className="mt-1 font-display text-5xl md:text-6xl tracking-[0.35em] text-neon text-glow-neon uppercase">
          SNOOP
        </h1>
        <div className="mt-3 h-[2px] w-24 bg-gradient-neon rounded-full glow-neon-soft" />
        <p className="mt-4 text-sm text-muted-foreground max-w-sm">
          Panel del super administrador. Crea y gestiona los clubs que usan Snoop.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-3 w-full max-w-sm">
          <Link
            to="/snoop-admin"
            className="flex items-center justify-center gap-2 px-4 py-5 rounded-xl border border-neon/50 bg-neon/10 text-neon hover:bg-neon/20 transition"
          >
            <ShieldCheck className="w-5 h-5" />
            <span className="text-xs uppercase tracking-[0.25em] font-display">Snoop Admin</span>
          </Link>
        </div>

        <p className="mt-8 text-[11px] uppercase tracking-[0.3em] text-neon-dim">
          Solo super admin · Gestión de clubs
        </p>
      </div>
    </SnoopLayout>
  );
}
