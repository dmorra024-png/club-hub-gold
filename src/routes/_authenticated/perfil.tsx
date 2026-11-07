import { useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { PlatformLayout } from "@/components/PlatformLayout";
import { SnoopWordmark } from "@/components/SnoopWordmark";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { UserRound, LogOut, LockKeyhole } from "lucide-react";
export const Route = createFileRoute("/_authenticated/perfil")({ component: ProfilePage });
function ProfilePage() {
  const verifiedRouteAccess = Route.useRouteContext().access;
  const { user, access, isSuperAdmin, loading } = useAuth();
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const pending = useRef(false);
  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (!user?.email || pending.current) return;
    setError("");
    setMessage("");
    if (password.length < 12)
      return setError("La nueva contraseña debe tener al menos 12 caracteres.");
    if (password !== repeat) return setError("Las contraseñas no coinciden.");
    if (password === current) return setError("Elige una contraseña diferente a la actual.");
    pending.current = true;
    setBusy(true);
    try {
      const response = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      });
      if (response.error || response.data.user?.id !== user.id)
        throw new Error("No se pudo verificar tu contraseña actual.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setCurrent("");
      setPassword("");
      setRepeat("");
      setMessage("Contraseña actualizada de forma segura.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cambiar la contraseña.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const body = (
    <section className="premium-profile" aria-label="Perfil personal">
      <div className="premium-profile-symbol">
        <UserRound aria-hidden="true" />
      </div>
      <h1>Mi perfil</h1>
      {loading ? (
        <p role="status">Verificando sesión…</p>
      ) : (
        <dl>
          <div>
            <dt>Nombre</dt>
            <dd>{String(user?.user_metadata?.full_name || "—")}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user?.email || "—"}</dd>
          </div>
          <div>
            <dt>Rol</dt>
            <dd>
              {access.role === "super_admin"
                ? "Super Admin"
                : access.role === "admin"
                  ? "Administrador del club"
                  : access.role === "collaborator"
                    ? "Colaborador"
                    : "Sin asignación"}
            </dd>
          </div>
          {access.clubName && (
            <div>
              <dt>Club</dt>
              <dd>{access.clubName}</dd>
            </div>
          )}
        </dl>
      )}
      <form onSubmit={changePassword} className="premium-password-form">
        <h2>
          <LockKeyhole size={18} /> Cambiar contraseña
        </h2>
        <label>
          Contraseña actual
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          Nueva contraseña (mínimo 12 caracteres)
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          Repetir nueva contraseña
          <input
            type="password"
            autoComplete="new-password"
            required
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        <button disabled={busy || loading || !user?.email}>
          {busy ? "Verificando…" : "Guardar contraseña"}
        </button>
      </form>
      {message && (
        <p role="status" className="premium-profile-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <button
        className="premium-signout"
        disabled={busy}
        onClick={async () => {
          const { error } = await supabase.auth.signOut();
          if (error) setError("No se pudo cerrar la sesión. Reintenta.");
          else window.location.assign("/auth");
        }}
      >
        <LogOut size={18} /> Salir de mi cuenta
      </button>
    </section>
  );
  // The route already verified the identity before rendering. Keep its shell
  // during refreshes, without granting any operational permissions from it.
  if (isSuperAdmin || (loading && verifiedRouteAccess.role === "super_admin"))
    return <PlatformLayout>{body}</PlatformLayout>;
  if (!loading && access.status !== "active")
    return (
      <main className="premium-main">
        <SnoopWordmark />
        {body}
      </main>
    );
  return <SnoopLayout>{body}</SnoopLayout>;
}
