import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PlatformLayout } from "@/components/PlatformLayout";
import { useAuth } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import { listClubs, createClub, createClubAdmin, updateClub } from "@/lib/platform.functions";
import { Plus, Building2, UserCog, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/snoop-admin")({
  component: SnoopAdmin,
});

function SnoopAdmin() {
  const { isSuperAdmin, loading } = useAuth();
  const nav = useNavigate();
  const [clubs, setClubs] = useState<Awaited<ReturnType<typeof listClubs>>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accountLink, setAccountLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const saveClub = useServerFn(updateClub);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editLogo, setEditLogo] = useState("");
  const [expires, setExpires] = useState("");
  const loadClubs = useServerFn(listClubs);
  const addClub = useServerFn(createClub);
  const addClubAdmin = useServerFn(createClubAdmin);

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

  const refresh = useCallback(async () => {
    try {
      const list = await loadClubs();
      setClubs(list ?? []);
      if (list?.length) setAdminClubId((current) => current || list[0].id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    }
  }, [loadClubs]);

  useEffect(() => {
    if (isSuperAdmin) refresh();
  }, [isSuperAdmin, refresh]);

  async function onCreateClub(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setAccountLink(null);
    setBusy(true);
    try {
      await addClub({
        data: {
          name,
          slug: slug.toLowerCase(),
          city: city || undefined,
          logo_url: logoUrl || undefined,
        },
      });
      setName("");
      setSlug("");
      setCity("");
      setLogoUrl("");
      setMsg("Club creado");
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setAccountLink(null);
    setBusy(true);
    try {
      const result = await addClubAdmin({
        data: { club_id: adminClubId, email: adminEmail, full_name: adminName },
      });
      setAdminEmail("");
      setAdminName("");
      setAccountLink(result.invitation_url ?? null);
      setMsg(
        result.invitation_url
          ? "Invitación preparada. Comparte el enlace de un solo uso únicamente con su titular."
          : result.invited
            ? "Administrador creado. Invitación enviada por email."
            : "Acceso de administrador añadido. La contraseña existente no ha cambiado.",
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    } finally {
      setBusy(false);
    }
  }

  async function changeClub(c: (typeof clubs)[number], suspend?: boolean) {
    if (
      suspend !== undefined &&
      !window.confirm(
        suspend ? "¿Suspender este club? Sus datos se conservarán." : "¿Reactivar este club?",
      )
    )
      return;
    setBusy(true);
    setErr(null);
    try {
      await saveClub({
        data: {
          id: c.id,
          name: suspend === undefined ? editName : c.name,
          city: suspend === undefined ? editCity || null : c.city,
          logo_url: suspend === undefined ? editLogo || null : c.logo_url,
          active: suspend === undefined ? c.active : !suspend,
          subscription_expires_at:
            suspend === undefined
              ? expires
                ? new Date(expires).toISOString()
                : null
              : c.subscription_expires_at,
        },
      });
      setEditing(null);
      await refresh();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "No se pudo actualizar el club");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !isSuperAdmin) {
    return (
      <PlatformLayout>
        <div className="p-8 text-muted-foreground">Cargando…</div>
      </PlatformLayout>
    );
  }

  return (
    <PlatformLayout>
      {accountLink && (
        <label className="block mb-4 text-sm text-neon">
          Enlace de un solo uso — solo para su titular
          <input
            aria-label="Enlace de un solo uso"
            readOnly
            value={accountLink}
            onFocus={(e) => e.target.select()}
            className="w-full bg-input border border-neon/30 rounded p-2 mt-2"
          />
        </label>
      )}
      {err && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">
          {err}
        </div>
      )}
      {msg && (
        <div className="mb-4 rounded-md border border-neon/40 bg-neon/5 text-neon p-3 text-sm">
          {msg}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-card/60 border border-neon/25 rounded-2xl p-6">
          <h3 className="font-display text-lg text-foreground flex items-center gap-2">
            <Building2 className="w-4 h-4 text-neon" /> Crear club
          </h3>
          <form onSubmit={onCreateClub} className="mt-4 space-y-3">
            <Field label="Nombre" value={name} onChange={setName} required />
            <Field
              label="Slug (a-z, 0-9, -)"
              value={slug}
              onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              required
            />
            <Field label="Ciudad" value={city} onChange={setCity} />
            <Field
              label="URL del logo"
              value={logoUrl}
              onChange={setLogoUrl}
              placeholder="https://..."
            />
            <button
              disabled={busy}
              className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{" "}
              Crear club
            </button>
          </form>
        </section>

        <section className="bg-card/60 border border-neon/25 rounded-2xl p-6">
          <h3 className="font-display text-lg text-foreground flex items-center gap-2">
            <UserCog className="w-4 h-4 text-neon" /> Crear administrador
          </h3>
          <form onSubmit={onCreateAdmin} className="mt-4 space-y-3">
            <label className="block">
              <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">Club</div>
              <select
                aria-label="Club"
                value={adminClubId}
                onChange={(e) => setAdminClubId(e.target.value)}
                className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground"
              >
                {clubs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Nombre completo" value={adminName} onChange={setAdminName} required />
            <Field
              label="Email"
              value={adminEmail}
              onChange={setAdminEmail}
              type="email"
              required
            />
            <button
              disabled={busy || !adminClubId}
              className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{" "}
              Crear acceso / invitar
            </button>
          </form>
        </section>
      </div>

      <section className="mt-8">
        <h3 className="font-display text-sm tracking-[0.25em] uppercase text-neon-dim mb-3">
          Clubs ({clubs.length})
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          {clubs.map((c) => (
            <div
              key={c.id}
              className="bg-card/40 border border-neon/15 rounded-xl p-4 flex flex-wrap items-center gap-3"
            >
              {c.logo_url ? (
                <img src={c.logo_url} alt="" className="w-10 h-10 object-contain rounded" />
              ) : (
                <div className="w-10 h-10 rounded bg-neon/10" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-foreground font-display tracking-tight truncate">{c.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-neon-dim">
                  {c.slug} {c.city ? `· ${c.city}` : ""}
                </div>
              </div>
              <div className="w-full text-sm text-neon" role="status">
                {!c.active
                  ? "Suspendido"
                  : c.subscription_expires_at && new Date(c.subscription_expires_at) <= new Date()
                    ? "Caducado"
                    : "Activo"}{" "}
                ·{" "}
                {c.subscription_expires_at
                  ? new Date(c.subscription_expires_at).toLocaleDateString("es-ES")
                  : "Sin vencimiento"}
              </div>
              <button
                disabled={busy}
                onClick={() => changeClub(c, c.active)}
                className="rounded border border-neon/30 p-2"
              >
                {c.active ? "Suspender club" : "Reactivar club"}
              </button>
              <button
                disabled={busy}
                className="rounded border border-neon/30 p-2"
                onClick={() => {
                  setEditing(c.id);
                  setEditName(c.name);
                  setEditCity(c.city ?? "");
                  setEditLogo(c.logo_url ?? "");
                  setExpires(c.subscription_expires_at?.slice(0, 10) ?? "");
                }}
              >
                Editar club y suscripción
              </button>
              {editing === c.id && (
                <form
                  className="w-full space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void changeClub(c);
                  }}
                >
                  <Field label="Nombre del club" value={editName} onChange={setEditName} required />
                  <Field label="Ciudad del club" value={editCity} onChange={setEditCity} />
                  <Field label="Logo del club" value={editLogo} onChange={setEditLogo} />
                  <Field
                    label="Fin de suscripción (vacío: sin vencimiento)"
                    value={expires}
                    onChange={setExpires}
                    type="date"
                  />
                  <button disabled={busy} className="rounded border border-neon/30 p-2">
                    Guardar cambios
                  </button>
                </form>
              )}
            </div>
          ))}
          {clubs.length === 0 && (
            <div className="text-sm text-muted-foreground">Aún no hay clubs.</div>
          )}
        </div>
      </section>
    </PlatformLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
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
