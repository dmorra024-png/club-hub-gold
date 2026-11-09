import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  getMemberOrderHistory,
  getActivityFinancialDetail,
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
export const RECORDS_CHANGED = "snoop:financial-records-changed";
export const recordTime = (at: string) =>
  new Date(at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
export function FinancialRecordStatus({ status }: { status: string }) {
  return (
    <strong className={status === "cancelled" ? "text-red-400" : "text-muted-foreground"}>
      {status === "cancelled" ? "ANULADO" : status === "completed" ? "COMPLETADO" : status}
    </strong>
  );
}
/** Shared by the member history and club activity. All mutation logic lives here. */
export function FinancialRecordDialog({
  memberId,
  orderId,
  onClose,
}: {
  memberId?: string;
  orderId: string;
  onClose: () => void;
}) {
  const { user, access, can, accessError } = useAuth();
  const allowed = can("manage_members") && (can("use_cash") || can("view_reports")) && !accessError;
  const scope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
    memberId,
    orderId,
  ]);
  const [stored, setStored] = useState<any>(null),
    [error, setError] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [committed, setCommitted] = useState(false),
    [retry, setRetry] = useState(0);
  const sending = useRef(false),
    sequence = useRef(0);
  const data = stored?.scope === scope ? stored.data : null,
    order = data?.orders[0];
  async function read() {
    return memberId
      ? getMemberOrderHistory({ data: { memberId, orderId, page: 0 } })
      : getActivityFinancialDetail({ data: { orderId } });
  }
  useEffect(() => {
    if (!allowed) return;
    const version = ++sequence.current;
    setStored(null);
    setError("");
    setReason("");
    setCommitted(false);
    read()
      .then((result) => {
        if (version === sequence.current) setStored({ scope, data: result });
      })
      .catch(() => {
        if (version === sequence.current) setError("No se pudo consultar el detalle. Reintenta.");
      });
    return () => {
      sequence.current++;
    };
  }, [scope, allowed, retry]);
  async function annul() {
    if (
      sending.current ||
      committed ||
      !order?.canCancel ||
      access.role !== "admin" ||
      reason.trim().length < 5
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    const version = sequence.current;
    try {
      await annulMemberFinancialRecord({
        data: { memberId: memberId || data.memberId, orderId, reason: reason.trim() },
      });
      if (version !== sequence.current) return;
      setCommitted(true);
      window.dispatchEvent(new Event(RECORDS_CHANGED));
      try {
        const result = await read();
        if (result.orders[0]?.status !== "cancelled") throw new Error("Estado sin confirmar");
        if (version === sequence.current) setStored({ scope, data: result });
      } catch {
        if (version === sequence.current)
          setError(
            "La anulación se registró, pero no se pudo actualizar el detalle. Cierra y vuelve a consultar antes de reintentar.",
          );
      }
    } catch (e) {
      if (version === sequence.current)
        setError(
          e instanceof Error
            ? e.message
            : "No se pudo anular el registro. Consulta su estado antes de reintentar.",
        );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (!allowed) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Detalle del registro</DialogTitle>
          <DialogDescription>
            Original y rectificación contable, sin modificación del inventario.
          </DialogDescription>
        </DialogHeader>
        {!data && !error && <p role="status">Consultando registro…</p>}
        {order && (
          <>
            <div className="rounded-xl border border-border bg-card/60 p-4 space-y-2">
              <p className="text-xs text-neon">{order.reference}</p>
              <FinancialRecordStatus status={order.status} />
              <p className="text-2xl font-display">{formatPrice(order.cents)}</p>
              <p className="text-sm">
                Registrado por: <strong>{order.operator}</strong>
              </p>
              <p className="text-sm text-muted-foreground">{recordTime(order.at)}</p>
            </div>
            {data.items.map((i: any) => (
              <p key={i.id} className="text-sm border-b border-border py-2">
                {i.product_name} · {i.quantity} {i.unit_type} · {formatPrice(i.line_total_cents)}
              </p>
            ))}
            {order.status === "cancelled" && (
              <div className="rounded-xl border border-red-400/30 p-4 space-y-2 text-sm">
                <p>Motivo: {order.reason || "No registrado"}</p>
                <p>Anulado por: {order.cancelledBy || "No registrado"}</p>
                <p>{order.cancelledAt ? recordTime(order.cancelledAt) : "Fecha no registrada"}</p>
                {order.reversal ? (
                  <>
                    <p className="text-neon">
                      Rectificación {order.reversal.reference}:{" "}
                      <strong>{formatPrice(order.reversal.cents)}</strong>
                    </p>
                    <p>Neto contable: {formatPrice(order.cents + order.reversal.cents)}</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Rectificación anterior no registrada. No se han inventado datos históricos.
                  </p>
                )}
              </div>
            )}
            {order.status === "completed" &&
              access.role === "admin" &&
              can("use_cash") &&
              !order.canCancel && (
                <p role="status" className="text-sm text-muted-foreground">
                  Anulación con rectificación pendiente de activación en la base de datos.
                </p>
              )}
            {order.canCancel && access.role === "admin" && !committed && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-sm text-muted-foreground">
                  Anular conserva el original y registra una rectificación. No devuelve dinero ni
                  modifica inventario.
                </p>
                <label className="block text-sm">
                  Motivo de anulación
                  <textarea
                    aria-label="Motivo de anulación"
                    required
                    minLength={5}
                    maxLength={2000}
                    disabled={busy}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-2 w-full rounded-xl border border-border bg-input p-3"
                  />
                </label>
                <Button
                  className="w-full"
                  variant="destructive"
                  disabled={busy || reason.trim().length < 5}
                  onClick={annul}
                >
                  {busy ? "Anulando…" : "Confirmar anulación contable"}
                </Button>
              </div>
            )}
          </>
        )}
        {error && (
          <p role="alert">
            {error}
            {!data && (
              <button className="underline ml-2" onClick={() => setRetry((n) => n + 1)}>
                Reintentar detalle
              </button>
            )}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
