import { useVoiceToolPort } from "@/hooks/useVoiceToolPort";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentClubId } from "@/lib/club";
import { useAuth } from "@/hooks/useAuth";
import {
  discountStatus,
  discountUnavailable,
  parseDiscountPercentage,
  type MemberDiscount,
} from "@/lib/member-discounts";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

const inputClass = "w-full bg-input border border-border rounded-lg px-3 py-2 text-sm";
export function MemberDiscounts({ memberId }: { memberId?: string }) {
  const { isAdmin, user, can, loading, access } = useAuth();
  const canRead = can("manage_members");
  const [discounts, setDiscounts] = useState<MemberDiscount[]>([]);
  const [club, setClub] = useState<string | null>(null);
  const [assigned, setAssigned] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<MemberDiscount | null>(null);
  const [percentage, setPercentage] = useState("");
  const newVoiceDiscounts = useRef<Record<string, Record<string, string>>>({});
  const discountValues = (discount: MemberDiscount | null) => ({
    name: discount?.name ?? "",
    percentage: String((discount?.percentage_basis_points ?? 1000) / 100),
    valid_from: discount?.valid_from ?? "",
    valid_until: discount?.valid_until ?? "",
  });
  useVoiceToolPort(
    "admin.discount",
    {
      ready: () => isAdmin && !memberId && loaded && !error && !busy,
      baseline: () =>
        editing && newVoiceDiscounts.current[editing.id]
          ? newVoiceDiscounts.current[editing.id]
          : discountValues(discounts.find((discount) => discount.id === editing?.id) ?? null),
      snapshot: () => ({ ...discountValues(editing), percentage: editing ? percentage : "10" }),
      patch: (values) => {
        if (
          !isAdmin ||
          memberId ||
          busy ||
          !loaded ||
          error ||
          Object.keys(values).some(
            (key) => !["name", "percentage", "valid_from", "valid_until"].includes(key),
          )
        )
          throw Error("SNOOP_FORM_UNAVAILABLE");
        const from = values.valid_from ?? editing?.valid_from,
          until = values.valid_until ?? editing?.valid_until;
        if (from && until && from > until) throw Error("SNOOP_INVALID_DATES");
        const next = {
          ...(editing ?? {
            id: crypto.randomUUID(),
            name: "",
            percentage_basis_points: 1000,
            active: true,
            valid_from: null,
            valid_until: null,
          }),
          ...(values.name === undefined ? {} : { name: values.name }),
          ...(values.valid_from === undefined ? {} : { valid_from: values.valid_from || null }),
          ...(values.valid_until === undefined ? {} : { valid_until: values.valid_until || null }),
        };
        if (!editing)
          newVoiceDiscounts.current[next.id] = {
            ...discountValues(next),
            percentage: values.percentage ?? "10",
          };
        setEditing(next);
        if (values.percentage !== undefined) setPercentage(values.percentage);
        else if (!editing) setPercentage("10");
      },
    },
    `${memberId ?? "settings"}:${editing?.id ?? "new"}`,
  );
  useVoiceToolPort(
    "admin.member_discount",
    {
      ready: () => isAdmin && !!memberId && loaded && !error && !busy,
      baseline: () => ({
        discount_name: discounts.find((discount) => discount.id === assigned)?.name ?? "",
      }),
      snapshot: () => ({
        discount_name: discounts.find((discount) => discount.id === selected)?.name ?? "",
      }),
      patch: (values) => {
        if (
          !isAdmin ||
          !memberId ||
          busy ||
          !loaded ||
          error ||
          Object.keys(values).some((key) => key !== "discount_name")
        )
          throw Error("SNOOP_FORM_UNAVAILABLE");
        const matches = discounts.filter(
          (discount) =>
            discount.name.toLocaleLowerCase() === values.discount_name?.toLocaleLowerCase(),
        );
        if (matches.length !== 1 || !matches[0].active || discountStatus(matches[0]) === "Caducado")
          throw Error("SNOOP_UNKNOWN_DISCOUNT");
        setSelected(matches[0].id);
      },
    },
    memberId ?? "none",
  );

  useEffect(() => {
    let current = true;
    if (loading || !canRead) return;
    setLoaded(false);
    setDiscounts([]);
    setAssigned("");
    setSelected("");
    setClub(null);
    setError("");
    setEditing(null);
    (async () => {
      try {
        const id = await getCurrentClubId();
        if (!id) throw new Error("Sin club asignado");
        const result = await supabase
          .from("member_discounts" as any)
          .select("id,name,percentage_basis_points,active,valid_from,valid_until")
          .eq("club_id", id)
          .order("name");
        if (result.error) throw result.error;
        let assignment = "";
        if (memberId) {
          const res = await supabase
            .from("member_discount_assignments" as any)
            .select("discount_id")
            .eq("club_id", id)
            .eq("member_id", memberId)
            .maybeSingle();
          if (res.error) throw res.error;
          assignment = (res.data as any)?.discount_id ?? "";
        }
        if (current) {
          setClub(id);
          setDiscounts(result.data as any);
          setAssigned(assignment);
          setSelected(assignment);
          setLoaded(true);
        }
      } catch (e: any) {
        if (current)
          setError(
            discountUnavailable(e)
              ? "Descuentos pendientes de activación en la base de datos."
              : "No se pudieron cargar los descuentos. Vuelve a abrir la ficha para reintentar.",
          );
      }
    })();
    return () => {
      current = false;
    };
  }, [memberId, user?.id, loading, access.clubId, canRead]);
  async function save() {
    if (!club || !editing || busy) return;
    const points = parseDiscountPercentage(percentage);
    if (
      points === null ||
      !editing.name.trim() ||
      (editing.valid_from && editing.valid_until && editing.valid_from > editing.valid_until)
    )
      return toast.error("Comprueba nombre, porcentaje (0,01–100) y fechas.");
    setBusy(true);
    try {
      const payload = {
        id: editing.id,
        club_id: club,
        name: editing.name.trim(),
        percentage_basis_points: points,
        active: editing.active,
        valid_from: editing.valid_from || null,
        valid_until: editing.valid_until || null,
      };
      const query = supabase.from("member_discounts" as any).upsert(payload, { onConflict: "id" });
      const result = await query
        .select("id,name,percentage_basis_points,active,valid_from,valid_until")
        .single();
      if (result.error || !result.data) throw result.error;
      const row = result.data as unknown as MemberDiscount;
      setDiscounts((rows) => [...rows.filter((r) => r.id !== row.id), row]);
      setEditing(null);
      toast.success("Descuento guardado");
    } catch {
      toast.error("No se pudo guardar el descuento. Se conserva el formulario.");
    } finally {
      setBusy(false);
    }
  }
  async function assign() {
    if (!club || !memberId || busy) return;
    setBusy(true);
    try {
      const result = selected
        ? await supabase
            .from("member_discount_assignments" as any)
            .upsert(
              { club_id: club, member_id: memberId, discount_id: selected },
              { onConflict: "member_id" },
            )
            .select("discount_id")
            .single()
        : await supabase
            .from("member_discount_assignments" as any)
            .delete()
            .eq("club_id", club)
            .eq("member_id", memberId);
      if (result.error) throw result.error;
      setAssigned(selected);
      toast.success("Asignación guardada");
    } catch {
      toast.error("No se pudo guardar la asignación");
    } finally {
      setBusy(false);
    }
  }
  if (!loading && !canRead) return null;
  const current = discounts.find((d) => d.id === assigned);
  return (
    <section className="mt-6 rounded-2xl border border-neon/20 bg-card/60 p-4 space-y-3">
      <h2 className="font-display text-lg">
        {memberId ? "Descuento del socio" : "Crear descuentos"}
      </h2>
      <p className="text-xs text-muted-foreground">
        Asignación informativa. No modifica cuotas ni aplica descuentos automáticamente.
      </p>
      {error ? (
        <p role="status" className="text-sm text-muted-foreground">
          {error}
        </p>
      ) : !loaded ? (
        <p role="status">Cargando descuentos…</p>
      ) : memberId ? (
        <>
          <p>
            {current
              ? `${current.name} · ${current.percentage_basis_points / 100}% · ${discountStatus(current)}`
              : "Sin descuento asignado"}
          </p>
          {isAdmin && (
            <div className="grid gap-3">
              <label className="relative block min-w-0">
                Descuento
                <select
                  aria-label="Descuento asignado"
                  className={`${inputClass} appearance-none pr-9 text-foreground [color-scheme:dark]`}
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Sin descuento</option>
                  {discounts.map((d) => (
                    <option
                      key={d.id}
                      value={d.id}
                      disabled={
                        d.id !== assigned && (!d.active || discountStatus(d) === "Caducado")
                      }
                    >
                      {d.name} · {d.percentage_basis_points / 100}% · {discountStatus(d)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 bottom-3 h-4 w-4 text-neon" />
              </label>
              <button
                disabled={busy || selected === assigned}
                onClick={assign}
                className="justify-self-end px-4 py-2 text-neon disabled:opacity-50"
              >
                Guardar asignación
              </button>
            </div>
          )}
        </>
      ) : (
        isAdmin && (
          <>
            {discounts.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-border py-3">
                <div className="flex-1 min-w-0">
                  <p>
                    {d.name} · {d.percentage_basis_points / 100}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {discountStatus(d)} · {d.valid_from || "Sin inicio"} —{" "}
                    {d.valid_until || "Sin fin"}
                  </p>
                </div>
                <button
                  className="text-neon text-sm"
                  onClick={() => {
                    setEditing({ ...d });
                    setPercentage(String(d.percentage_basis_points / 100));
                  }}
                >
                  Editar
                </button>
              </div>
            ))}
            {!editing && (
              <button
                className="w-full rounded-xl border border-dashed border-neon/30 py-3 text-neon"
                onClick={() => {
                  setEditing({
                    id: crypto.randomUUID(),
                    name: "",
                    percentage_basis_points: 1000,
                    active: true,
                    valid_from: null,
                    valid_until: null,
                  });
                  setPercentage("10");
                }}
              >
                Nuevo descuento
              </button>
            )}
            {editing && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <label className="block">
                  Nombre
                  <input
                    className={inputClass}
                    maxLength={100}
                    required
                    value={editing.name}
                    disabled={busy}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </label>
                <label className="block">
                  Porcentaje (%)
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    required
                    value={percentage}
                    disabled={busy}
                    onChange={(e) => setPercentage(e.target.value)}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    Válido desde
                    <input
                      type="date"
                      className={inputClass}
                      disabled={busy}
                      value={editing.valid_from || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, valid_from: e.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    Válido hasta
                    <input
                      type="date"
                      className={inputClass}
                      disabled={busy}
                      value={editing.valid_until || ""}
                      onChange={(e) =>
                        setEditing({ ...editing, valid_until: e.target.value || null })
                      }
                    />
                  </label>
                </div>
                <label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={editing.active}
                    disabled={busy}
                    onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                  />
                  Activo
                </label>
                <div className="flex gap-4">
                  <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                  <button
                    disabled={busy}
                    className="rounded-lg bg-gradient-neon text-primary-foreground px-4 py-2"
                  >
                    {busy ? "Guardando…" : "Guardar descuento"}
                  </button>
                </div>
              </form>
            )}
          </>
        )
      )}
    </section>
  );
}
