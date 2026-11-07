import { createFileRoute } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { ClubActivities } from "@/components/ClubActivities";
export const Route = createFileRoute("/_authenticated/actividades")({ component: ActivityPage });
function ActivityPage() {
  return (
    <SnoopLayout title="Actividad del club" subtitle="Historial reciente según tus permisos">
      <ClubActivities expanded />
    </SnoopLayout>
  );
}
