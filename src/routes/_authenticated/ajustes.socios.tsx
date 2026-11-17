import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MEMBER_FIELDS, defaultFieldConfig, mergeFieldConfig, type FieldConfigMap, type MemberFieldKey } from "@/lib/member-fields";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ajustes/socios")({
  component: AjustesSocios,
});

function AjustesSocios() {
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  const [cfg, setCfg] = useState<FieldConfigMap>(defaultFieldConfig());
  const [clubId, setClubId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && !isAdmin) nav({ to: "/" }); }, [loading, isAdmin, nav]);

  useEffect(() => {
    (async () => {
      const { getCurrentClubId } = await import("@/lib/club");
      const id = await getCurrentClubId();
      setClubId(id);
      if (!id) return;
      const { data } = await supabase
        .from("club_member_field_config")
        .select("field_key, visible, required")
        .eq("club_id", id);
      setCfg(mergeFieldConfig((data as any) ?? []));
    })();
  }, []);

  function update(k: MemberFieldKey, patch: Partial<{ visible: boolean; required: boolean }>) {
    setCfg((c) => {
      const next = { ...c[k], ...patch };
      // If made invisible, can't be required
      if (next.visible === false) next.required = false;
      // If made required, must be visible
      if (next.required === true) next.visible = true;
      return { ...c, [k]: next };
    });
  }

  async function save() {
    if (!clubId) return toast.error("Sin club asignado");
    setBusy(true);
    try {
      const rows = MEMBER_FIELDS.map((f) => ({
        club_id: clubId,
        field_key: f.key,
        visible: cfg[f.key].visible,
        required: cfg[f.key].required,
        sort_order: f.sort,
      }));
      const { error } = await supabase
        .from("club_member_field_config")
        .upsert(rows, { onConflict: "club_id,field_key" });
      if (error) throw error;
      toast.success("Configuración guardada");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !isAdmin) return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;

  return (
    <SnoopLayout title="Campos de socio" subtitle="Elige qué campos aparecen al crear un socio y cuáles son obligatorios">
      <div className="max-w-3xl">
        <div className="mb-4 text-xs text-muted-foreground">
          <strong className="text-foreground">Nombre</strong> y <strong className="text-foreground">Apellidos</strong> son siempre obligatorios.
        </div>

        <div className="bg-card/60 border border-neon/25 rounded-2xl overflow-hidden">
          <div className="grid grid-cols-[1fr_90px_110px] items-center text-[10px] uppercase tracking-[0.25em] text-neon-dim px-4 py-3 border-b border-neon/15 bg-card/40">
            <div>Campo</div>
            <div className="text-center">Visible</div>
            <div className="text-center">Obligatorio</div>
          </div>
          {MEMBER_FIELDS.map((f) => {
            const v = cfg[f.key];
            return (
              <div key={f.key} className="grid grid-cols-[1fr_90px_110px] items-center px-4 py-3 border-b border-neon/10 last:border-0">
                <div className="text-sm text-foreground">{f.label}</div>
                <div className="text-center">
                  <input type="checkbox" checked={v.visible} onChange={(e) => update(f.key, { visible: e.target.checked })} className="h-4 w-4 accent-[#39ff14]" />
                </div>
                <div className="text-center">
                  <input type="checkbox" checked={v.required} onChange={(e) => update(f.key, { required: e.target.checked })} className="h-4 w-4 accent-[#39ff14]" />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end mt-5">
          <button onClick={save} disabled={busy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-neon text-primary-foreground font-display uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar configuración
          </button>
        </div>
      </div>
    </SnoopLayout>
  );
}
