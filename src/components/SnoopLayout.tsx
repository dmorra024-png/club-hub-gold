import { useMobileKeyboard } from "@/hooks/useMobileKeyboard";
import { VoiceAgent } from "@/components/VoiceAgent";
import { SnoopWordmark } from "@/components/SnoopWordmark";
import { Link, Navigate, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Users,
  Package,
  LogOut,
  Menu,
  X,
  Banknote,
  Settings,
  ScanLine,
  UserRound,
  Bell,
  Mic,
} from "lucide-react";
import type { Permission } from "@/lib/access-context";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useRef, useState, type ReactNode } from "react";
const NAV: {
  to: string;
  label: string;
  icon: typeof Home;
  permission?: Permission;
  admin?: boolean;
}[] = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/soci", label: "Socios", icon: Users, permission: "manage_members" },
  { to: "/productos", label: "Productos", icon: Package, permission: "manage_products" },
  { to: "/caja", label: "Caja", icon: Banknote, permission: "use_cash" },
  { to: "/control-acceso", label: "Control acceso", icon: ScanLine, permission: "manage_members" },
  { to: "/ajustes/informes", label: "Informes", icon: Banknote, permission: "view_reports" },
  { to: "/ajustes", label: "Ajustes", icon: Settings, admin: true },
  { to: "/perfil", label: "Perfil", icon: UserRound },
];
export function SnoopLayout({
  children,
  title,
  subtitle,
  home = false,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  home?: boolean;
}) {
  const [voicePhase, setVoicePhase] =
    useState<import("@/hooks/useWhisperDictation").DictationPhase>("idle");
  const { user, access, isAdmin, isSuperAdmin, can, loading, accessError, retryAccess } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const keyboard = useMobileKeyboard();
  const trigger = useRef<HTMLButtonElement>(null),
    drawer = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    drawer.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "Tab") {
        const controls = drawer.current?.querySelectorAll<HTMLElement>("a,button");
        const first = controls?.[0],
          last = controls?.[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open]);
  if (!loading && !accessError && isSuperAdmin) return <Navigate to="/snoop-admin" />;
  if (!loading && !accessError && access.status !== "active") return <Navigate to="/club-status" />;
  const visible = NAV.filter(
    (item) => (!item.admin || isAdmin) && (!item.permission || can(item.permission)),
  );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      className={`premium-shell ${home ? "premium-shell-home" : ""}`}
      data-keyboard-open={keyboard}
      data-menu-open={open}
    >
      <a href="#main-content" className="premium-skip">
        Ir al contenido
      </a>
      <header className="premium-topbar">
        <button
          ref={trigger}
          type="button"
          className="premium-header-button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={open}
          aria-controls="snoop-menu"
        >
          {open ? <X /> : <Menu />}
        </button>
        {!home && (
          <Link to="/" aria-label="SNOOP — Inicio" className="premium-header-brand">
            <SnoopWordmark />
          </Link>
        )}
        <Link
          to="/actividades"
          className="premium-header-button"
          aria-label="Ver actividades del club"
        >
          <Bell />
        </Link>
      </header>
      {open && (
        <>
          <button
            className="premium-menu-backdrop"
            onClick={close}
            aria-label="Cerrar navegación"
            tabIndex={-1}
          />
          <aside
            ref={drawer}
            id="snoop-menu"
            className="premium-menu"
            aria-label="Menú principal"
            role="dialog"
            aria-modal="true"
          >
            <div className="premium-menu-heading">
              <SnoopWordmark />
              <button onClick={close} aria-label="Cerrar menú principal">
                <X />
              </button>
            </div>
            <nav>
              {visible.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={pathname === item.to ? "page" : undefined}
                  onClick={() => setOpen(false)}
                >
                  <item.icon size={19} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
            <div className="premium-menu-account">
              <span>{user?.email}</span>
              <button
                onClick={async () => {
                  const { error } = await supabase.auth.signOut();
                  if (!error) {
                    setOpen(false);
                    await nav({ to: "/auth" });
                  }
                }}
              >
                <LogOut size={16} /> Salir
              </button>
            </div>
          </aside>
        </>
      )}
      {user && access.role && !loading && !accessError && (
        <VoiceAgent
          clubName={access.clubName}
          access={access}
          userId={user.id}
          onPhaseChange={setVoicePhase}
        />
      )}
      <main id="main-content" className="premium-main" tabIndex={-1}>
        {title && (
          <div className="premium-page-heading">
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
        )}
        {(loading || accessError) && (
          <div role={accessError ? "alert" : "status"} className="premium-access-status">
            {accessError || "Verificando sesión y permisos…"}
            {accessError && <button onClick={() => void retryAccess()}>Reintentar acceso</button>}
          </div>
        )}
        <div hidden={loading || !!accessError}>{children}</div>
      </main>
      <nav aria-label="Navegación principal" className="premium-bottom-nav" hidden={keyboard}>
        <Link to="/" aria-current={pathname === "/" ? "page" : undefined}>
          <Home aria-hidden="true" />
          <span>Home</span>
        </Link>
        {can("manage_members") ? (
          <Link
            to="/soci/gestisci"
            search={{ scanner: true }}
            className="premium-qr"
            aria-label="Escanear socio para dispensación"
          >
            <QrAccessIcon />
            <span>QR</span>
          </Link>
        ) : (
          <button
            className="premium-qr"
            disabled
            aria-label="Lector QR no autorizado"
            title="Sin permiso de gestión de socios"
          >
            <QrAccessIcon />
            <span>QR</span>
          </button>
        )}
        <button
          type="button"
          className="premium-dock-voice"
          aria-label="Voice 2.0"
          aria-pressed={voicePhase === "recording"}
          aria-busy={voicePhase === "starting" || voicePhase === "processing"}
          disabled={
            loading ||
            !!accessError ||
            access.status !== "active" ||
            voicePhase === "starting" ||
            voicePhase === "processing"
          }
          onClick={() => window.dispatchEvent(new Event("snoop:voice-start"))}
        >
          <Mic aria-hidden="true" />
          <span>Voice</span>
        </button>
        <Link to="/perfil" aria-current={pathname === "/perfil" ? "page" : undefined}>
          <UserRound aria-hidden="true" />
          <span>Perfil</span>
        </Link>
      </nav>
    </div>
  );
}

function QrAccessIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2H4a2 2 0 0 0-2 2v4m14-6h4a2 2 0 0 1 2 2v4M2 16v4a2 2 0 0 0 2 2h4m14-6v4a2 2 0 0 1-2 2h-4" />
      <rect x="6" y="6" width="4" height="4" rx=".4" />
      <rect x="14" y="6" width="4" height="4" rx=".4" />
      <rect x="6" y="14" width="4" height="4" rx=".4" />
      <path d="M14 14h4v4h-4zM16 14v2h2" />
    </svg>
  );
}
