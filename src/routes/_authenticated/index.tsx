import { readCashLedger } from "@/lib/cash-ledger";
import { cashMovements, cashDaySummary } from "@/lib/cash-sessions";
import { useCashRefresh } from "@/hooks/useCashRefresh";
import { clubDayRange } from "@/lib/cash-summary";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { SnoopLayout } from "@/components/SnoopLayout";
import { Link, Navigate } from "@tanstack/react-router";
import { Wallet, Users, ShoppingCart, Package, Layers3 } from "lucide-react";
import { SnoopWordmark } from "@/components/SnoopWordmark";
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
  const euro = (amount:number) => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(amount/100);
  const summaryVisible=canSeeCash&&cashScope===scope&&cashCents!==null;
  return (
    <SnoopLayout home contentClassName="snoop-approved-home">
      <div className="snoop-approved-welcome">
        <Link to="/" className="snoop-approved-brand" aria-label="SNOOP — Inicio"><SnoopWordmark /></Link>
        <h1>Bienvenido, <span>{clubName}</span></h1>
      </div>
      <section className="snoop-approved-cash" aria-labelledby="snoop-cash-label">
        <div className="snoop-approved-cash-icon" aria-hidden="true"><Wallet size={34} strokeWidth={1.5}/></div>
        <div className="snoop-approved-cash-info">
          <h2 id="snoop-cash-label">{isAdmin?"Caja de hoy":"Mi caja de hoy"}</h2>
          <strong aria-live="polite">{canSeeCash?(summaryVisible?euro(cashCents):cashError?"No disponible":"—"):"Acceso restringido"}</strong>
        </div>
        <div className="snoop-approved-cash-bars" aria-hidden="true"><i/><i/><i/><i/><i/></div>
        {canSeeCash&&cashError&&<button type="button" className="snoop-ref-retry" onClick={retryCash}>Reintentar</button>}
      </section>
      <nav className="snoop-approved-shortcuts" aria-label="Accesos rápidos">
        {can("manage_members")&&<Link to="/soci"><Users aria-hidden="true"/><span>Socios</span></Link>}
        {can("use_cash")&&<Link to="/soci/gestisci"><ShoppingCart aria-hidden="true"/><span>Pedidos</span></Link>}
        {can("manage_products")&&<Link to="/productos"><Package aria-hidden="true"/><span>Productos</span></Link>}
        {can("manage_products")&&<Link to="/productos"><Layers3 aria-hidden="true"/><span>Stock</span></Link>}
      </nav>
      <div className="snoop-approved-activity"><ClubActivities/></div>
    </SnoopLayout>
  );
}
