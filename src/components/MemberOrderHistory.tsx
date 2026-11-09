import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  getMemberOrderHistory,
  annulMemberFinancialRecord,
} from "@/lib/member-order-history.functions";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
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
    [detail, setDetail] = useState<any>(null),
    [detailError, setDetailError] = useState(""),
    [reason, setReason] = useState(""),
    [annulling, setAnnulling] = useState(false);
  const sequence = useRef(0),
    sending = useRef(false);
  const data = stored?.scope === scope && stored?.page === page ? stored.data : null;
  const selected = detail?.scope === scope ? detail : null;
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
    sequence.current++;
    setDetail(null);
    setDetailError("");
    setReason("");
  }, [scope]);
  if (!allowed || accessError) return null;
  const time = (at: string) => new Date(at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  async function show(id: string, keepReason = false) {
    const request = ++sequence.current;
    setDetailError("");
    if (!keepReason) setReason("");
    try {
      const result = await getMemberOrderHistory({ data: { memberId, orderId: id, page: 0 } });
      if (request === sequence.current) setDetail({ scope, ...result });
    } catch {
      if (request === sequence.current) setDetailError("No se pudo consultar el detalle.");
    }
  }
  const order = selected?.orders[0];
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
                  <div key={o.id} className="border-b border-border py-2 text-sm">
                    <p>
                      {time(o.at)} · {formatPrice(o.cents)} ·{" "}
                      <strong>
                        {o.status === "cancelled"
                          ? "ANULADO"
                          : o.status === "completed"
                            ? "COMPLETADO"
                            : o.status}
                      </strong>
                    </p>
                    <p className="break-all text-xs">{o.reference}</p>
                    <p>{o.operator}</p>
                    <button className="text-neon underline py-2" onClick={() => show(o.id)}>
                      Ver detalle
                    </button>
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
            {detailError && <p role="alert">{detailError}</p>}
          </div>
        )}
      </details>
      <Dialog
        open={!!selected}
        onOpenChange={(v) => {
          if (!v && !annulling) {
            sequence.current++;
            setDetail(null);
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalle del registro</DialogTitle>
            <DialogDescription>Información contable original del socio.</DialogDescription>
          </DialogHeader>
          {order && (
            <>
              <p className="break-all text-xs">{order.reference}</p>
              <p>
                {time(order.at)} · {order.operator}
              </p>
              <p className="text-xl">
                {formatPrice(order.cents)} ·{" "}
                {order.status === "cancelled"
                  ? "ANULADO"
                  : order.status === "completed"
                    ? "COMPLETADO"
                    : order.status}
              </p>
              {selected.items.map((i: any) => (
                <p key={i.id} className="text-sm border-b py-2">
                  {i.product_name} · {i.quantity} {i.unit_type} · {formatPrice(i.line_total_cents)}
                </p>
              ))}
              {order.status === "cancelled" && (
                <p>
                  Motivo: {order.reason || "No registrado"}
                  <br />
                  Anulado por: {order.cancelledBy || "No registrado"}
                  {order.cancelledAt ? ` · ${time(order.cancelledAt)}` : ""}
                </p>
              )}
              {order.canCancel && (
                <div className="space-y-2 border-t pt-3">
                  <p className="text-sm">
                    Anulación contable: conserva el original. No devuelve dinero ni modifica
                    inventario.
                  </p>
                  <label>
                    Motivo de anulación
                    <textarea
                      aria-label="Motivo de anulación"
                      className="w-full bg-input border border-border rounded p-2"
                      value={reason}
                      maxLength={2000}
                      disabled={annulling}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="outline"
                    disabled={annulling || reason.trim().length < 5}
                    onClick={async () => {
                      if (sending.current) return;
                      sending.current = true;
                      setAnnulling(true);
                      setDetailError("");
                      try {
                        await annulMemberFinancialRecord({
                          data: { memberId, orderId: order.id, reason: reason.trim() },
                        });
                        await show(order.id, true);
                        setRevision((n) => n + 1);
                      } catch (e) {
                        setDetailError(
                          e instanceof Error ? e.message : "No se pudo anular el registro",
                        );
                      } finally {
                        sending.current = false;
                        setAnnulling(false);
                      }
                    }}
                  >
                    {annulling ? "Anulando…" : "Confirmar anulación contable"}
                  </Button>
                </div>
              )}
              {detailError && <p role="alert">{detailError}</p>}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
