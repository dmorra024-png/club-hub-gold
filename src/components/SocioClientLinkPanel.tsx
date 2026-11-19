import { useState } from "react";
import { Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { sendSocioInvitationEmail } from "@/lib/socio-invitation-email.functions";

/**
 * The only SNOOP Socio action in member management.
 * Neither the enrollment QR nor the one-use invitation code is ever shown here.
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
      if (result.status === "manual") {
        // Opens the device's configured mail composer; the operator explicitly
        // sends the email. Never display a sent status before they do so.
        const mailto = "mailto:" + encodeURIComponent(result.recipient)
          + "?subject=" + encodeURIComponent(result.subject)
          + "&body=" + encodeURIComponent(result.text);
        setStatus("Email preparado. Pulsa Enviar en tu aplicación de correo.");
        window.location.assign(mailto);
      } else if (result.status === "accepted") {
        setStatus("Correo aceptado por el proveedor. Entrega en bandeja de entrada no confirmada.");
        toast.success("Invitación aceptada por el proveedor de correo.");
      } else throw new Error("Envío no confirmado");
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
