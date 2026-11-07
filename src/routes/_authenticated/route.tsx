import { authDeadline, verifiedAccess } from "@/lib/auth-access";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { accessRedirect } from "@/lib/access-context";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await authDeadline(supabase.auth.getUser());
    if (
      error &&
      ![400, 401, 403].includes(error.status ?? 0) &&
      error.name !== "AuthSessionMissingError"
    )
      throw new Error("No se pudo verificar la sesión. Comprueba la conexión y reintenta.");
    if (error || !data.user) throw redirect({ to: "/auth" });
    const access = await verifiedAccess(data.user.id);
    const target = accessRedirect(access, location.pathname);
    if (target) throw redirect({ href: target });
    return { user: data.user, access };
  },
  component: () => <Outlet />,
});
