import { readCashLedger } from "@/lib/cash-ledger";
import { cashMovements, cashDaySummary } from "@/lib/cash-sessions";
import { useCashRefresh } from "@/hooks/useCashRefresh";
import { clubDayRange } from "@/lib/cash-summary";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { SnoopLayout } from "@/components/SnoopLayout";
import { Link, Navigate } from "@tanstack/react-router";
import { Banknote, PackagePlus, ShoppingCart, UserRoundPlus, Boxes, Wallet } from "lucide-react";
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
  const [cashBreakdown, setCashBreakdown] = useState<{cashCents:number; unidentifiedCents:number; differenceAtClosures:number|null}|null>(null);
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
      setCashBreakdown(null);
      return;
    }
    let canceled = false;
    let request = 0;
    setCashCents(null);
    setCashBreakdown(null);
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
        setCashBreakdown({cashCents:summary.cashCents,unidentifiedCents:summary.unidentifiedCents,differenceAtClosures:summary.differenceAtClosures});
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
  const euro = (amount:number) => new Intl.NumberFormat("es-ES",{style:"currency",currency:"EUR"}).format(amount/100);
  return (
    <SnoopLayout home contentClassName="snoop-reference-home">
      <div className="snoop-dashboard-head">
        <div>
          <h1>Bienvenido, <span>{clubName}</span></h1>
          <p>Panel de gestión del club</p>
        </div>
        <Link to="/soci/gestisci" className="snoop-dashboard-search" aria-label="Buscar socio">
          <span aria-hidden="true">⌕</span> Buscar socio, pedido o producto…
        </Link>
      </div>
      <div className="snoop-dashboard-summary">
        <section className="snoop-reference-cash" aria-labelledby="snoop-ref-cash-title">
          <h2 id="snoop-ref-cash-title"><Banknote aria-hidden="true"/>{isAdmin?"Caja de hoy":"Mi caja de hoy"}</h2>
          <strong className="snoop-ref-total" aria-live="polite">{canSeeCash?(cashScope===scope&&cashCents!==null?euro(cashCents):cashError?"No disponible":"—"):"Acceso restringido"}</strong>
          {canSeeCash&&cashError&&<button className="snoop-ref-retry" onClick={retryCash}>Reintentar</button>}
          <dl className="snoop-cash-lines">
            <div><dt>Entradas registradas</dt><dd>{canSeeCash&&cashCents!==null&&cashScope===scope?euro(cashCents):"—"}</dd></div>
            <div><dt>Saldo efectivo</dt><dd>{canSeeCash&&cashBreakdown&&cashScope===scope?euro(cashBreakdown.cashCents):"—"}</dd></div>
            <div><dt>Diferencia</dt><dd>{canSeeCash&&cashBreakdown?.differenceAtClosures!==null&&cashBreakdown&&cashScope===scope?euro(cashBreakdown.differenceAtClosures!):"—"}</dd></div>
          </dl>
          {canSeeCash&&!cashError&&cashScope===scope&&receiptPoints.length>0&&<MembershipSparkline points={receiptPoints}/>}
        </section>

      </div>
      <section className="snoop-dashboard-actions" aria-labelledby="snoop-actions-title">
        <h2 id="snoop-actions-title">Acciones rápidas</h2>
        <div className="snoop-actions-grid">
          {can("manage_members")&&<Link to="/soci/nuovo"><UserRoundPlus aria-hidden="true"/><span>Registrar socio</span></Link>}
          {can("use_cash")&&<Link to="/soci/gestisci"><ShoppingCart aria-hidden="true"/><span>Hacer pedido</span></Link>}
          {can("use_cash")&&<Link to="/caja"><Banknote aria-hidden="true"/><span>Abrir / Cerrar caja</span></Link>}
          {can("manage_products")&&<Link to="/productos"><PackagePlus aria-hidden="true"/><span>Crear producto</span></Link>}
          {can("manage_products")&&<Link to="/productos"><Boxes aria-hidden="true"/><span>Actualizar stock</span></Link>}
          {(isAdmin||can("use_cash"))&&<Link to="/caja"><Wallet aria-hidden="true"/><span>Monedero / Caja</span></Link>}
        </div>
      </section>
      <ClubActivities/>
    </SnoopLayout>
  );
}
