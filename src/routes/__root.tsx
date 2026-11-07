import { rememberRoute, forgetRoute } from "@/lib/resume-route";
import { useAuth } from "@/hooks/useAuth";
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
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { PwaInstall } from "@/components/PwaInstall";
import { supabase } from "@/integrations/supabase/client";
import { clearClubCache } from "@/lib/club";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display text-gradient-neon text-glow-neon">404</h1>
        <p className="mt-4 text-muted-foreground">Página no encontrada.</p>
        <a
          href="/"
          className="mt-6 inline-block px-6 py-2 bg-gradient-neon text-primary-foreground rounded-md uppercase tracking-widest text-xs font-display"
        >
          Inicio
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl text-neon text-glow-neon">Error</h1>
        <p className="mt-2 text-muted-foreground text-sm">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="mt-6 px-6 py-2 bg-gradient-neon text-primary-foreground rounded-md uppercase tracking-widest text-xs font-display"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content:
          "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
      },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "SNOOP" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "theme-color", content: "#020b13" },
      { title: "SNOOP — Club access in Spain" },
      {
        name: "description",
        content: "Snoop · App de gestión para clubes sociales de cannabis en España.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/app-192.png" },
    ],
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
  var type=p.get('type')||s.get('type');
  var isRecovery=type==='recovery'||type==='invite';
  var hasErr=(p.get('error_code')||s.get('error_code'))&&isRecovery;
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
  const auth = useAuth();
  const verifiedScope = useRef<string | null>(null);
  useEffect(() => {
    if (auth.loading) return;
    const next =
      !auth.accessError && auth.access.status === "active" && auth.user?.id && auth.access.clubId
        ? `${auth.user.id}:${auth.access.clubId}`
        : null;
    // Invalidate once in the persistent root, not whenever a page mounts a
    // useAuth consumer. Real identity/club changes still cancel stale reads.
    if (!next || (verifiedScope.current && verifiedScope.current !== next)) clearClubCache();
    verifiedScope.current = next;
  }, [auth.loading, auth.accessError, auth.user?.id, auth.access.clubId, auth.access.status]);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [identity, setIdentity] = useState<string | null>(null);
  useEffect(() => {
    if (
      auth.user?.id &&
      auth.access.clubId &&
      auth.access.status === "active" &&
      !auth.loading &&
      !auth.accessError
    )
      rememberRoute(auth.user.id, auth.access.clubId, pathname);
  }, [
    auth.user?.id,
    auth.access.clubId,
    auth.access.status,
    auth.loading,
    auth.accessError,
    pathname,
  ]);
  useEffect(() => {
    let previousUserId: string | null | undefined;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      const changed = previousUserId !== undefined && userId !== previousUserId;
      setIdentity(userId);
      if (event === "SIGNED_OUT" || (previousUserId !== undefined && userId !== previousUserId)) {
        queryClient.clear();
        clearClubCache();
        try {
          window.sessionStorage.removeItem("snoop:member-draft");
        } catch {
          /* Storage may be disabled. */
        }
      }
      previousUserId = userId;
      if (changed || event === "SIGNED_OUT") {
        if (event === "SIGNED_OUT") forgetRoute();
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet key={identity ?? "anonymous"} />
      <PwaInstall />
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: "#0b1827",
            color: "#f3f4f7",
            border: "1px solid #c6a76b55",
          },
        }}
      />
    </QueryClientProvider>
  );
}
