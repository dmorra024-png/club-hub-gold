import {createFileRoute,Link} from "@tanstack/react-router";
import {SnoopLayout} from "@/components/SnoopLayout";
import {ClubMermaSettingsPanel} from "@/components/ClubMermaSettingsPanel";
import {useAuth} from "@/hooks/useAuth";
import {BadgeEuro,Wallet,Users,Cable,Palette,ChevronRight} from "lucide-react";

export const Route=createFileRoute("/_authenticated/ajustes/personalizaciones")({
 component:PersonalizacionesClub,
});
const settings=[
 {to:"/ajustes/cuotas",icon:BadgeEuro,title:"Cuotas",description:"Inscripción, duración y precio de las cuotas."},
 {to:"/ajustes/monedero",icon:Wallet,title:"Monedero",description:"Activación y desactivación del Monedero para todo el club."},
 {to:"/ajustes/socios",icon:Users,title:"Socios",description:"Descuentos y campos de inscripción de los socios."},
 {to:"/ajustes/dispositivos",icon:Cable,title:"Dispositivos",description:"Báscula, lector QR y firma digital."},
 {to:"/ajustes/tema-visual",icon:Palette,title:"Tema visual",description:"Paleta y apariencia del club."},
] as const;
function PersonalizacionesClub(){
 const {isAdmin,loading}=useAuth();
 if(loading)return <SnoopLayout><p className="p-6 text-muted-foreground">Cargando…</p></SnoopLayout>;
 if(!isAdmin)return <SnoopLayout title="Personalizaciones club"><p className="p-6 text-muted-foreground">Solo el administrador puede personalizar el club.</p></SnoopLayout>;
 return <SnoopLayout title="Personalizaciones club" subtitle="Configura la experiencia y el funcionamiento de tu club" contentClassName="snoop-club-customize">
  <div className="snoop-club-customize-list grid gap-3 max-w-3xl" aria-label="Opciones de personalización del club">
   {settings.map(({to,icon:Icon,title,description})=>(
    <Link key={to} to={to} className="snoop-settings-card group flex items-center gap-4 rounded-2xl border border-neon/25 bg-card/60 p-4 sm:p-5 transition hover:border-neon/60 hover:bg-card/80">
     <div className="snoop-settings-icon flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-neon/35 bg-neon/5">
      <Icon className="h-5 w-5 text-neon" aria-hidden="true"/>
     </div>
     <div className="min-w-0 flex-1">
      <div className="snoop-settings-title font-display text-base sm:text-lg text-foreground">{title}</div>
      <p className="snoop-settings-desc mt-1 text-xs text-muted-foreground leading-relaxed">{description}</p>
     </div>
     <ChevronRight className="snoop-settings-chevron h-5 w-5 shrink-0 text-neon/70" aria-hidden="true"/>
    </Link>
   ))}
  </div>
  <div className="mt-6 max-w-3xl"><ClubMermaSettingsPanel/></div>
 </SnoopLayout>;
}
