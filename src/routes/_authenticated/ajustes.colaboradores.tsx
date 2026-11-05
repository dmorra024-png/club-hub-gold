import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import {
  listCollaborators,
  createCollaborator,
  updateCollaboratorPermissions,
  deleteCollaborator,
  requestCollaboratorPasswordReset,
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

type Perm = (typeof PERMS)[number]["key"];
type Collaborator = Awaited<ReturnType<typeof listCollaborators>>[number];

function ColaboradoresPage() {
  const { isAdmin, loading } = useAuth();
  const nav = useNavigate();
  const [list, setList] = useState<Collaborator[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [perms, setPerms] = useState<Perm[]>(["manage_members", "use_cash"]);
  const loadCollaborators = useServerFn(listCollaborators);
  const addCollaborator = useServerFn(createCollaborator);
  const savePermissions = useServerFn(updateCollaboratorPermissions);
  const removeCollaborator = useServerFn(deleteCollaborator);
  const sendPasswordReset = useServerFn(requestCollaboratorPasswordReset);

  useEffect(() => {
    if (!loading && !isAdmin) nav({ to: "/" });
  }, [loading, isAdmin, nav]);

  const refresh = useCallback(async () => {
    try {
      setList((await loadCollaborators()) ?? []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    }
  }, [loadCollaborators]);
  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin, refresh]);

  function togglePerm(p: Perm) {
    setPerms((arr) => (arr.includes(p) ? arr.filter((x) => x !== p) : [...arr, p]));
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const result = await addCollaborator({
        data: { email, full_name: fullName, permissions: perms },
      });
      setEmail("");
      setFullName("");
      setMsg(
        result.invited
          ? "Colaborador creado. Invitación enviada por email."
          : "Acceso añadido a la cuenta existente. Su contraseña no ha cambiado.",
      );
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    } finally {
      setBusy(false);
    }
  }

  async function onSavePerms(role_id: string, permissions: Perm[]) {
    setErr(null);
    setMsg(null);
    try {
      await savePermissions({ data: { role_id, permissions } });
      setMsg("Permisos actualizados");
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    }
  }

  async function onDelete(role_id: string) {
    if (
      !confirm(
        "¿Revocar el acceso de este colaborador a este club? Su cuenta y otros accesos se conservarán.",
      )
    )
      return;
    setErr(null);
    setMsg(null);
    try {
      await removeCollaborator({ data: { role_id } });
      setMsg("Acceso al club revocado");
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    }
  }

  async function onPasswordReset(role_id: string) {
    setErr(null);
    setMsg(null);
    try {
      await sendPasswordReset({ data: { role_id } });
      setMsg("Email de recuperación enviado. Solo el titular puede elegir su nueva contraseña.");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "No se ha podido completar la operación");
    }
  }

  if (loading || !isAdmin) {
    return (
      <SnoopLayout>
        <div className="p-8 text-muted-foreground">Cargando…</div>
      </SnoopLayout>
    );
  }

  return (
    <SnoopLayout
      title="Colaboradores"
      subtitle="Crea cuentas con permisos específicos para tu equipo"
    >
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

      <section className="bg-card/60 border border-neon/25 rounded-2xl p-6 max-w-2xl">
        <h3 className="font-display text-lg text-foreground">Crear colaborador</h3>
        <form onSubmit={onCreate} className="mt-4 grid gap-3">
          <Input label="Nombre completo" value={fullName} onChange={setFullName} required />
          <Input label="Email" type="email" value={email} onChange={setEmail} required />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-2">
              Permisos
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {PERMS.map((p) => (
                <label
                  key={p.key}
                  className="flex items-center gap-2 bg-input/60 border border-neon/15 rounded-md px-3 py-2 cursor-pointer hover:border-neon/40"
                >
                  <input
                    type="checkbox"
                    checked={perms.includes(p.key)}
                    onChange={() => togglePerm(p.key)}
                    className="accent-[#39ff14]"
                  />
                  <span className="text-sm text-foreground">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          <button
            disabled={busy || perms.length === 0}
            className="mt-2 flex items-center justify-center gap-2 px-4 py-2 rounded-md bg-neon text-background font-display uppercase tracking-widest text-xs hover:glow-neon-soft disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{" "}
            Crear acceso / invitar
          </button>
        </form>
      </section>

      <section className="mt-8">
        <h3 className="font-display text-sm tracking-[0.25em] uppercase text-neon-dim mb-3">
          Tu equipo ({list.length})
        </h3>
        <div className="grid gap-3">
          {list.map((row) => (
            <CollabRow
              key={row.id}
              row={row}
              onSave={onSavePerms}
              onDelete={onDelete}
              onPasswordReset={onPasswordReset}
            />
          ))}
          {list.length === 0 && (
            <div className="text-sm text-muted-foreground">Aún no hay colaboradores.</div>
          )}
        </div>
      </section>
    </SnoopLayout>
  );
}

function CollabRow({
  row,
  onSave,
  onDelete,
  onPasswordReset,
}: {
  row: Collaborator;
  onSave: (id: string, p: Perm[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPasswordReset: (id: string) => Promise<void>;
}) {
  const [perms, setPerms] = useState<Perm[]>(row.permissions ?? []);
  const [resetting, setResetting] = useState(false);
  const isAdminRow = row.role === "admin";
  const dirty =
    JSON.stringify([...(row.permissions ?? [])].sort()) !== JSON.stringify([...perms].sort());

  return (
    <div className="bg-card/40 border border-neon/15 rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-foreground font-display tracking-tight truncate">
            {row.full_name ?? row.email ?? "—"}
          </div>
          <div className="text-[11px] text-muted-foreground truncate">{row.email}</div>
          <div className="text-[10px] uppercase tracking-widest text-neon-dim mt-1">{row.role}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          {!isAdminRow && (
            <button
              type="button"
              disabled={resetting}
              onClick={async () => {
                if (!confirm("¿Enviar un enlace de recuperación al email del colaborador?")) return;
                setResetting(true);
                try {
                  await onPasswordReset(row.id);
                } finally {
                  setResetting(false);
                }
              }}
              className="p-2 rounded-md border border-neon/30 text-neon hover:bg-neon/10 disabled:opacity-50"
              title="Enviar recuperación por email"
              aria-label={`Enviar recuperación a ${row.full_name ?? row.email}`}
            >
              {resetting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <KeyRound className="w-4 h-4" />
              )}
            </button>
          )}
          {!isAdminRow && (
            <button
              onClick={() => onDelete(row.id)}
              className="p-2 rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10"
              title="Eliminar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!isAdminRow && (
        <>
          <div className="mt-3 grid sm:grid-cols-2 gap-2">
            {PERMS.map((p) => (
              <label key={p.key} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={perms.includes(p.key)}
                  onChange={() =>
                    setPerms((a) =>
                      a.includes(p.key) ? a.filter((x) => x !== p.key) : [...a, p.key],
                    )
                  }
                  className="accent-[#39ff14]"
                />
                {p.label}
              </label>
            ))}
          </div>
          {dirty && (
            <button
              onClick={() => onSave(row.id, perms)}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-neon/40 text-neon text-xs uppercase tracking-widest hover:bg-neon/10"
            >
              <Save className="w-3 h-3" /> Guardar permisos
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-1">{label}</div>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-neon/25 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-neon"
      />
    </label>
  );
}
