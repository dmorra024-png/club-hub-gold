import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getMemberOrderHistory } from "@/lib/member-order-history.functions";
import {
  FinancialRecordDialog,
  FinancialRecordStatus,
  recordTime as time,
  RECORDS_CHANGED,
} from "./FinancialRecordDialog";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/lib/snoop";
export function MemberOrderHistory({ memberId }: { memberId: string }) {
  const { user, access, loading, accessError, can } = useAuth();
  const allowed = can("manage_members") && (can("use_cash") || can("view_reports"));
  const scope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
    memberId,
  ]);
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [revision, setRevision] = useState(0),
    [stored, setStored] = useState<any>(null),
    [error, setError] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const data = stored?.scope === scope && stored?.page === page ? stored.data : null;
  useEffect(() => {
    if (!open || loading || accessError || !allowed) return;
    let active = true;
    setError("");
    getMemberOrderHistory({ data: { memberId, page } })
      .then((result) => {
        if (active) setStored({ scope, page, data: result });
      })
      .catch(() => {
        if (active) setError("No se pudo cargar el historial. Vuelve a intentarlo.");
      });
    return () => {
      active = false;
    };
  }, [open, scope, page, revision, loading, accessError]);
  useEffect(() => {
    setSelectedId(null);
  }, [scope]);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener(RECORDS_CHANGED, refresh);
    return () => window.removeEventListener(RECORDS_CHANGED, refresh);
  }, []);
  if (!allowed || accessError) return null;
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card/60 p-4">
      <details onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer font-display">Historial de pedidos</summary>
        {open && (
          <div className="space-y-3 pt-3">
            {error ? (
              <p role="alert">
                {error}{" "}
                <button className="underline" onClick={() => setRevision((n) => n + 1)}>
                  Reintentar historial
                </button>
              </p>
            ) : !data ? (
              <p role="status">Cargando historial…</p>
            ) : (
              <>
                {data.ownOnly && (
                  <p className="text-sm text-muted-foreground">Registros realizados por ti.</p>
                )}
                {data.orders.length === 0 && <p>Sin registros visibles.</p>}
                {data.orders.map((o: any) => (
                  <div
                    key={o.id}
                    className="rounded-xl border border-border bg-card/40 p-4 text-sm space-y-1"
                  >
                    <p>
                      {time(o.at)} · {formatPrice(o.cents)} ·{" "}
                      <FinancialRecordStatus status={o.status} />
                    </p>
                    <p className="break-all text-xs">{o.reference}</p>
                    <p>{o.operator}</p>
                    <button
                      className="text-neon underline py-2"
                      onClick={() => setSelectedId(o.id)}
                    >
                      Ver detalle
                    </button>
                    {o.canCancel && (
                      <button
                        className="ml-4 text-red-400 py-2"
                        onClick={() => setSelectedId(o.id)}
                      >
                        Anular operación
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex gap-3">
                  {page > 0 && (
                    <Button variant="outline" onClick={() => setPage((n) => n - 1)}>
                      Más recientes
                    </Button>
                  )}
                  {data.hasMore && (
                    <Button variant="outline" onClick={() => setPage((n) => n + 1)}>
                      Ver anteriores
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </details>
      {selectedId && (
        <FinancialRecordDialog
          key={`${scope}:${selectedId}`}
          memberId={memberId}
          orderId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </section>
  );
}
