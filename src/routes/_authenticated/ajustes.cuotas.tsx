import { createFileRoute } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Save, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/snoop";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/ajustes/cuotas")({
  component: PianiPage,
});

type Plan = {
  id: string;
  name: string;
  duration_days: number;
  price_cents: number;
  active: boolean;
  sort_order: number;
};

function PianiPage() {
  const { isAdmin } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editing, setEditing] = useState<Plan | null>(null);

  async function load() {
    const { data } = await supabase.from("membership_plans").select("*").order("sort_order");
    setPlans((data as any) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save(p: Plan) {
    const { getCurrentClubId } = await import("@/lib/club");
    const clubId = await getCurrentClubId();
    if (!clubId) return toast.error("No tienes un club asignado");
    const payload = {
      club_id: clubId,
      name: p.name,
      duration_days: p.duration_days,
      price_cents: p.price_cents,
      active: p.active,
      sort_order: p.sort_order,
    };
    const { error } = p.id
      ? await supabase.from("membership_plans").update(payload).eq("id", p.id)
      : await supabase.from("membership_plans").insert(payload);
    if (error) return toast.error(error.message);
    toast.success("Cuota guardada");
    setEditing(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar esta cuota?")) return;
    const { error } = await supabase.from("membership_plans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  if (!isAdmin) {
    return <SnoopLayout title="Cuotas"><div className="text-muted-foreground">Sólo el administrador puede gestionar las cuotas.</div></SnoopLayout>;
  }

  return (
    <SnoopLayout title="Cuotas" subtitle="Gestiona las modalidades de inscripción">
      <div className="grid gap-3 max-w-3xl">
        {plans.map((p) => (
          <div key={p.id} className="flex items-center gap-4 bg-card/60 border border-neon/20 rounded-xl p-4">
            <div className="flex-1">
              <div className="font-display text-foreground">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.duration_days} días · {formatPrice(p.price_cents)} {!p.active && "· inactiva"}</div>
            </div>
            <button onClick={() => setEditing(p)} className="text-xs uppercase tracking-widest text-neon hover:text-glow-neon">Editar</button>
            <button onClick={() => remove(p.id)} className="text-destructive hover:text-destructive/80"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button
          onClick={() => setEditing({ id: "", name: "", duration_days: 30, price_cents: 2000, active: true, sort_order: plans.length + 1 })}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-neon/30 hover:border-neon/60 hover:bg-neon/5 rounded-xl py-4 text-sm text-neon font-display uppercase tracking-widest"
        >
          <Plus className="w-4 h-4" /> Nueva cuota
        </button>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-neon/40 rounded-2xl p-6 max-w-md w-full glow-neon-soft">
            <h2 className="font-display text-lg mb-4">{editing.id ? "Editar cuota" : "Nueva cuota"}</h2>
            <div className="space-y-3">
              <Inp label="Nombre" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} />
              <Inp label="Duración (días)" type="number" value={String(editing.duration_days)} onChange={(v) => setEditing({ ...editing, duration_days: parseInt(v) || 0 })} />
              <Inp label="Precio (€)" type="number" value={(editing.price_cents / 100).toString()} onChange={(v) => setEditing({ ...editing, price_cents: Math.round(parseFloat(v) * 100) || 0 })} />
              <Inp label="Orden" type="number" value={String(editing.sort_order)} onChange={(v) => setEditing({ ...editing, sort_order: parseInt(v) || 0 })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="accent-[oklch(0.86_0.28_145)]" />
                Activa
              </label>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={() => setEditing(null)} className="flex-1 border border-border text-muted-foreground py-2 rounded-md text-xs uppercase tracking-widest">Cancelar</button>
              <button onClick={() => save(editing)} className="flex-1 bg-gradient-neon text-primary-foreground py-2 rounded-md text-xs uppercase tracking-widest font-semibold flex items-center justify-center gap-2 glow-neon">
                <Save className="w-3 h-3" /> Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </SnoopLayout>
  );
}

function Inp({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1.5">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none" />
    </label>
  );
}
