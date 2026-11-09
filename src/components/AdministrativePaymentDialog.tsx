import { toast } from "sonner";
import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { paymentReview } from "@/lib/administrative-payment";
import { formatPrice } from "@/lib/snoop";
export function AdministrativePaymentDialog({
  open,
  onOpenChange,
  title,
  totalCents,
  method,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  totalCents: number;
  method: string;
  busy: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [received, setReceived] = useState("");
  const sending = useRef(false);
  const review = paymentReview(totalCents, method, received);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy && !sending.current) {
          setReceived("");
          onOpenChange(v);
        }
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Revisa la aportación antes de registrarla. Cancelar no guarda ningún pago.
          </DialogDescription>
        </DialogHeader>
        <p className="text-2xl">
          Total: <strong>{formatPrice(totalCents)}</strong>
        </p>
        {method === "cash" ? (
          <>
            <label>
              Dinero recibido (€)
              <Input
                aria-label="Dinero recibido (€)"
                inputMode="decimal"
                value={received}
                disabled={busy}
                onChange={(e) => setReceived(e.target.value)}
              />
            </label>
            <p aria-label="Cambio">Cambio: {review ? formatPrice(review.changeCents!) : "—"}</p>
            {!review && received && (
              <p role="alert">Introduce un importe válido igual o superior al total.</p>
            )}
          </>
        ) : (
          <p>
            Método:{" "}
            {
              (
                { card: "Tarjeta", transfer: "Transferencia", other: "Otro" } as Record<
                  string,
                  string
                >
              )[method]
            }
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setReceived("");
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            disabled={busy || !review}
            onClick={async () => {
              if (sending.current || !review) return;
              sending.current = true;
              try {
                const result = await onConfirm();
                if (result === true && review.changeCents !== null)
                  toast.success(`Cambio a entregar: ${formatPrice(review.changeCents)}`);
              } finally {
                sending.current = false;
              }
            }}
          >
            {busy ? "Registrando…" : "Confirmar aportación"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
