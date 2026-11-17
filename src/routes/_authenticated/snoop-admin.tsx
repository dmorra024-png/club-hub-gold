import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { listClubs, createClub, createClubAdmin } from "@/lib/platform.functions";
import { Plus, Building2, UserCog, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/snoop-admin")({
  component: SnoopAdmin,
});

function SnoopAdmin() {
  const { isSuperAdmin, loading } = useAuth();
  const nav = useNavigate();
  const [clubs, setClubs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // create club
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [city, setCity] = useState("");
  const [logoUrl, setLogoUrl] = useState("");

  // create admin
  const [adminClubId, setAdminClubId] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");

  useEffect(() => {
    if (!loading && !isSuperAdmin) nav({ to: "/" });
  }, [loading, isSuperAdmin, nav]);

  async function refresh() {
    try {
      const list = await listClubs();
      setClubs(list ?? []);
      if (!adminClubId && list?.length) setAdminClubId(list[0].id);
    } catch (e: any) { setErr(e.message); }
  }

  useEffect(() => { if (isSuperAdmin) refresh(); }, [isSuperAdmin]);

  async function onCreateClub(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setBusy(true);
    try {
      await createClub({ data: { name, slug: slug.toLowerCase(), city: city || undefined, logo_url: logoUrl || undefined } });
      setName(""); setSlug(""); setCity(""); setLogoUrl("");
      setMsg("Club creado");
      await refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function onCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setBusy(true);
    try {
      await createClubAdmin({ data: { club_id: adminClubId, email: adminEmail, full_name: adminName } });
      setAdminEmail(""); setAdminName("");
      setMsg("Administrador creado y email enviado");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (loading || !isSuperAdmin) {
    return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;
  }

  return (
    <SnoopLayout title="Snoop Admin" subtitle="Crea clubs y sus administradores">
      {err && <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{err}</div>}
      {msg && <div className="mb-4 rounded-md border border-neon/40 bg-neon/5 text-neon p-3 text-sm">{msg}</div>}

      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-card/60 border border-neon/25 rounded-2xl p-6">
          <h3 className="font-display text-lg text-foreground flex items-center gap-2"><Building2 className="w-4 h-4 text-neon" /> Crear club</h3>
          <form onSubmit={onCreateClub} className="mt-4 space-y-3">
            <Field label="Nombre" value={name} onChange={setName} required />
            <Field label="Slug (a-z, 0-9, -)" value={slug} onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))} required />
            <Field label="Ciudad" value={city} onChange={setCity} />
            <Field label="URL del logo" value={logoUrl} onChange={setLogoUrl} placeholder="https://..." />
            <button disabled={busy} className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear club
            </button>
          </form>
        </section>

        <section className="bg-card/60 border border-neon/25 rounded-2xl p-6">
          <h3 className="font-display text-lg text-foreground flex items-center gap-2"><UserCog className="w-4 h-4 text-neon" /> Crear administrador</h3>
          <form onSubmit={onCreateAdmin} className="mt-4 space-y-3">
            <label className="block">
              <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">Club</div>
              <select value={adminClubId} onChange={(e) => setAdminClubId(e.target.value)}
                className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground">
                {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <Field label="Nombre completo" value={adminName} onChange={setAdminName} required />
            <Field label="Email" value={adminEmail} onChange={setAdminEmail} type="email" required />
            <button disabled={busy || !adminClubId} className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear y enviar email
            </button>
          </form>
        </section>
      </div>

      <section className="mt-8">
        <h3 className="font-display text-sm tracking-[0.25em] uppercase text-neon-dim mb-3">Clubs ({clubs.length})</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {clubs.map((c) => (
            <div key={c.id} className="bg-card/40 border border-neon/15 rounded-xl p-4 flex items-center gap-3">
              {c.logo_url ? <img src={c.logo_url} alt="" className="w-10 h-10 object-contain rounded" /> : <div className="w-10 h-10 rounded bg-neon/10" />}
              <div className="flex-1 min-w-0">
                <div className="text-foreground font-display tracking-tight truncate">{c.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-neon-dim">{c.slug} {c.city ? `· ${c.city}` : ""}</div>
              </div>
            </div>
          ))}
          {clubs.length === 0 && <div className="text-sm text-muted-foreground">Aún no hay clubs.</div>}
        </div>
      </section>
    </SnoopLayout>
  );
}

function Field({ label, value, onChange, type = "text", required, placeholder }:
  { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">{label}</div>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-neon"
      />
    </label>
  );
}
