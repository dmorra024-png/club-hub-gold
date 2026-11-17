import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/snoop-logo.png.asset.json";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cambiar contraseña | SNOOP" },
      { name: "description", content: "Crea una nueva contraseña segura para tu cuenta SNOOP." },
      { property: "og:title", content: "Cambiar contraseña | SNOOP" },
      { property: "og:description", content: "Crea una nueva contraseña segura para tu cuenta SNOOP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        if (!cancelled) { setReady(true); setErrorMsg(null); }
      }
    });

    (async () => {
      try {
        const url = new URL(window.location.href);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const errorDesc = hash.get("error_description") || url.searchParams.get("error_description");
        if (errorDesc) {
          setErrorMsg(decodeURIComponent(errorDesc).replace(/\+/g, " "));
          return;
        }

        const clean = () => window.history.replaceState({}, "", "/reset-password");

        // Implicit flow: #access_token=...&refresh_token=...&type=recovery
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) { setErrorMsg(error.message); return; }
          clean();
          if (!cancelled) setReady(true);
          return;
        }

        // New Supabase format: ?token_hash=...&type=recovery
        const tokenHash = url.searchParams.get("token_hash");
        const type = url.searchParams.get("type") || hash.get("type");
        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          if (error) { setErrorMsg(error.message); return; }
          clean();
          if (!cancelled) setReady(true);
          return;
        }

        // PKCE flow: ?code=...
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { setErrorMsg(error.message); return; }
          clean();
          if (!cancelled) setReady(true);
          return;
        }

        if (type === "recovery") {
          clean();
          const { data } = await supabase.auth.getSession();
          if (data.session && !cancelled) { setReady(true); return; }
        }

        // No token in the URL: wait a bit in case the client is still parsing it.
        for (let i = 0; i < 12; i++) {
          const { data } = await supabase.auth.getSession();
          if (cancelled) return;
          if (data.session) { setReady(true); return; }
          await new Promise((r) => setTimeout(r, 250));
        }
        if (!cancelled) setErrorMsg("Enlace inválido o caducado. Solicita un nuevo email de recuperación.");
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e.message ?? "Error");
      }
    })();

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);


  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return toast.error("Las contraseñas no coinciden");
    setLoading(true);
    try {
      if (pw.length < 8) {
        toast.error("La contraseña debe tener al menos 8 caracteres");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      toast.success("Contraseña actualizada");
      nav({ to: "/" });
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 scanline">
      <div className="w-full max-w-md">
        <img src={logoAsset.url} alt="Snoop" className="w-52 mx-auto mb-8" />
        {errorMsg ? (
          <div className="bg-card/80 backdrop-blur border border-destructive/40 rounded-2xl p-8 space-y-4 text-center">
            <h2 className="font-display text-xl text-destructive">Enlace no válido</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <button onClick={() => nav({ to: "/auth" })} className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm glow-neon">
              Volver a iniciar sesión
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-card/80 backdrop-blur border border-neon/30 rounded-2xl p-8 space-y-4 glow-neon-soft">
            <h2 className="font-display text-xl text-neon">Nueva contraseña</h2>
            {!ready && <p className="text-xs text-muted-foreground">Validando enlace…</p>}
            <input required type="password" minLength={8} autoComplete="new-password" placeholder="Nueva contraseña (mínimo 8 caracteres)" value={pw} onChange={(e)=>setPw(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
            <input required type="password" minLength={8} autoComplete="new-password" placeholder="Repite contraseña" value={pw2} onChange={(e)=>setPw2(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
            <button disabled={loading || !ready} className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm disabled:opacity-50 glow-neon">
              {loading ? "..." : "Actualizar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
