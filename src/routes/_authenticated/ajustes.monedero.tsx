import {createFileRoute,Link} from "@tanstack/react-router";
import {SnoopLayout} from "@/components/SnoopLayout";
import {ClubWalletSettingsPanel} from "@/components/ClubWalletSettingsPanel";
import {useAuth} from "@/hooks/useAuth";
import {ChevronLeft} from "lucide-react";

export const Route=createFileRoute("/_authenticated/ajustes/monedero")({
 component:MonederoClub,
});
function MonederoClub(){
 const {isAdmin,loading}=useAuth();
 if(loading)return <SnoopLayout><p className="p-6 text-muted-foreground">Cargando…</p></SnoopLayout>;
 if(!isAdmin)return <SnoopLayout title="Monedero"><p className="p-6 text-muted-foreground">Solo el administrador puede configurar el Monedero.</p></SnoopLayout>;
 return <SnoopLayout title="Monedero" subtitle="Activación del Monedero para todo el club">
  <div className="max-w-3xl space-y-5">
   <Link to="/ajustes/personalizaciones" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-neon">
    <ChevronLeft className="h-4 w-4" aria-hidden="true"/> Personalizaciones club
   </Link>
   <ClubWalletSettingsPanel/>
  </div>
 </SnoopLayout>;
}
