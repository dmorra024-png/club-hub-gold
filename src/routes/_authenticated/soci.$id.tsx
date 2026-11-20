import { MemberDiscounts } from "@/components/MemberDiscounts";
import { AdministrativePaymentDialog } from "@/components/AdministrativePaymentDialog";
import { MemberOrderHistory } from "@/components/MemberOrderHistory";
import { WalletTopupPanel } from "@/components/WalletTopupPanel";
import { SocioClientLinkPanel } from "@/components/SocioClientLinkPanel";
import { madridToday, addCalendarDays, isAdult } from "@/lib/member-administration";
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  FileCheck,
  ShoppingBag,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { expiryBadge, formatPrice, signedUrl } from "@/lib/snoop";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/soci/$id")({
  component: SocioDetail,
});

type Plan = {
  id: string;
  name: string;
  duration_days: number;
  price_cents: number;
};
type Member = {
  id: string;
  member_number: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  city: string | null;
  phone: string | null;
  email: string | null;
  dni_number: string;
  dni_photo_path: string | null;
  signature_path: string | null;
  contract_signed_at: string | null;
  contract_version: string;
  joined_at: string;
  expires_at: string;
  plan_id: string | null;
};

function SocioDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { isAdmin } = useAuth();
  const [member, setMember] = useState<Member | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dniUrl, setDniUrl] = useState<string>("");
  const [sigUrl, setSigUrl] = useState<string>("");
  const renewalRequest = useRef<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [renewing, setRenewing] = useState(false);
  const renewingRef = useRef(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [newPlanId, setNewPlanId] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Member>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  async function saveEdit() {
    if (!member || savingEdit || !navigator.onLine) return;
    if (!form.first_name?.trim() || !form.last_name?.trim())
      return toast.error("Nombre y apellidos obligatorios");
    if (!form.dni_number?.trim()) return toast.error("Documento obligatorio");
    if (!form.birth_date || !isAdult(form.birth_date))
      return toast.error("Fecha de nacimiento no válida: el socio debe ser mayor de edad");
    if (form.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return toast.error("Email no válido");
    setSavingEdit(true);
    const { data, error } = await supabase
      .from("members")
      .update({
        first_name: form.first_name?.trim(),
        last_name: form.last_name?.trim(),
        birth_date: form.birth_date,
        dni_number: form.dni_number?.trim(),
        city: form.city?.trim() || null,
        phone: form.phone?.trim() || null,
        email: form.email?.trim() || null,
      })
      .eq("id", member.id)
      .select("id")
      .maybeSingle();
    setSavingEdit(false);
    if (error || !data)
      return toast.error(error?.message ?? "No tienes permiso para modificar este socio");
    toast.success("Datos actualizados");
    setEditing(false);
    load();
  }

  async function load() {
    const { data: m } = await supabase.from("members").select("*").eq("id", id).maybeSingle();
    if (!m) return;
    setMember(m as any);
    setNewPlanId((m as any).plan_id ?? "");
    if ((m as any).plan_id) {
      const { data: p } = await supabase
        .from("membership_plans")
        .select("*")
        .eq("id", (m as any).plan_id)
        .maybeSingle();
      setPlan(p as any);
    }
    if ((m as any).dni_photo_path)
      setDniUrl(await signedUrl((m as any).dni_photo_path).catch(() => ""));
    if ((m as any).signature_path)
      setSigUrl(await signedUrl((m as any).signature_path).catch(() => ""));
  }
  useEffect(() => {
    load();
    supabase
      .from("membership_plans")
      .select("*")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setPlans((data as any) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function renew(confirmedCents?: number) {
    if (renewingRef.current || !navigator.onLine) return;
    if (!newPlanId) return toast.error("Selecciona una cuota");
    const chosen = plans.find((p) => p.id === newPlanId);
    if (!chosen) return toast.error("Cuota no disponible");
    if (confirmedCents === undefined) {
      setPaymentOpen(true);
      return;
    }
    if (confirmedCents !== chosen.price_cents)
      return toast.error("La cuota ha cambiado. Revisa el importe.");
    renewingRef.current = true;
    setRenewing(true);
    try {
      renewalRequest.current ??= crypto.randomUUID();
      const { data: savedId, error } = await (supabase as any).rpc(
        "confirm_membership_with_receipt",
        {
          p_confirmed_cents: chosen.price_cents,
          p_member: { id },
          p_plan_id: chosen.id,
          p_method: paymentMethod,
          p_request: renewalRequest.current,
          p_renew: true,
          p_expected: member?.expires_at,
        },
      );
      if (error) throw error;
      if (savedId !== id)
        throw new Error(
          "No se pudo verificar la renovación. Consulta su estado antes de reintentar.",
        );
      renewalRequest.current = null;
      setPaymentOpen(false);
      toast.success("Cuota renovada y pago registrado");
      load();
      return true;
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      renewingRef.current = false;
      setRenewing(false);
    }
  }

  async function remove() {
    if (!confirm("¿Eliminar este socio? No se puede deshacer.")) return;
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Socio eliminado");
    nav({ to: "/soci/gestisci" });
  }

  function nuevoPedido() {
    nav({ to: "/soci/$id/pedido", params: { id } });
  }

  useEffect(() => {
    if (location.pathname.endsWith("/pedido")) return;
    function onAction(e: Event) {
      const action = (e as CustomEvent).detail?.action;
      if (action === "order") nuevoPedido();
      else if (action === "renew") renew();
      else if (action === "delete") remove();
    }
    window.addEventListener("snoop:member-action", onAction as EventListener);
    return () => window.removeEventListener("snoop:member-action", onAction as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, newPlanId, plans, paymentMethod, location.pathname]);

  if (location.pathname.endsWith("/pedido")) return <Outlet />;

  if (!member) {
    return (
      <SnoopLayout title="Socio">
        <div className="text-muted-foreground">Cargando...</div>
      </SnoopLayout>
    );
  }

  const badge = expiryBadge(member.expires_at);

  return (
    <SnoopLayout contentClassName="!pb-[calc(var(--snoop-nav-height,100px)+var(--snoop-safe-bottom,0px)+64px)]">
      <AdministrativePaymentDialog
        key={`${paymentOpen}:${newPlanId}:${paymentMethod}`}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        title="Confirmar renovación"
        totalCents={plans.find((p) => p.id === newPlanId)?.price_cents ?? 0}
        method={paymentMethod}
        busy={renewing}
        onConfirm={() => renew(plans.find((p) => p.id === newPlanId)?.price_cents ?? 0)}
      />
      <Link
        to="/soci/gestisci"
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>

      <div className="grid min-w-0 w-full max-w-full grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        {/* Left: identity */}
        <div className="min-w-0 w-full space-y-4 md:col-span-2 md:space-y-6">
          <div className="min-w-0 w-full max-w-full overflow-hidden bg-card/60 border border-neon/20 rounded-2xl p-4 sm:p-6 backdrop-blur">
            <div className="flex min-w-0 items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 max-w-full break-words">
                <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Nº socio</div>
                <div className="font-display text-2xl text-neon tracking-[0.25em] mt-0.5">
                  {member.member_number}
                </div>
                <h1 className="font-display text-2xl sm:text-3xl text-foreground mt-3 break-words">
                  {member.first_name} {member.last_name}
                </h1>
                <div className="text-sm text-muted-foreground mt-1">{member.dni_number}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={`text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border ${badge.color}`}
                >
                  {badge.label}
                </span>
                {!editing && (
                  <button
                    onClick={() => {
                      setForm(member);
                      setEditing(true);
                    }}
                    className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-neon/40 text-neon hover:bg-neon/10"
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                )}
              </div>
            </div>

            {editing ? (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                <EditField
                  label="Nombre"
                  value={form.first_name ?? ""}
                  onChange={(v) => setForm({ ...form, first_name: v })}
                />
                <EditField
                  label="Apellido"
                  value={form.last_name ?? ""}
                  onChange={(v) => setForm({ ...form, last_name: v })}
                />
                <EditField
                  label="DNI / NIE"
                  value={form.dni_number ?? ""}
                  onChange={(v) => setForm({ ...form, dni_number: v })}
                />
                <EditField
                  label="F. nacimiento"
                  type="date"
                  value={form.birth_date ?? ""}
                  onChange={(v) => setForm({ ...form, birth_date: v })}
                />
                <EditField
                  label="Ciudad"
                  value={form.city ?? ""}
                  onChange={(v) => setForm({ ...form, city: v })}
                />
                <EditField
                  label="Teléfono"
                  value={form.phone ?? ""}
                  onChange={(v) => setForm({ ...form, phone: v })}
                />
                <div className="md:col-span-2">
                  <EditField
                    label="Email"
                    type="email"
                    value={form.email ?? ""}
                    onChange={(v) => setForm({ ...form, email: v })}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end gap-2 mt-1">
                  <button
                    onClick={() => setEditing(false)}
                    className="px-3 py-2 text-xs uppercase tracking-widest border border-border rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3 h-3 inline mr-1" /> Cancelar
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={savingEdit}
                    className="px-4 py-2 text-xs uppercase tracking-widest bg-gradient-neon text-primary-foreground rounded-lg font-semibold glow-neon disabled:opacity-50"
                  >
                    <Save className="w-3 h-3 inline mr-1" /> {savingEdit ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-1 min-[390px]:grid-cols-2 md:grid-cols-3 gap-4 mt-6 text-sm">
                <Stat label="F. nacimiento" value={member.birth_date} />
                <Stat label="Ciudad" value={member.city ?? "—"} />
                <Stat label="Teléfono" value={member.phone ?? "—"} />
                <Stat label="Email" value={member.email ?? "—"} />
                <Stat label="Alta" value={member.joined_at} />
                <Stat label="Caducidad" value={member.expires_at} />
                <Stat
                  label="Cuota"
                  value={plan ? `${plan.name} · ${formatPrice(plan.price_cents)}` : "—"}
                />
              </div>
            )}
          </div>

          {/* DNI */}
          <div className="min-w-0 w-full max-w-full overflow-hidden bg-card/60 border border-neon/20 rounded-2xl p-4 sm:p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-3">DNI</div>
            {dniUrl ? (
              <img src={dniUrl} alt="DNI" className="block w-full max-w-full max-h-[260px] h-auto object-contain object-left rounded-lg border border-border bg-black/20" />
            ) : (
              <div className="text-muted-foreground text-sm">Sin foto</div>
            )}
          </div>

          {/* Contract */}
          <div className="min-w-0 w-full max-w-full overflow-hidden bg-card/60 border border-neon/20 rounded-2xl p-4 sm:p-6">
            <div className="flex min-w-0 items-center gap-2 mb-3">
              <FileCheck className="w-4 h-4 text-neon" />
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">
                Contrato firmado
              </div>
            </div>
            {member.contract_signed_at ? (
              <>
                <div className="text-xs text-muted-foreground mb-3 break-words">
                  Firmado el {new Date(member.contract_signed_at).toLocaleString("es-ES")} · versión{" "}
                  {member.contract_version}
                </div>
                {sigUrl && (
                  <img
                    src={sigUrl}
                    alt="Firma"
                    className="block w-full max-w-[320px] max-h-[160px] h-auto object-contain bg-black rounded-lg border border-border"
                  />
                )}
              </>
            ) : (
              <div className="text-muted-foreground text-sm">Sin firma</div>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="min-w-0 w-full space-y-4 md:space-y-6">
          <SocioClientLinkPanel memberId={id} />

          <button
            onClick={nuevoPedido}
            className="w-full min-w-0 min-h-11 flex items-center justify-center gap-2 bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon"
          >
            <ShoppingBag className="w-4 h-4" /> Hacer pedido
          </button>

          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-neon" />
              <div className="font-display text-sm">Renovar cuota</div>
            </div>
            <select
              value={newPlanId}
              disabled={renewing || renewalRequest.current !== null}
              onChange={(e) => {
                setNewPlanId(e.target.value);
                renewalRequest.current = null;
              }}
              className="w-full min-w-0 max-w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatPrice(p.price_cents)} ({p.duration_days} d)
                </option>
              ))}
            </select>
            <label className="block text-xs text-neon">
              Método de pago de renovación
              <select
                aria-label="Método de pago de renovación"
                value={paymentMethod}
                disabled={renewing || renewalRequest.current !== null}
                onChange={(e) => {
                  setPaymentMethod(e.target.value);
                  renewalRequest.current = null;
                }}
                className="w-full min-w-0 max-w-full bg-input border border-border rounded-md p-2"
              >
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
                <option value="other">Otro</option>
              </select>
            </label>
            <button
              onClick={() => renew()}
              disabled={renewing}
              className="mt-3 w-full min-h-11 bg-gradient-neon text-primary-foreground py-2.5 rounded-lg font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
            >
              {renewing ? "..." : "Renovar"}
            </button>
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              La nueva caducidad se suma desde hoy o desde la fecha actual de caducidad si todavía
              es futura.
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={remove}
              className="w-full flex items-center justify-center gap-2 border border-destructive/40 text-destructive py-2.5 rounded-lg text-xs uppercase tracking-widest hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" /> Eliminar socio
            </button>
          )}
        </div>
      </div>
      <MemberDiscounts memberId={id} />
      <WalletTopupPanel memberId={id} />
      <MemberOrderHistory memberId={id} />
    </SnoopLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</div>
      <div className="mt-1 text-foreground break-words">{value}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-neon outline-none"
      />
    </label>
  );
}
