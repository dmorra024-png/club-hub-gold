import { readCashLedger } from "@/lib/cash-ledger";
import { getCashReport } from "@/lib/cash-sessions.functions";
import { cashMovements, cashDaySummary } from "@/lib/cash-sessions";
import { useCashRefresh } from "@/hooks/useCashRefresh";
import { clubDayRange } from "@/lib/cash-summary";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { SnoopLayout } from "@/components/SnoopLayout";
import { Link, Navigate } from "@tanstack/react-router";
import { SnoopGoldIcon } from "@/components/SnoopGoldIcon";
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
        // Use the same authorized accounting ledger as Caja: wallet topups are
        // income, wallet credit spends are NOT new cash receipts.
        let totalCents:number;
        if(can("use_cash")){
          const report=await getCashReport({data:{day:null}});
          if(!report||!Array.isArray(report.movements)||!Array.isArray(report.sessions))
            throw Error("Informe de caja no válido");
          totalCents=cashDaySummary(report.movements,report.sessions,report.start,report.end).totalCents;
        }else{
          // Preserve the previous view_reports-only route where the cash-only
          // server permission is not available.
          const {start,end}=clubDayRange();
          const {orders,fees}=await readCashLedger(
            supabase,
            {clubId:access.clubId!,userId:user!.id,admin:isAdmin},
            start,end,
          );
          totalCents=cashDaySummary(cashMovements(orders,fees,[]),[],start,end).totalCents;
        }
        if (canceled || version !== request) return;
        setCashError(false);
        setCashCents(totalCents);
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
        <h1>Bienvenido, <span>{clubName}</span></h1>
      </div>
      <section className="snoop-approved-cash" aria-labelledby="snoop-cash-label">
        <div className="snoop-approved-cash-icon" aria-hidden="true"><SnoopGoldIcon kind="wallet"/></div>
        <div className="snoop-approved-cash-info">
          <h2 id="snoop-cash-label">{isAdmin?"Caja de hoy":"Mi caja de hoy"}</h2>
          <strong aria-live="polite">{canSeeCash?(summaryVisible?euro(cashCents):cashError?"No disponible":"—"):"Acceso restringido"}</strong>
        </div>
        <div className="snoop-approved-cash-trend" aria-hidden="true">
          <svg viewBox="0 0 64 64" fill="none" focusable="false">
            <path d="M9 12v43h46" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" opacity=".7"/>
            <path d="m15 43 12-11 9 6 15-19" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="m43 19h8v8" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="15" cy="43" r="2.5" fill="currentColor"/>
            <circle cx="27" cy="32" r="2.5" fill="currentColor"/>
            <circle cx="36" cy="38" r="2.5" fill="currentColor"/>
          </svg>
        </div>
        {canSeeCash&&cashError&&<button type="button" className="snoop-ref-retry" onClick={retryCash}>Reintentar</button>}
      </section>
      <nav className="snoop-approved-shortcuts" aria-label="Accesos rápidos">
        {can("manage_members")&&<Link to="/soci"><SnoopGoldIcon kind="socios"/><span>Socios</span></Link>}
        {can("use_cash")&&<Link to="/soci/gestisci"><SnoopGoldIcon kind="pedidos"/><span>Pedidos</span></Link>}
        {can("manage_products")&&<Link to="/productos"><SnoopGoldIcon kind="productos"/><span>Productos</span></Link>}
        {can("manage_products")&&<Link to="/productos"><SnoopGoldIcon kind="stock"/><span>Stock</span></Link>}
      </nav>
      <div className="snoop-approved-activity"><ClubActivities/></div>
    </SnoopLayout>
  );
}
