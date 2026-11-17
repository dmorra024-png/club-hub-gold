import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display text-gradient-neon text-glow-neon">404</h1>
        <p className="mt-4 text-muted-foreground">Página no encontrada.</p>
        <a href="/" className="mt-6 inline-block px-6 py-2 bg-gradient-neon text-primary-foreground rounded-md uppercase tracking-widest text-xs font-display">Inicio</a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl text-neon text-glow-neon">Error</h1>
        <p className="mt-2 text-muted-foreground text-sm">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 px-6 py-2 bg-gradient-neon text-primary-foreground rounded-md uppercase tracking-widest text-xs font-display"
        >Reintentar</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "SNOOP — Club access in Spain" },
      { name: "description", content: "Snoop · App de gestión para clubes sociales de cannabis en España." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

// Runs before hydration: recovery links that land anywhere but /reset-password
// (Supabase falls back to the Site URL) must keep their tokens and be forwarded.
const RECOVERY_REDIRECT = `(function(){try{
  var l=window.location;
  if(l.pathname==='/reset-password')return;
  var h=l.hash.replace(/^#/,'');
  var q=l.search.replace(/^\\?/,'');
  var p=new URLSearchParams(h), s=new URLSearchParams(q);
  var isRecovery=p.get('type')==='recovery'||s.get('type')==='recovery'||!!p.get('access_token')||!!s.get('token_hash')||!!s.get('code')&&s.get('type')==='recovery';
  var hasErr=(p.get('error_code')||s.get('error_code'))&&(p.get('type')==='recovery'||s.get('type')==='recovery');
  if(isRecovery||hasErr){l.replace('/reset-password'+l.search+l.hash);}
}catch(e){}})();`;

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: RECOVERY_REDIRECT }} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster theme="dark" position="top-right" toastOptions={{ style: { background: "oklch(0.12 0.015 150)", color: "oklch(0.96 0.01 150)", border: "1px solid oklch(0.3 0.05 150 / 0.4)" } }} />
    </QueryClientProvider>
  );
}
