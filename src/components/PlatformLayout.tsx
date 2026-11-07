import type { ReactNode } from "react";
import { BrandImage } from "./BrandImage";
import { supabase } from "@/integrations/supabase/client";
export function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <header className="max-w-6xl mx-auto flex justify-between items-center border-b border-neon/25 pb-5">
        <BrandImage src={"/icons/snoop-commercial.svg"} alt="Snoop" className="w-32" />
        <span className="font-display text-neon">Administración de la plataforma</span>
        <button
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.assign("/auth");
          }}
        >
          Salir
        </button>
      </header>
      <section className="max-w-6xl mx-auto py-8">{children}</section>
    </main>
  );
}
