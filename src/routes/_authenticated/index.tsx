import { readCashLedger } from "@/lib/cash-ledger";
import { cashMovements, cashDaySummary } from "@/lib/cash-sessions";
import { useCashRefresh } from "@/hooks/useCashRefresh";
import { clubDayRange } from "@/lib/cash-summary";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { SnoopLayout } from "@/components/SnoopLayout";
import { Navigate } from "@tanstack/react-router";
import { SnoopWordmark } from "@/components/SnoopWordmark";
import { PremiumWaves } from "@/components/PremiumWaves";
import { ClubActivities } from "@/components/ClubActivities";
import { membershipTimeline, type ReceiptPoint } from "@/lib/membership-timeline";
import { MembershipSparkline } from "@/components/MembershipSparkline";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/")({
  component: Home,
});

function Home() {
  const { access, isAdmin, isSuperAdmin, can, user } = useAuth();
  const [cashCents, setCashCents] = useState<number | null>(null);
  const [receiptPoints, setReceiptPoints] = useState<ReceiptPoint[]>([]);
  const [cashError, setCashError] = useState(false);
  const [cashScope, setCashScope] = useState("");
  const clubName = access.clubName ?? "—";
  const canSeeCash = can("use_cash") || can("view_reports");

  const [refresh, retryCash] = useCashRefresh();
  const scope = JSON.stringify([
    access.clubId,
    user?.id,
    access.role,
    access.status,
    [...access.permissions].sort(),
  ]);
  useEffect(() => {
    if (!access.clubId || !user?.id || !canSeeCash || isSuperAdmin) {
      setCashCents(null);
      return;
    }
    let canceled = false;
    let request = 0;
    setCashCents(null);
    setReceiptPoints([]);
    setCashError(false);
    setCashScope(scope);
    async function loadCash() {
      const version = ++request;
      try {
        const { start, end } = clubDayRange();
        const { orders, fees } = await readCashLedger(
          supabase,
          { clubId: access.clubId!, userId: user!.id, admin: isAdmin },
          start,
          end,
        );
        const summary = cashDaySummary(cashMovements(orders, fees, []), [], start, end);
        if (canceled || version !== request) return;
        setCashError(false);
        setCashCents(summary.totalCents);
        setReceiptPoints(membershipTimeline(fees, start, end));
      } catch {
        if (!canceled && version === request) {
          setCashError(true);
          setCashCents(null);
        }
      }
    }
    void loadCash();
    return () => {
      canceled = true;
    };
  }, [scope, canSeeCash, isAdmin, isSuperAdmin, refresh]);

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
        <h2>{isAdmin ? "Caja de hoy" : "Mi caja de hoy"}</h2>
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
        {canSeeCash && cashError && (
          <button onClick={retryCash} className="text-sm text-neon underline">
            Reintentar caja
          </button>
        )}
        {canSeeCash && !cashError && cashScope === scope && cashCents !== null && (
          <MembershipSparkline points={receiptPoints} />
        )}
      </section>
      <ClubActivities />
      <div className="premium-footer-waves">
        <PremiumWaves lower />
      </div>
    </SnoopLayout>
  );
}
