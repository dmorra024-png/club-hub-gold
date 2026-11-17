import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { BadgeEuro, Users, ShieldCheck, Cable, BarChart3 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";

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
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!loading && !isAdmin) nav({ to: "/" }); }, [loading, isAdmin, nav]);
  if (loading || !isAdmin) return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;

  return (
    <SnoopLayout title="Ajustes" subtitle="Configuración exclusiva del administrador del club">
      <div className="grid sm:grid-cols-2 gap-4 max-w-3xl">
        <Tile to="/ajustes/cuotas" icon={BadgeEuro} title="Cuotas" text="Modalidades de inscripción, duración y precio." />
        <Tile to="/ajustes/socios" icon={Users} title="Socios" text="Elige qué campos pedir al crear un socio y cuáles son obligatorios." />
        <Tile to="/ajustes/colaboradores" icon={ShieldCheck} title="Colaboradores" text="Crea cuentas con permisos específicos para tu equipo." />
        <Tile to="/ajustes/dispositivos" icon={Cable} title="Dispositivos" text="Conecta báscula, lector QR y tableta de firma." />
        <Tile to="/ajustes/informes" icon={BarChart3} title="Informes" text="Gráficos de stock añadido, ventas y productos más vendidos." />
      </div>
    </SnoopLayout>
  );
}
