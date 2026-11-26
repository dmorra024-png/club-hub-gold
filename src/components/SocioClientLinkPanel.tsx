import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { sendSocioInvitationEmail } from "@/lib/socio-invitation-email.functions";

/**
 * The only SNOOP Socio action in member management.
 * The six-digit code is delivered by email only; never exposed to staff.
 */
export function SocioClientLinkPanel({ memberId }: { memberId: string }) {
  const { can } = useAuth();
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  if (!can("manage_members")) return null;

  async function send() {
    if (sending) return;
    setSending(true);
    setStatus("");
    try {
      const result = await sendSocioInvitationEmail({ data: { memberId } });
      if (result.status !== "accepted") throw new Error("Envío no confirmado");
      setStatus("El proveedor ha aceptado el envío del código de 6 cifras. Comprueba el correo del socio.");
      toast.success("Solicitud de envío aceptada.");

    } catch (e) {
      const message = e instanceof Error ? e.message : "No se pudo enviar la invitación.";
      setStatus(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-2xl border border-neon/25 bg-card/60 p-4">
      <button type="button" onClick={() => void send()} disabled={sending}
        className="w-full flex items-center justify-center gap-3 rounded-xl bg-gradient-neon px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">
        <Mail aria-hidden="true" size={19} />
        {sending ? "Enviando invitación…" : "Enviar email App Socio"}
      </button>
      {status && <p className="mt-2 text-xs text-muted-foreground" role="status">{status}</p>}
    </section>
  );
}
