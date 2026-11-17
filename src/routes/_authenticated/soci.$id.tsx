import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Trash2, FileCheck, ShoppingBag, QrCode, Pencil, Save, X, Mail } from "lucide-react";
import { expiryBadge, formatPrice, signedUrl } from "@/lib/snoop";
import { useAuth } from "@/hooks/useAuth";
import QRCode from "qrcode";

export const Route = createFileRoute("/_authenticated/soci/$id")({
  component: SocioDetail,
});

type Plan = { id: string; name: string; duration_days: number; price_cents: number };
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
  const [qrUrl, setQrUrl] = useState<string>("");
  const [renewing, setRenewing] = useState(false);
  const [newPlanId, setNewPlanId] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Partial<Member>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [resendingQr, setResendingQr] = useState(false);

  async function resendQr() {
    if (!member) return;
    if (!member.email) return toast.error("Este socio no tiene email");
    setResendingQr(true);
    try {
      const { data: m2 } = await supabase.from("members").select("club_id").eq("id", member.id).maybeSingle();
      const { data: club } = await supabase.from("clubs").select("name").eq("id", (m2 as any)?.club_id ?? "").maybeSingle();
      const { sendMemberQrEmail } = await import("@/lib/member-qr");
      await sendMemberQrEmail({
        memberId: member.id,
        memberNumber: member.member_number,
        fullName: `${member.first_name} ${member.last_name}`.trim(),
        email: member.email,
        clubName: (club as any)?.name ?? "Club",
      });
      toast.success("QR reenviado por email");
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo reenviar");
    } finally {
      setResendingQr(false);
    }
  }

  async function saveEdit() {
    if (!member) return;
    setSavingEdit(true);
    const { error } = await supabase
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
      .eq("id", member.id);
    setSavingEdit(false);
    if (error) return toast.error(error.message);
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
      const { data: p } = await supabase.from("membership_plans").select("*").eq("id", (m as any).plan_id).maybeSingle();
      setPlan(p as any);
    }
    if ((m as any).dni_photo_path) setDniUrl(await signedUrl((m as any).dni_photo_path).catch(() => ""));
    if ((m as any).signature_path) setSigUrl(await signedUrl((m as any).signature_path).catch(() => ""));
    if ((m as any).member_number) {
      try {
        const url = await QRCode.toDataURL(`SNOOP:${(m as any).member_number}`, { margin: 1, width: 320, color: { dark: "#39FF14", light: "#00000000" } });
        setQrUrl(url);
      } catch {}
    }
  }
  useEffect(() => {
    load();
    supabase.from("membership_plans").select("*").eq("active", true).order("sort_order").then(({ data }) => setPlans((data as any) ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (location.pathname.endsWith("/pedido")) {
    return <Outlet />;
  }

  async function renew() {
    if (!newPlanId) return toast.error("Selecciona una cuota");
    setRenewing(true);
    try {
      const chosen = plans.find((p) => p.id === newPlanId)!;
      const today = new Date();
      const current = member ? new Date(member.expires_at) : today;
      const base = current > today ? current : today;
      const expires = new Date(base.getTime() + chosen.duration_days * 86400000);
      const { error } = await supabase.from("members").update({
        plan_id: chosen.id,
        expires_at: expires.toISOString().slice(0, 10),
      }).eq("id", id);
      if (error) throw error;
      toast.success("Cuota renovada");
      load();
    } catch (e: any) { toast.error(e.message); }
    finally { setRenewing(false); }
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
    function onAction(e: Event) {
      const action = (e as CustomEvent).detail?.action;
      if (action === "order") nuevoPedido();
      else if (action === "renew") renew();
      else if (action === "delete") remove();
    }
    window.addEventListener("snoop:member-action", onAction as EventListener);
    return () => window.removeEventListener("snoop:member-action", onAction as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, newPlanId, plans]);

  if (!member) {
    return <SnoopLayout title="Socio"><div className="text-muted-foreground">Cargando...</div></SnoopLayout>;
  }

  const badge = expiryBadge(member.expires_at);

  return (
    <SnoopLayout>
      <Link to="/soci/gestisci" className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon mb-6">
        <ArrowLeft className="w-4 h-4" /> Volver
      </Link>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Left: identity */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6 backdrop-blur">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Nº socio</div>
                <div className="font-display text-2xl text-neon tracking-[0.25em] mt-0.5">{member.member_number}</div>
                <h1 className="font-display text-3xl text-foreground mt-3">{member.first_name} {member.last_name}</h1>
                <div className="text-sm text-muted-foreground mt-1">{member.dni_number}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-full border ${badge.color}`}>{badge.label}</span>
                {!editing && (
                  <button
                    onClick={() => { setForm(member); setEditing(true); }}
                    className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest px-3 py-1.5 rounded-full border border-neon/40 text-neon hover:bg-neon/10"
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                )}
              </div>
            </div>

            {editing ? (
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
                <EditField label="Nombre" value={form.first_name ?? ""} onChange={(v) => setForm({ ...form, first_name: v })} />
                <EditField label="Apellido" value={form.last_name ?? ""} onChange={(v) => setForm({ ...form, last_name: v })} />
                <EditField label="DNI / NIE" value={form.dni_number ?? ""} onChange={(v) => setForm({ ...form, dni_number: v })} />
                <EditField label="F. nacimiento" type="date" value={form.birth_date ?? ""} onChange={(v) => setForm({ ...form, birth_date: v })} />
                <EditField label="Ciudad" value={form.city ?? ""} onChange={(v) => setForm({ ...form, city: v })} />
                <EditField label="Teléfono" value={form.phone ?? ""} onChange={(v) => setForm({ ...form, phone: v })} />
                <div className="md:col-span-2">
                  <EditField label="Email" type="email" value={form.email ?? ""} onChange={(v) => setForm({ ...form, email: v })} />
                </div>
                <div className="md:col-span-2 flex justify-end gap-2 mt-1">
                  <button onClick={() => setEditing(false)}
                    className="px-3 py-2 text-xs uppercase tracking-widest border border-border rounded-lg text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3 inline mr-1" /> Cancelar
                  </button>
                  <button onClick={saveEdit} disabled={savingEdit}
                    className="px-4 py-2 text-xs uppercase tracking-widest bg-gradient-neon text-primary-foreground rounded-lg font-semibold glow-neon disabled:opacity-50">
                    <Save className="w-3 h-3 inline mr-1" /> {savingEdit ? "Guardando…" : "Guardar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6 text-sm">
                <Stat label="F. nacimiento" value={member.birth_date} />
                <Stat label="Ciudad" value={member.city ?? "—"} />
                <Stat label="Teléfono" value={member.phone ?? "—"} />
                <Stat label="Email" value={member.email ?? "—"} />
                <Stat label="Alta" value={member.joined_at} />
                <Stat label="Caducidad" value={member.expires_at} />
                <Stat label="Cuota" value={plan ? `${plan.name} · ${formatPrice(plan.price_cents)}` : "—"} />
              </div>
            )}
          </div>


          {/* DNI */}
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-3">DNI</div>
            {dniUrl ? (
              <img src={dniUrl} alt="DNI" className="max-w-full rounded-lg border border-border" />
            ) : <div className="text-muted-foreground text-sm">Sin foto</div>}
          </div>

          {/* Contract */}
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <FileCheck className="w-4 h-4 text-neon" />
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Contrato firmado</div>
            </div>
            {member.contract_signed_at ? (
              <>
                <div className="text-xs text-muted-foreground mb-3">
                  Firmado el {new Date(member.contract_signed_at).toLocaleString("es-ES")} · versión {member.contract_version}
                </div>
                {sigUrl && <img src={sigUrl} alt="Firma" className="max-w-xs bg-black rounded-lg border border-border" />}
              </>
            ) : <div className="text-muted-foreground text-sm">Sin firma</div>}
          </div>
        </div>

        {/* Right: actions */}
        <div className="space-y-6">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6 flex flex-col items-center text-center">
            <div className="flex items-center gap-2 mb-3">
              <QrCode className="w-4 h-4 text-neon" />
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Carnet QR</div>
            </div>
            {qrUrl ? (
              <img src={qrUrl} alt={`QR socio ${member.member_number}`} className="w-44 h-44" />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center text-muted-foreground text-xs">Generando…</div>
            )}
            <div className="font-display text-neon tracking-[0.3em] mt-3">{member.member_number}</div>
            <p className="text-[10px] text-muted-foreground mt-1">Escanea el QR o dicta el número para abrir esta ficha.</p>
            <button
              type="button"
              onClick={resendQr}
              disabled={resendingQr || !member.email}
              className="mt-4 w-full flex items-center justify-center gap-2 border border-neon/40 text-neon py-2 rounded-lg text-[11px] uppercase tracking-widest hover:bg-neon/10 disabled:opacity-50"
              title={member.email ? "" : "Este socio no tiene email"}
            >
              <Mail className="w-3.5 h-3.5" /> {resendingQr ? "Enviando…" : "Reenviar QR por email"}
            </button>
          </div>

          <button
            onClick={nuevoPedido}
            className="w-full flex items-center justify-center gap-2 bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon"
          >
            <ShoppingBag className="w-4 h-4" /> Hacer pedido
          </button>

          <div className="bg-card/60 border border-neon/20 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <RefreshCw className="w-4 h-4 text-neon" />
              <div className="font-display text-sm">Renovar cuota</div>
            </div>
            <select value={newPlanId} onChange={(e) => setNewPlanId(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none">
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {formatPrice(p.price_cents)} ({p.duration_days} d)</option>
              ))}
            </select>
            <button onClick={renew} disabled={renewing}
              className="mt-3 w-full bg-gradient-neon text-primary-foreground py-2.5 rounded-lg font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50">
              {renewing ? "..." : "Renovar"}
            </button>
            <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
              La nueva caducidad se suma desde hoy o desde la fecha actual de caducidad si todavía es futura.
            </p>
          </div>

          {isAdmin && (
            <button onClick={remove}
              className="w-full flex items-center justify-center gap-2 border border-destructive/40 text-destructive py-2.5 rounded-lg text-xs uppercase tracking-widest hover:bg-destructive/10">
              <Trash2 className="w-4 h-4" /> Eliminar socio
            </button>
          )}
        </div>
      </div>
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

