import { clubDayRange, cashAmounts } from "@/lib/cash-summary";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { SnoopLayout } from "@/components/SnoopLayout";
import { Navigate } from "@tanstack/react-router";
import { SnoopWordmark } from "@/components/SnoopWordmark";
import { PremiumWaves } from "@/components/PremiumWaves";
import { ClubActivities } from "@/components/ClubActivities";
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

  if (isSuperAdmin) return <Navigate to="/snoop-admin" />;
  return (
    <SnoopLayout home>
      <section className="premium-welcome" aria-label="Bienvenida al club">
        <h1>
          <SnoopWordmark halo />
        </h1>
        <p className="premium-eyebrow">BIENVENIDO</p>
        <h2 className="premium-club-name">{clubName}</h2>
        <PremiumWaves />
      </section>
      <section className="premium-cash" aria-label="Caja de hoy">
        <h2>Caja de hoy</h2>
        {canSeeCash ? (
          <p className="premium-cash-amount" aria-live="polite">
            {cashScope !== scope || cashCents === null
              ? cashError
                ? "No disponible"
                : "—"
              : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
                  cashCents / 100,
                )}
          </p>
        ) : (
          <p className="premium-cash-private">Importes reservados a usuarios autorizados</p>
        )}
      </section>
      <ClubActivities />
      <div className="premium-footer-waves">
        <PremiumWaves lower />
      </div>
    </SnoopLayout>
  );
}
