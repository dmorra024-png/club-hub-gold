import { useEffect, useState } from "react";
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function PwaInstall() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
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
  if (!prompt) return null;
  return (
    <button
      type="button"
      disabled={busy}
      className="fixed bottom-5 left-5 z-40 rounded-lg border border-neon/40 bg-card px-4 py-2 text-xs text-neon"
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
