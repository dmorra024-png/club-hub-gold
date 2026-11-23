import {createFileRoute,Link} from "@tanstack/react-router";
import {ChevronLeft} from "lucide-react";
import {SnoopLayout} from "@/components/SnoopLayout";
import {useAuth} from "@/hooks/useAuth";
import {ClubAccessControlPanel} from "@/components/ClubAccessControlPanel";
import {ClubMermaSettingsPanel} from "@/components/ClubMermaSettingsPanel";
import {MemberDiscounts} from "@/components/MemberDiscounts";

export const Route=createFileRoute("/_authenticated/ajustes/generales")({
 component:Generales,
});
function Generales(){
 const {isAdmin,loading}=useAuth();
 if(loading)return <SnoopLayout><p className="p-6 text-muted-foreground">Cargando…</p></SnoopLayout>;
 if(!isAdmin)return <SnoopLayout title="Generales"><p className="p-6 text-muted-foreground">Solo el administrador puede cambiar estos ajustes.</p></SnoopLayout>;
 return <SnoopLayout title="Generales" subtitle="Configuración general del club" contentClassName="snoop-club-customize">
  <div className="max-w-3xl space-y-5">
   <Link to="/ajustes/personalizaciones" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-neon">
    <ChevronLeft className="h-4 w-4"/> Personalizaciones club
   </Link>
   <ClubAccessControlPanel/>
   <ClubMermaSettingsPanel/>
   <section aria-label="Descuentos del club">
    <MemberDiscounts/>
   </section>
  </div>
 </SnoopLayout>;
}
