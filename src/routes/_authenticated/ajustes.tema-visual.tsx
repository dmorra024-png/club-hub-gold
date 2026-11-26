import {createFileRoute,Link} from "@tanstack/react-router";
import {SnoopLayout} from "@/components/SnoopLayout";
import {ClubThemeSettingsPanel} from "@/components/ClubThemeSettingsPanel";
import {useAuth} from "@/hooks/useAuth";
import {ChevronLeft} from "lucide-react";

export const Route=createFileRoute("/_authenticated/ajustes/tema-visual")({
 component:TemaVisualClub,
});
function TemaVisualClub(){
 const {isAdmin,loading}=useAuth();
 if(loading)return <SnoopLayout><p className="p-6 text-muted-foreground">Cargando…</p></SnoopLayout>;
 if(!isAdmin)return <SnoopLayout title="Tema visual"><p className="p-6 text-muted-foreground">Solo el administrador puede cambiar el tema del club.</p></SnoopLayout>;
 return <SnoopLayout title="Tema visual" subtitle="Elige la apariencia de tu club">
  <div className="max-w-4xl space-y-5">
   <Link to="/ajustes/personalizaciones" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-neon">
    <ChevronLeft className="h-4 w-4" aria-hidden="true"/> Personalizaciones club
   </Link>
   <ClubThemeSettingsPanel/>
  </div>
 </SnoopLayout>;
}
