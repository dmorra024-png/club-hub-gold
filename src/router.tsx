import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function DefaultNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-display text-gradient-gold">404</h1>
        <p className="mt-4 text-muted-foreground">Pagina non trovata.</p>
        <a href="/" className="mt-6 inline-block px-6 py-2 bg-gradient-gold text-primary-foreground rounded-md uppercase tracking-widest text-xs">Home</a>
      </div>
    </div>
  );
}

function DefaultError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl text-gold">Errore</h1>
        <p className="mt-2 text-muted-foreground text-sm">{error.message}</p>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: DefaultNotFound,
    defaultErrorComponent: DefaultError,
  });

  return router;
};
