import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { BadgeEuro, Users, ShieldCheck, Cable, BarChart3, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { ClubWalletSettingsPanel } from "@/components/ClubWalletSettingsPanel";

export const Route = createFileRoute("/_authenticated/ajustes/")({
  component: AjustesIndex,
});

function Tile({ to, icon: Icon, title, text }: any) {
  return (
    <Link
      to={to}
      className="group bg-card/60 border border-neon/25 rounded-2xl p-6 hover:border-neon hover:bg-card/80 hover:glow-neon-soft transition flex flex-col items-center text-center"
    >
      <div className="w-14 h-14 rounded-full border border-neon/50 flex items-center justify-center mb-3 group-hover:bg-neon/10 transition">
        <Icon className="w-6 h-6 text-neon" />
      </div>
      <div className="font-display text-lg text-foreground tracking-tight">{title}</div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{text}</p>
    </Link>
  );
}

function AjustesIndex() {
  const { isAdmin, loading, can } = useAuth();
  if (loading) return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;

  return (
    <SnoopLayout title="Ajustes" subtitle={isAdmin ? "Configuración del club" : "Opciones de tu cuenta y permisos"}>
      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
        {isAdmin && <>
          <Tile to="/ajustes/cuotas" icon={BadgeEuro} title="Cuotas" text="Modalidades de inscripción, duración y precio." />
          <ClubWalletSettingsPanel />
          <Tile to="/ajustes/socios" icon={Users} title="Socios" text="Descuentos y campos de inscripción de los socios." />
          <Tile to="/ajustes/colaboradores" icon={ShieldCheck} title="Colaboradores" text="Crea cuentas con permisos específicos para tu equipo." />
          <Tile to="/ajustes/dispositivos" icon={Cable} title="Dispositivos" text="Conecta báscula, lector QR y tableta de firma." />
        </>}
        {can("view_reports") && <Tile to="/ajustes/informes" icon={BarChart3} title="Informes" text="Informes y estadísticas autorizados para tu rol." />}
        <Tile to="/perfil" icon={UserRound} title="Mi perfil" text="Datos de acceso y cambio de contraseña." />
      </div>
    </SnoopLayout>
  );
}
