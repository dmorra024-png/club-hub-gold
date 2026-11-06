import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { accessRedirect, parseAccountAccess } from "@/lib/access-context";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const { data: raw, error: accessError } = await supabase.rpc("snoop_access_context");
    if (accessError) throw new Error("No se pudo verificar el acceso del club");
    const access = parseAccountAccess(raw);
    const target = accessRedirect(access, location.pathname);
    if (target) throw redirect({ href: target });
    return { user: data.user, access };
  },
  component: () => <Outlet />,
});
