import { paymentMethodLabel } from "@/lib/administrative-payment";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  getMemberOrderHistory,
  getActivityFinancialDetail,
  annulMemberFinancialRecord,
  recordMemberFinancialRefund,
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
    [retry, setRetry] = useState(0),
    [refundRecorded, setRefundRecorded] = useState(false),
    [refundMethod, setRefundMethod] = useState(""),
    [refundReason, setRefundReason] = useState(""),
    [refundConfirmed, setRefundConfirmed] = useState(false);
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
    setRefundRecorded(false);
    setRefundMethod("");
    setRefundReason("");
    setRefundConfirmed(false);
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
      !can("use_cash") ||
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
  async function refund() {
    if (
      sending.current ||
      refundRecorded ||
      !order?.canRefund ||
      !refundConfirmed ||
      !refundMethod ||
      refundReason.trim().length < 5
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    const version = sequence.current;
    try {
      await recordMemberFinancialRefund({
        data: {
          memberId: memberId || data.memberId,
          orderId,
          method: refundMethod as "cash" | "card" | "transfer",
          reason: refundReason.trim(),
          confirmed: true,
        },
      });
      if (version !== sequence.current) return;
      window.dispatchEvent(new Event(RECORDS_CHANGED));
      // Suppress another submission even if the follow-up read fails.
      setRefundConfirmed(false);
      setRefundRecorded(true);
      const result = await read();
      if (!result.orders[0]?.reversal?.refund)
        throw new Error(
          "El reembolso fue aceptado pero no se pudo releer. Consulta el estado antes de reintentar.",
        );
      if (version === sequence.current) setStored({ scope, data: result });
    } catch (e) {
      if (version === sequence.current)
        setError(e instanceof Error ? e.message : "No se pudo registrar el reembolso");
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
            Historial original y rectificación contable. Al anular, se repone la cantidad vendida en el inventario; la merma no se repone.
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
            {(order.reversal?.items ?? data.items).map((i: any) => (
              <p key={i.id} className="text-sm border-b border-border py-2">
                {i.product_name} · {i.quantity} {i.unit_type} · {formatPrice(i.line_total_cents)}
              </p>
            ))}
            {order.status === "cancelled" && (
              <div className="rounded-xl border border-red-400/30 p-4 space-y-2 text-sm break-words">
                <h3 className="font-display">Detalles de anulación</h3>
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
            {order.status === "cancelled" && order.reversal && (
              <div className="text-sm space-y-3 border-t border-border pt-3">
                {order.reversal.refund ? (
                  <>
                    <p className="font-display">Reembolso registrado</p>
                    <p>
                      {formatPrice(order.reversal.refund.cents)} ·{" "}
                      {paymentMethodLabel(order.reversal.refund.method)}
                    </p>
                    <p>
                      {order.reversal.refund.by} · {recordTime(order.reversal.refund.at)}
                    </p>
                    <p>
                      {order.reversal.refund.reference} · {order.reversal.refund.reason}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    {refundRecorded
                      ? "Registro de reembolso aceptado; consulta de confirmación pendiente."
                      : "Sin constancia de reembolso realizado. La anulación contable no devuelve dinero."}
                  </p>
                )}
                {order.canRefund && !refundRecorded && (
                  <details>
                    <summary className="cursor-pointer text-neon py-2">
                      Registrar reembolso ya realizado
                    </summary>
                    <div className="space-y-3 pt-2">
                      <p>
                        Importe completo: {formatPrice(order.cents)}. Esta acción solo registra
                        dinero ya devuelto; no realiza un pago.
                      </p>
                      <label className="block">
                        Método real del reembolso
                        <select
                          aria-label="Método real del reembolso"
                          value={refundMethod}
                          disabled={busy}
                          onChange={(e) => setRefundMethod(e.target.value)}
                          className="w-full rounded-lg border border-border bg-input p-2 text-foreground [color-scheme:dark]"
                        >
                          <option value="">Selecciona el método real</option>
                          <option value="cash">Efectivo</option>
                          <option value="card">Tarjeta</option>
                          <option value="transfer">Transferencia</option>
                        </select>
                      </label>
                      <label className="block">
                        Motivo del reembolso
                        <textarea
                          aria-label="Motivo del reembolso"
                          disabled={busy}
                          maxLength={2000}
                          value={refundReason}
                          onChange={(e) => setRefundReason(e.target.value)}
                          className="w-full rounded-lg border border-border bg-input p-2"
                        />
                      </label>
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={refundConfirmed}
                          onChange={(e) => setRefundConfirmed(e.target.checked)}
                        />
                        Confirmo que el dinero ya se ha devuelto y no está registrado previamente.
                      </label>
                      <Button
                        disabled={
                          busy ||
                          !refundConfirmed ||
                          !refundMethod ||
                          refundReason.trim().length < 5
                        }
                        onClick={refund}
                      >
                        Confirmar registro de reembolso
                      </Button>
                    </div>
                  </details>
                )}
              </div>
            )}
            {order.status === "completed" &&
              can("use_cash") &&
              order.annulmentAvailable === false && (
                <p role="status" className="text-sm text-muted-foreground">
                  Anulación con rectificación pendiente de activación en la base de datos.
                </p>
              )}
            {order.canCancel && can("use_cash") && !committed && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-sm text-muted-foreground">
                  Anular conserva el original, descuenta el importe del resultado contable y repone la cantidad vendida en el inventario (no la merma). No realiza un reembolso automático.
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
                {reason.trim().length > 0 && reason.trim().length < 5 && (
                  <p className="text-xs text-amber-300" role="status">Escribe al menos 5 caracteres para habilitar la anulación.</p>
                )}
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
