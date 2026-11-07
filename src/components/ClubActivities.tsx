import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserRound, Wallet, Package, Boxes, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  activityRows,
  activitySources,
  relativeActivityTime,
  type ClubActivity,
} from "@/lib/club-activity";
const fields: Record<string, [string, string]> = {
  members: ["id,created_at,member_number", "created_at"],
  orders: ["id,created_at,total_cents", "created_at"],
  membership_receipts: ["id,recorded_at,amount_cents", "recorded_at"],
  products: ["id,created_at,updated_at,name", "updated_at"],
  stock_movements: ["id,created_at,delta", "created_at"],
};
const icons = { member: UserRound, cash: Wallet, product: Package, inventory: Boxes };
export function ClubActivities({ expanded = false }: { expanded?: boolean }) {
  const { access, user, loading, accessError } = useAuth();
  const [entries, setEntries] = useState<ClubActivity[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(false);
  const [limit, setLimit] = useState(expanded ? 20 : 3),
    [hasMore, setHasMore] = useState(false),
    [tick, setTick] = useState(0);
  const scope = [user?.id, access.clubId, access.role, access.status, ...access.permissions].join(
    ":",
  );
  const [entryScope, setEntryScope] = useState("");
  useEffect(() => {
    if (loading || accessError) return;
    let cancelled = false,
      request = 0;
    setEntries([]);
    setEntryScope(scope);
    setBusy(true);
    setError(false);
    const sources = activitySources(access);
    async function load() {
      const version = ++request;
      const responses = await Promise.allSettled(
        sources.map(async (table) => {
          const [select, order] = fields[table];
          let query = (supabase.from as any)(table)
            .select(select)
            .eq("club_id", access.clubId)
            .order(order, { ascending: false })
            .limit(limit + 1);
          if (access.role !== "admin" && (table === "orders" || table === "membership_receipts"))
            query = query.eq(table === "orders" ? "created_by" : "recorded_by", user?.id);
          const { data, error } = await query;
          if (error) throw error;
          return activityRows(table, data || [], access.permissions.includes("use_cash"));
        }),
      );
      if (cancelled || version !== request) return;
      const failed = responses.some((r) => r.status === "rejected");
      const data = responses.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      const ordered = [...new Map(data.map((item) => [item.key, item])).values()].sort(
        (a, b) => Date.parse(b.at) - Date.parse(a.at),
      );
      setEntries(ordered.slice(0, limit));
      setHasMore(ordered.length > limit);
      setError(failed);
      setBusy(false);
    }
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [scope, loading, accessError, limit, tick]);
  const visible = !loading && !accessError && entryScope === scope ? entries : [];
  return (
    <section className="premium-activities" aria-labelledby="activity-title">
      <div className="premium-section-heading">
        <h2 id="activity-title">Últimas actividades</h2>
        {!expanded && (
          <Link to="/actividades" className="premium-see-all">
            Ver todas <ChevronRight aria-hidden="true" size={20} />
          </Link>
        )}
      </div>
      {error && (
        <div role="alert" className="premium-empty">
          No se pudieron consultar todas las actividades.{" "}
          <button onClick={() => setTick((n) => n + 1)}>Reintentar</button>
        </div>
      )}
      {!visible.length && (
        <p className="premium-empty" role="status">
          {busy ? "Consultando actividad…" : "Aún no hay actividades disponibles para tu acceso."}
        </p>
      )}
      <ul className="premium-activity-list">
        {visible.map((item) => {
          const Icon = icons[item.kind];
          return (
            <li key={item.key}>
              <Link to={item.href} className="premium-activity">
                <span className="premium-activity-icon">
                  <Icon aria-hidden="true" />
                </span>
                <span className="premium-activity-copy">
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </span>
                <time
                  dateTime={item.at}
                  title={new Date(item.at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                >
                  {relativeActivityTime(item.at)}
                </time>
              </Link>
            </li>
          );
        })}
      </ul>
      {expanded && hasMore && limit < 100 && (
        <button className="premium-more" disabled={busy} onClick={() => setLimit((n) => n + 20)}>
          Cargar más actividades
        </button>
      )}
      {expanded && hasMore && limit >= 100 && (
        <p className="premium-empty">
          Últimas 100 actividades. Consulta el historial completo en cada sección.
        </p>
      )}
    </section>
  );
}
