import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/unsubscribe")({
  component: Unsubscribe,
  validateSearch: (s: Record<string, unknown>) => ({ token: (s.token as string) ?? "" }),
});

function Unsubscribe() {
  const { token } = useSearch({ from: "/unsubscribe" });
  const [state, setState] = useState<"loading" | "valid" | "done" | "error">("loading");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    if (!token) { setState("error"); setMsg("Token faltante."); return; }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.ok) setState("valid");
        else { setState("error"); setMsg((await r.text()) || "Token inválido."); }
      })
      .catch(() => setState("error"));
  }, [token]);

  async function confirm() {
    try {
      const r = await fetch("/email/unsubscribe", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      });
      if (r.ok) setState("done"); else { setState("error"); setMsg(await r.text()); }
    } catch { setState("error"); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full bg-card border border-neon/25 rounded-2xl p-8 text-center">
        <h1 className="font-display text-2xl tracking-[0.3em] text-neon mb-4">SNOOP</h1>
        {state === "loading" && <p className="text-muted-foreground">Verificando…</p>}
        {state === "valid" && (
          <>
            <p className="text-foreground">¿Confirmas que quieres dejar de recibir estos emails?</p>
            <button onClick={confirm} className="mt-6 px-5 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft">
              Confirmar baja
            </button>
          </>
        )}
        {state === "done" && <p className="text-neon">Listo. Te hemos dado de baja.</p>}
        {state === "error" && <p className="text-red-300">{msg || "No se ha podido completar."}</p>}
      </div>
    </div>
  );
}
