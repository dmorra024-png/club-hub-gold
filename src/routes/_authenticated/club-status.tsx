import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
export const Route = createFileRoute("/_authenticated/club-status")({ component: ClubStatus });
function ClubStatus() {
  const { access } = useAuth();
  const message =
    access.status === "suspended"
      ? "El club está suspendido."
      : access.status === "expired"
        ? "La suscripción del club ha caducado."
        : "La cuenta todavía no tiene un club operativo asignado.";
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background">
      <section className="max-w-md rounded-2xl border border-neon/30 bg-card p-8 text-center">
        <h1 className="font-display text-2xl text-neon">Acceso al club</h1>
        <p role="status" className="my-6">
          {message} Los datos se conservan.
        </p>
        <Link to="/reset-password" className="block text-neon mb-4">
          Recuperar acceso a la cuenta
        </Link>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.assign("/auth");
          }}
          className="text-muted-foreground"
        >
          Cerrar sesión
        </button>
      </section>
    </main>
  );
}
