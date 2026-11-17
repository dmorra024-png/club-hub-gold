import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Home, Users, Package, LogOut, Menu, X, Shield, Banknote, Settings, ScanLine } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import logoAsset from "@/assets/snoop-logo.png.asset.json";
import { cn } from "@/lib/utils";
import { useState, type ReactNode } from "react";

type NavItem = { to: string; label: string; icon: any; show: (a: { isAdmin: boolean; isSuperAdmin: boolean }) => boolean };

const NAV: NavItem[] = [
  { to: "/", label: "Inicio", icon: Home, show: () => true },
  { to: "/snoop-admin", label: "Snoop Admin", icon: Shield, show: (a) => a.isSuperAdmin },
  { to: "/soci", label: "Socios", icon: Users, show: (a) => !a.isSuperAdmin },
  { to: "/control-acceso", label: "Control acceso", icon: ScanLine, show: (a) => !a.isSuperAdmin },
  { to: "/productos", label: "Productos", icon: Package, show: (a) => !a.isSuperAdmin },
  { to: "/caja", label: "Caja", icon: Banknote, show: (a) => !a.isSuperAdmin },
  { to: "/ajustes", label: "Ajustes", icon: Settings, show: (a) => a.isAdmin && !a.isSuperAdmin },
];


export function SnoopLayout({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  const { user, access, isAdmin, isSuperAdmin } = useAuth();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const visible = NAV.filter((n) => n.show({ isAdmin, isSuperAdmin }));

  async function signOut() {
    await supabase.auth.signOut();
    setOpen(false);
    nav({ to: "/auth" });
  }

  return (
    <div className="relative min-h-screen flex scanline">
      {/* Watermark */}
      <div aria-hidden className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden">
        <img src={logoAsset.url} alt="" className="w-[min(120vh,120vw)] max-w-none opacity-[0.04] select-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/20 to-background" />
      </div>

      {/* Sidebar desktop */}
      <aside className="relative z-10 hidden md:flex w-64 flex-col border-r border-neon/20 bg-card/60 backdrop-blur-md">
        <div className="px-6 py-8 border-b border-neon/15 flex flex-col items-center text-center">
          <img src={logoAsset.url} alt="Snoop" className="w-32 object-contain" />
        </div>

        <nav className="flex-1 px-3 py-6 space-y-1">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all relative group",
                  active
                    ? "bg-neon/10 text-neon glow-neon-soft"
                    : "text-muted-foreground hover:text-neon hover:bg-neon/5",
                )}
              >
                {active && <span className="absolute left-0 top-2 bottom-2 w-[2px] bg-neon rounded-full" />}
                <Icon className="w-4 h-4" />
                <span className="font-display font-medium tracking-wide text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-neon/15">
          <div className="text-xs text-muted-foreground mb-1 truncate">{user?.email}</div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-3">{access.role ?? "—"}</div>
          <button onClick={signOut} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-neon hover:bg-neon/5 transition">
            <LogOut className="w-3 h-3" /> Salir
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden fixed top-0 inset-x-0 z-30 flex items-center justify-between px-4 h-14 bg-card/95 backdrop-blur border-b border-neon/20">
        <img src={logoAsset.url} alt="Snoop" className="h-7 object-contain" />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-10 w-10 rounded-full border border-neon/40 bg-input text-neon flex items-center justify-center glow-neon-soft"
          aria-label={open ? "Cerrar menú" : "Abrir menú"}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {open && (
        <div className="md:hidden fixed inset-x-3 top-16 z-30 rounded-2xl border border-neon/40 bg-card/95 backdrop-blur-xl shadow-2xl overflow-hidden glow-neon-soft">
          <div className="px-4 py-3 border-b border-neon/20">
            <div className="text-[10px] uppercase tracking-[0.35em] text-neon-dim">Menú</div>
            <div className="text-xs text-muted-foreground truncate mt-1">{user?.email}</div>
          </div>
          <nav className="p-2 grid gap-1">
            {visible.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.to || pathname.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all",
                    active ? "bg-neon/15 text-neon border border-neon/40" : "text-muted-foreground border border-transparent hover:text-neon",
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="font-display font-medium tracking-wide">{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="p-3 border-t border-neon/20 flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-widest text-neon-dim">{access.role ?? "—"}</div>
            <button type="button" onClick={signOut} className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-neon transition uppercase tracking-widest">
              <LogOut className="w-3 h-3" /> Salir
            </button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="relative z-10 flex-1 min-h-screen pt-14 md:pt-0 pb-10">
        <div className="max-w-6xl mx-auto px-4 md:px-10 py-8">
          {title && (
            <div className="mb-8">
              <h1 className="font-display text-3xl md:text-4xl text-foreground tracking-tight">
                {title}
              </h1>
              {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
              <div className="mt-3 h-[2px] w-16 bg-gradient-neon rounded-full glow-neon-soft" />
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
