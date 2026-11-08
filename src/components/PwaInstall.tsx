import { useEffect, useState, useRef } from "react";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function PwaInstall() {
  const updateCleanup = useRef<() => void>(() => {});
  useEffect(() => () => updateCleanup.current(), []);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [ios, setIos] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) && !standalone);
    const update = () => {
      if (document.visibilityState === "visible") registration?.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", update);
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
          if (reg.waiting) setWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (worker.state === "installed" && navigator.serviceWorker.controller)
                setWaiting(worker);
            });
          });
        })
        .catch(() => console.warn("PWA registration failed"));
    } else if ("serviceWorker" in navigator) {
      // Development must not keep an older PWA's offline fallback in control.
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) => {
                const script =
                  registration.active?.scriptURL ||
                  registration.waiting?.scriptURL ||
                  registration.installing?.scriptURL;
                return (
                  script &&
                  new URL(script).origin === location.origin &&
                  new URL(script).pathname === "/sw.js"
                );
              })
              .map((registration) => registration.unregister()),
          ),
        )
        .then(async () => {
          if ("caches" in window)
            for (const key of await caches.keys())
              if (key.startsWith("clubhub-public-")) await caches.delete(key);
        })
        .catch(() => console.warn("Development PWA cleanup unavailable"));
    }
    const onInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const onInstalled = () => setPrompt(null);
    const onConnection = () => setOffline(!navigator.onLine);
    onConnection();
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onConnection);
    window.addEventListener("offline", onConnection);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onConnection);
      window.removeEventListener("offline", onConnection);
    };
  }, []);
  if (offline)
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-50 bg-card p-2 text-center text-sm text-neon"
      >
        Sin conexión / Nessuna connessione — comprueba los envíos pendientes
      </div>
    );
  if (waiting)
    return (
      <button
        type="button"
        disabled={busy}
        className="snoop-install-control snoop-update-control fixed bottom-5 left-5 z-40 rounded-lg border border-neon/40 bg-card px-4 py-2 text-xs text-neon"
        onClick={() => {
          if (
            !confirm(
              "Termina y guarda los formularios antes de actualizar. ¿Recargar la aplicación?",
            )
          )
            return;
          if (busy) return;
          setBusy(true);
          const changed = () => {
            if (navigator.serviceWorker.controller !== waiting) return;
            cleanup();
            window.location.reload();
          };
          const timeout = setTimeout(() => {
            cleanup();
            setBusy(false);
          }, 30000);
          const cleanup = () => {
            clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener("controllerchange", changed);
          };
          updateCleanup.current();
          updateCleanup.current = cleanup;
          navigator.serviceWorker.addEventListener("controllerchange", changed);
          try {
            waiting.postMessage({ type: "SKIP_WAITING" });
          } catch {
            cleanup();
            setBusy(false);
          }
        }}
      >
        Actualizar app / Aggiorna app
      </button>
    );
  if (!prompt)
    return ios ? (
      <details className="snoop-install-control fixed bottom-5 left-5 z-40 max-w-[65vw] rounded-lg border border-neon/40 bg-card p-3 text-xs text-neon">
        <summary>Instalar en iPhone / Installa su iPhone</summary>
        <p className="mt-2">
          Safari: Compartir / Condividi → Añadir a pantalla de inicio / Aggiungi alla schermata
          Home.
        </p>
      </details>
    ) : null;
  return (
    <button
      type="button"
      disabled={busy}
      className="snoop-install-control fixed bottom-5 left-5 z-40 rounded-lg border border-neon/40 bg-card px-4 py-2 text-xs text-neon"
      onClick={async () => {
        setBusy(true);
        try {
          await prompt.prompt();
          await prompt.userChoice;
        } catch {
          console.warn("PWA installation unavailable or cancelled");
        } finally {
          setPrompt(null);
          setBusy(false);
        }
      }}
    >
      Instalar app / Installa app
    </button>
  );
}
