import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import {
  listCollaborators, createCollaborator, updateCollaboratorPermissions, deleteCollaborator,
  setCollaboratorPassword,
} from "@/lib/platform.functions";
import { Plus, Trash2, Save, Loader2, KeyRound } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ajustes/colaboradores")({
  head: () => ({
    meta: [
      { title: "Colaboradores | SNOOP" },
      { name: "description", content: "Gestión de colaboradores y acceso a SNOOP." },
      { property: "og:title", content: "Colaboradores | SNOOP" },
      { property: "og:description", content: "Gestión de colaboradores y acceso a SNOOP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ColaboradoresPage,
});

const PERMS = [
  { key: "manage_members", label: "Gestionar socios" },
  { key: "manage_products", label: "Gestionar productos / stock" },
  { key: "view_reports", label: "Ver informes" },
  { key: "use_cash", label: "Hacer pedidos / caja" },
  { key: "manage_collaborators", label: "Gestionar colaboradores" },
] as const;

type Perm = typeof PERMS[number]["key"];

function ColaboradoresPage() {
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  const [list, setList] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [perms, setPerms] = useState<Perm[]>(["manage_members", "use_cash"]);
  const changePassword = useServerFn(setCollaboratorPassword);

  useEffect(() => { if (!loading && !isAdmin) nav({ to: "/" }); }, [loading, isAdmin, nav]);

  async function refresh() {
    try { setList(await listCollaborators() ?? []); }
    catch (e: any) { setErr(e.message); }
  }
  useEffect(() => { if (isAdmin) refresh(); }, [isAdmin]);

  function togglePerm(p: Perm) {
    setPerms((arr) => arr.includes(p) ? arr.filter((x) => x !== p) : [...arr, p]);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setBusy(true);
    try {
      await createCollaborator({ data: { email, full_name: fullName, permissions: perms } });
      setEmail(""); setFullName("");
      setMsg("Colaborador creado y email enviado");
      await refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function onSavePerms(role_id: string, permissions: Perm[]) {
    setErr(null); setMsg(null);
    try {
      await updateCollaboratorPermissions({ data: { role_id, permissions } });
      setMsg("Permisos actualizados");
    } catch (e: any) { setErr(e.message); }
  }

  async function onDelete(role_id: string) {
    if (!confirm("¿Eliminar este colaborador? No podrá volver a entrar.")) return;
    setErr(null); setMsg(null);
    try {
      await deleteCollaborator({ data: { role_id } });
      setMsg("Colaborador eliminado");
      await refresh();
    } catch (e: any) { setErr(e.message); }
  }

  async function onSetPassword(role_id: string, password: string) {
    setErr(null); setMsg(null);
    try {
      await changePassword({ data: { role_id, password } });
      setMsg("Contraseña cambiada correctamente");
    } catch (e: any) { setErr(e.message); }
  }

  if (loading || !isAdmin) {
    return <SnoopLayout><div className="p-8 text-muted-foreground">Cargando…</div></SnoopLayout>;
  }

  return (
    <SnoopLayout title="Colaboradores" subtitle="Crea cuentas con permisos específicos para tu equipo">
      {err && <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 text-red-300 p-3 text-sm">{err}</div>}
      {msg && <div className="mb-4 rounded-md border border-neon/40 bg-neon/5 text-neon p-3 text-sm">{msg}</div>}

      <section className="bg-card/60 border border-neon/25 rounded-2xl p-6 max-w-2xl">
        <h3 className="font-display text-lg text-foreground">Crear colaborador</h3>
        <form onSubmit={onCreate} className="mt-4 grid gap-3">
          <Input label="Nombre completo" value={fullName} onChange={setFullName} required />
          <Input label="Email" type="email" value={email} onChange={setEmail} required />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-2">Permisos</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {PERMS.map((p) => (
                <label key={p.key} className="flex items-center gap-2 bg-input/60 border border-neon/15 rounded-md px-3 py-2 cursor-pointer hover:border-neon/40">
                  <input type="checkbox" checked={perms.includes(p.key)} onChange={() => togglePerm(p.key)} className="accent-[#39ff14]" />
                  <span className="text-sm text-foreground">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <button disabled={busy || perms.length === 0} className="mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear y enviar email
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h3 className="font-display text-sm tracking-[0.25em] uppercase text-neon-dim mb-3">Tu equipo ({list.length})</h3>
        <div className="grid gap-3">
          {list.map((row) => (
            <CollabRow key={row.id} row={row} onSave={onSavePerms} onDelete={onDelete} onSetPassword={onSetPassword} />
          ))}
          {list.length === 0 && <div className="text-sm text-muted-foreground">Aún no hay colaboradores.</div>}
        </div>
      </section>
    </SnoopLayout>
  );
}

function CollabRow({ row, onSave, onDelete, onSetPassword }: { row: any; onSave: (id: string, p: Perm[]) => Promise<void>; onDelete: (id: string) => Promise<void>; onSetPassword: (id: string, password: string) => Promise<void> }) {
  const [perms, setPerms] = useState<Perm[]>(row.permissions ?? []);
  const [resetting, setResetting] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const isAdminRow = row.role === "admin";
  const dirty = JSON.stringify([...(row.permissions ?? [])].sort()) !== JSON.stringify([...perms].sort());

  return (
    <div className="bg-card/40 border border-neon/15 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-foreground font-display tracking-tight truncate">{row.full_name ?? row.email ?? "—"}</div>
          <div className="text-[11px] text-muted-foreground truncate">{row.email}</div>
          <div className="text-[10px] uppercase tracking-widest text-neon-dim mt-1">{row.role}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={resetting}
            onClick={() => { setPasswordOpen((open) => !open); setPassword(""); setPasswordConfirm(""); }}
            className="p-2 rounded-md border border-neon/30 text-neon hover:bg-neon/10 disabled:opacity-50"
            title="Cambiar contraseña"
            aria-label={`Cambiar contraseña de ${row.full_name ?? row.email}`}
          >
            {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          </button>
          {!isAdminRow && (
            <button onClick={() => onDelete(row.id)} className="p-2 rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10" title="Eliminar">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {passwordOpen && (
        <form
          className="mt-4 grid gap-3 border-t border-neon/15 pt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (password !== passwordConfirm) return;
            setResetting(true);
            try {
              await onSetPassword(row.id, password);
              setPasswordOpen(false);
              setPassword("");
              setPasswordConfirm("");
            } finally { setResetting(false); }
          }}
        >
          <div className="text-xs font-display uppercase tracking-widest text-neon">Nueva contraseña</div>
          <input
            required
            type="password"
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-neon"
          />
          <input
            required
            type="password"
            minLength={8}
            maxLength={72}
            autoComplete="new-password"
            placeholder="Repite la nueva contraseña"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-neon"
          />
          {passwordConfirm && password !== passwordConfirm && (
            <p className="text-xs text-destructive">Las contraseñas no coinciden.</p>
          )}
          <div className="flex gap-2">
            <button
              disabled={resetting || password.length < 8 || password !== passwordConfirm}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md bg-neon px-3 py-2 text-xs font-semibold uppercase tracking-widest text-background disabled:opacity-50"
            >
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Guardar contraseña
            </button>
            <button
              type="button"
              onClick={() => setPasswordOpen(false)}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {!isAdminRow && (
        <>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {PERMS.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={perms.includes(p.key)} onChange={() => setPerms((a) => a.includes(p.key) ? a.filter((x) => x !== p.key) : [...a, p.key])} className="accent-[#39ff14]" />
                {p.label}
              </label>
            ))}
          </div>
          {dirty && (
            <button onClick={() => onSave(row.id, perms)} className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-neon/40 text-neon text-xs uppercase tracking-widest hover:bg-neon/10">
              <Save className="w-3 h-3" /> Guardar permisos
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Input({ label, value, onChange, type = "text", required }:
  { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">{label}</div>
      <input type={type} value={value} required={required} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-neon" />
    </label>
  );
}
