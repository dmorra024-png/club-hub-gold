import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/snoop-logo.png.asset.json";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Acceso | SNOOP" },
      { name: "description", content: "Accede a la gestión de tu club con SNOOP." },
      { property: "og:title", content: "Acceso | SNOOP" },
      { property: "og:description", content: "Accede a la gestión de tu club con SNOOP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
  }, [nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Cuenta creada. Revisa tu email para confirmarla.");
          setMode("signin");
          return;
        }
        toast.success("Cuenta creada. Entrando...");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      nav({ to: "/" });
    } catch (err: any) {
      toast.error(err.message ?? "Error de acceso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden scanline">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <img src={logoAsset.url} alt="" className="w-[min(110vh,110vw)] opacity-[0.06]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 to-background/90" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logoAsset.url} alt="Snoop" className="w-64 mx-auto" />
        </div>

        <div className="bg-card/80 backdrop-blur-xl border border-neon/30 rounded-2xl p-8 shadow-[0_0_50px_-10px_oklch(0.86_0.28_145/0.3)]">
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 py-2 text-xs uppercase tracking-[0.25em] font-display font-semibold transition ${mode === "signin" ? "text-neon border-b-2 border-neon" : "text-muted-foreground border-b-2 border-transparent"}`}
            >Entrar</button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 text-xs uppercase tracking-[0.25em] font-display font-semibold transition ${mode === "signup" ? "text-neon border-b-2 border-neon" : "text-muted-foreground border-b-2 border-transparent"}`}
            >Registrarse</button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <Field label="Nombre completo">
                <input required value={name} onChange={(e) => setName(e.target.value)} className="auth-input" />
              </Field>
            )}
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
              {loading ? "..." : mode === "signin" ? "Entrar" : "Crear cuenta"}
            </button>
          </form>

          {mode === "signin" && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => { setForgotOpen(true); setForgotEmail(email); }}
                className="text-[11px] uppercase tracking-[0.25em] text-neon-dim hover:text-neon transition"
              >
                ¿Olvidaste la contraseña?
              </button>
            </div>
          )}

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

          <p className="text-[10px] text-muted-foreground text-center mt-6 leading-relaxed">
            La primera cuenta registrada se convierte en <span className="text-neon">Administrador</span>.
          </p>
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
