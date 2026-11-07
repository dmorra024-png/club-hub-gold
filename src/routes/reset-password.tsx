import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cambiar contraseña | SNOOP" },
      {
        name: "description",
        content: "Crea una nueva contraseña segura para tu cuenta SNOOP.",
      },
      { name: "referrer", content: "no-referrer" },
      { property: "og:title", content: "Cambiar contraseña | SNOOP" },
      {
        property: "og:description",
        content: "Crea una nueva contraseña segura para tu cuenta SNOOP.",
      },
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
  const verification = useRef<Promise<boolean> | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        if (!cancelled) {
          setReady(true);
          setErrorMsg(null);
        }
      }
    });

    verification.current ??= (async () => {
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
      const errorDesc = hash.get("error_description") || url.searchParams.get("error_description");
      // Scrub the token before Auth events can invalidate/remount this route.
      // Reuse the same in-flight promise when effects are mounted again.
      const clean = () => window.history.replaceState({}, "", "/reset-password");
      if (errorDesc) {
        clean();
        throw new Error(errorDesc);
      }
      const accessToken = hash.get("access_token"),
        refreshToken = hash.get("refresh_token");
      if (accessToken && refreshToken) {
        clean();
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) throw error;
        return true;
      }
      const tokenHash = url.searchParams.get("token_hash") || hash.get("token_hash");
      const type = url.searchParams.get("type") || hash.get("type");
      if (tokenHash) {
        clean();
        if (type !== "invite" && type !== "recovery")
          throw new Error("Enlace inválido. Solicita una nueva invitación o recuperación.");
        const { error } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (error) throw error;
        return true;
      }
      const code = url.searchParams.get("code");
      if (code) {
        clean();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        return true;
      }
      if (type === "invite" || type === "recovery") clean();
      for (let i = 0; i < 12; i++) {
        const { data } = await supabase.auth.getSession();
        if (data.session) return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("Enlace inválido o caducado. Solicita un nuevo email de recuperación.");
    })();
    verification.current
      .then(() => {
        if (!cancelled) {
          setReady(true);
          setErrorMsg(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setErrorMsg(error instanceof Error ? error.message : "Error");
      });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || loading) return;
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
      await nav({ to: "/" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se ha podido cambiar la contraseña");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 scanline">
      <div className="w-full max-w-md">
        <img src={"/icons/snoop-commercial.svg"} alt="Snoop" className="w-52 mx-auto mb-8" />
        {errorMsg ? (
          <div className="bg-card/80 backdrop-blur border border-destructive/40 rounded-2xl p-8 space-y-4 text-center">
            <h2 className="font-display text-xl text-destructive">Enlace no válido</h2>
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <button
              onClick={() => nav({ to: "/auth" })}
              className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm glow-neon"
            >
              Volver a iniciar sesión
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="bg-card/80 backdrop-blur border border-neon/30 rounded-2xl p-8 space-y-4 glow-neon-soft"
          >
            <h2 className="font-display text-xl text-neon">Nueva contraseña</h2>
            {!ready && <p className="text-xs text-muted-foreground">Validando enlace…</p>}
            <input
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              placeholder="Nueva contraseña (mínimo 8 caracteres)"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none"
            />
            <input
              required
              type="password"
              minLength={8}
              autoComplete="new-password"
              placeholder="Repite contraseña"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none"
            />
            <button
              disabled={loading || !ready}
              className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm disabled:opacity-50 glow-neon"
            >
              {loading ? "..." : "Actualizar"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
