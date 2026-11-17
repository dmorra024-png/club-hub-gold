import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import snoopLogo from "@/assets/snoop-logo.png.asset.json";

export const Route = createFileRoute("/$clubSlug")({
  component: ClubLogin,
});

type Club = { id: string; name: string; slug: string; logo_url: string | null; city: string | null };

function ClubLogin() {
  const { clubSlug } = Route.useParams();
  const nav = useNavigate();
  const [club, setClub] = useState<Club | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("clubs")
        .select("id, name, slug, logo_url, city")
        .eq("slug", clubSlug.toLowerCase())
        .eq("active", true)
        .maybeSingle();
      if (cancelled) return;
      if (!data) setNotFound(true);
      else setClub(data as Club);
    })();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
    return () => { cancelled = true; };
  }, [clubSlug, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      nav({ to: "/" });
    } catch (err: any) {
      toast.error(err.message ?? "Error de acceso");
    } finally {
      setLoading(false);
    }
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Email enviado. Revisa tu correo.");
      setForgotOpen(false);
      setForgotEmail("");
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setForgotLoading(false);
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <img src={snoopLogo.url} alt="Snoop" className="w-40 opacity-70 mb-6" />
        <h1 className="font-display text-2xl tracking-[0.25em] uppercase text-neon">Club no encontrado</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          El club <span className="text-neon">/{clubSlug}</span> no existe o no está activo.
        </p>
      </div>
    );
  }

  if (!club) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-neon-dim text-xs uppercase tracking-[0.3em] animate-pulse">Cargando…</div>
      </div>
    );
  }

  const logo = club.logo_url || snoopLogo.url;

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden scanline">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <img src={logo} alt="" className="w-[min(110vh,110vw)] opacity-[0.06]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-background/90" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src={logo}
            alt={club.name}
            className="w-32 h-32 mx-auto object-contain rounded-full glow-neon-soft"
          />
          <h1 className="mt-6 font-display text-3xl md:text-4xl tracking-[0.3em] text-neon text-glow-neon uppercase">
            {club.name}
          </h1>
          {club.city && (
            <div className="mt-2 text-[11px] uppercase tracking-[0.3em] text-neon-dim">{club.city}</div>
          )}
          <div className="mt-4 h-[2px] w-16 mx-auto bg-gradient-neon rounded-full glow-neon-soft" />
        </div>

        <div className="bg-card/80 backdrop-blur-xl border border-neon/30 rounded-2xl p-8 shadow-[0_0_50px_-10px_oklch(0.86_0.28_145/0.3)]">
          <div className="text-center mb-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Acceso privado</div>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Email">
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input" />
            </Field>
            <Field label="Contraseña">
              <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="auth-input" />
            </Field>

            <button
              disabled={loading}
              className="w-full mt-4 bg-gradient-neon text-primary-foreground py-3 rounded-lg font-display font-semibold uppercase tracking-[0.25em] text-sm hover:opacity-90 disabled:opacity-50 transition glow-neon"
            >
              {loading ? "..." : "Entrar"}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => { setForgotOpen(true); setForgotEmail(email); }}
              className="text-[11px] uppercase tracking-[0.25em] text-neon-dim hover:text-neon transition"
            >
              ¿Olvidaste la contraseña?
            </button>
          </div>

          {forgotOpen && (
            <form onSubmit={sendReset} className="mt-4 border-t border-neon/20 pt-4 space-y-3">
              <Field label="Email de recuperación">
                <input required type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} className="auth-input" />
              </Field>
              <div className="flex gap-2">
                <button disabled={forgotLoading} className="flex-1 bg-gradient-neon text-primary-foreground py-2 rounded-md text-xs uppercase tracking-widest disabled:opacity-50 font-semibold">
                  {forgotLoading ? "..." : "Enviar link"}
                </button>
                <button type="button" onClick={() => setForgotOpen(false)} className="flex-1 border border-border text-muted-foreground py-2 rounded-md text-xs uppercase tracking-widest">
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-6 text-center">
          <img src={snoopLogo.url} alt="Snoop" className="w-20 mx-auto opacity-40" />
          <div className="mt-1 text-[9px] uppercase tracking-[0.35em] text-neon-dim">Powered by Snoop</div>
        </div>
      </div>

      <style>{`
        .auth-input {
          width: 100%;
          background: oklch(0.1 0.015 150);
          border: 1px solid oklch(0.3 0.05 150 / 0.4);
          color: oklch(0.96 0.01 150);
          padding: 0.65rem 0.9rem;
          border-radius: 8px;
          font-family: var(--font-body);
          outline: none;
          transition: all 0.2s;
        }
        .auth-input:focus {
          border-color: var(--color-neon);
          box-shadow: 0 0 0 3px oklch(0.86 0.28 145 / 0.18);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1.5">{label}</span>
      {children}
    </label>
  );
}
