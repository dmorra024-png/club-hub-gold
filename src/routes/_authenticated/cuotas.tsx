import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { normalizeAdministrativeSearch, parseCashCents } from "@/lib/member-administration";
import {
  currentReceiptMonth,
  madridMidnight,
  PAYMENT_METHODS,
  receiptPeriod,
  type Receipt,
  type ReceiptSummary,
} from "@/lib/membership-receipts";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
export const Route = createFileRoute("/_authenticated/cuotas")({ component: MembershipReceipts });
const inputClass =
  "w-full bg-input border border-border rounded-md px-3 py-2 text-sm focus:border-neon outline-none";
const euros = (cents: number) =>
  (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
export function MembershipReceipts() {
  const { access, can, loading, isSuperAdmin } = useAuth();
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [selectedClub, setSelectedClub] = useState("");
  const clubId = isSuperAdmin ? selectedClub : access.clubId;
  const [members, setMembers] = useState<
    { id: string; member_number: string; first_name: string; last_name: string }[]
  >([]);
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [description, setDescription] = useState("Cuota asociativa");
  const initial = currentReceiptMonth();
  const [from, setFrom] = useState(initial.from);
  const [through, setThrough] = useState(initial.through);
  const [group, setGroup] = useState("day");
  const [page, setPage] = useState(0);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<Receipt[]>([]);
  const [summary, setSummary] = useState<ReceiptSummary[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef<{ payload: string; id: string } | null>(null);
  const busyRef = useRef(false);
  const allowed = can("use_cash") || can("view_reports");
  useEffect(() => {
    if (isSuperAdmin)
      supabase
        .from("clubs")
        .select("id,name")
        .order("name")
        .then(({ data, error }) => {
          if (error) setError(error.message);
          else setClubs(data ?? []);
        });
  }, [isSuperAdmin]);
  useEffect(() => {
    setMemberId("");
    setQuery("");
    setMembers([]);
    requestRef.current = null;
  }, [clubId]);
  useEffect(() => {
    if (!clubId || !can("use_cash")) return;
    const text = normalizeAdministrativeSearch(query);
    if (text.length < 2) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const escaped = query
        .trim()
        .replace(/[%_.,()\\]/g, "")
        .slice(0, 80);
      const { data, error } = await supabase
        .from("members")
        .select("id,member_number,first_name,last_name")
        .eq("club_id", clubId)
        .or(
          `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,member_number.ilike.%${escaped}%`,
        )
        .order("member_number")
        .limit(30);
      if (!cancelled) {
        if (error) setError("No se pudieron buscar los socios");
        else setMembers(data ?? []);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [clubId, query, access.permissions]);
  useEffect(() => {
    if (!clubId || !allowed) return;
    let cancelled = false;
    setPending(true);
    setError("");
    (async () => {
      try {
        const period = receiptPeriod(from, through);
        const [history, report] = await Promise.all([
          supabase
            .from("membership_receipts")
            .select("*", { count: "exact" })
            .eq("club_id", clubId)
            .gte("recorded_at", madridMidnight(period.from))
            .lt("recorded_at", madridMidnight(period.to))
            .order("recorded_at", { ascending: false })
            .order("id", { ascending: false })
            .range(page * 25, page * 25 + 24),
          supabase.rpc("membership_receipt_report", {
            p_club_id: clubId,
            p_from: period.from,
            p_to: period.to,
            p_group: group,
          }),
        ]);
        // History shares the same Madrid date bounds as the aggregate.
        if (history.error || report.error) throw new Error("No se pudieron cargar los ingresos");
        if (!cancelled) {
          setRows(history.data ?? []);
          setCount(history.count ?? 0);
          setSummary((report.data ?? []) as ReceiptSummary[]);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Error");
          setRows([]);
          setSummary([]);
        }
      } finally {
        if (!cancelled) setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId, allowed, from, through, group, page, revision]);
  async function save() {
    if (busyRef.current || !clubId || !navigator.onLine) return;
    const cents = parseCashCents(amount);
    const member = members.find((m) => m.id === memberId);
    if (
      !member ||
      cents === null ||
      cents <= 0 ||
      !description.trim() ||
      description.trim().length > 240
    )
      return toast.error("Revisa socio, importe y concepto");
    if (
      !confirm(
        `¿Confirmar ingreso de ${euros(cents)} para ${member.first_name} ${member.last_name} (${PAYMENT_METHODS[method as keyof typeof PAYMENT_METHODS]})?`,
      )
    )
      return;
    const payload = {
      p_club_id: clubId,
      p_member_id: memberId,
      p_amount_cents: cents,
      p_payment_method: method,
      p_description: description.trim(),
    };
    const serialized = JSON.stringify(payload);
    if (requestRef.current?.payload !== serialized)
      requestRef.current = { payload: serialized, id: crypto.randomUUID() };
    busyRef.current = true;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("record_membership_receipt", {
        ...payload,
        p_request_id: requestRef.current.id,
      });
      if (error) throw error;
      requestRef.current = null;
      setAmount("");
      setMemberId("");
      setQuery("");
      setPage(0);
      setRevision((r) => r + 1);
      toast.success("Ingreso registrado");
    } catch {
      toast.error(
        "No se pudo confirmar el ingreso. Reintenta con los mismos datos para evitar duplicados.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  if (loading) return <SnoopLayout title="Cuotas e ingresos">Cargando…</SnoopLayout>;
  if (!allowed)
    return (
      <SnoopLayout title="Cuotas e ingresos">
        <div role="alert">No tienes permiso para consultar los ingresos.</div>
      </SnoopLayout>
    );
  return (
    <SnoopLayout
      title="Cuotas e ingresos"
      subtitle="Registro independiente de cuotas asociativas · Europe/Madrid"
    >
      {isSuperAdmin && (
        <label className="block mb-4">
          Club
          <select
            aria-label="Club"
            disabled={busy}
            className={inputClass}
            value={selectedClub}
            onChange={(e) => {
              setSelectedClub(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Selecciona un club</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {clubId && (
        <>
          {can("use_cash") && (
            <section className="bg-card/60 border border-neon/25 rounded-2xl p-6 mb-6">
              <h2 className="font-display text-lg mb-4">Registrar cuota cobrada</h2>
              <fieldset disabled={busy} className="contents">
                <div className="grid sm:grid-cols-2 gap-4">
                  <label>
                    Buscar socio
                    <input
                      className={inputClass}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setMemberId("");
                      }}
                      placeholder="Nombre, apellido o número"
                    />
                  </label>
                  <label>
                    Socio
                    <select
                      aria-label="Socio"
                      className={inputClass}
                      value={memberId}
                      onChange={(e) => setMemberId(e.target.value)}
                    >
                      <option value="">Selecciona un socio</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          #{m.member_number} · {m.first_name} {m.last_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Importe (€)
                    <input
                      className={inputClass}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                  <label>
                    Método de pago
                    <select
                      aria-label="Método de pago"
                      className={inputClass}
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                    >
                      {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Concepto
                    <input
                      className={inputClass}
                      maxLength={240}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground my-3">
                  Confirma solo pagos recibidos. El registro conserva socio, operador y fecha; no
                  modifica ni renueva la inscripción.
                </p>
                <Button disabled={busy} onClick={save}>
                  Confirmar ingreso
                </Button>
              </fieldset>
            </section>
          )}
          <section className="bg-card/60 border border-neon/25 rounded-2xl p-6">
            <h2 className="font-display text-lg mb-4">Informes y operaciones</h2>
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <label>
                Desde
                <input
                  className={inputClass}
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label>
                Hasta
                <input
                  className={inputClass}
                  type="date"
                  value={through}
                  onChange={(e) => {
                    setThrough(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label>
                Agrupar
                <select
                  aria-label="Agrupar"
                  className={inputClass}
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option value="day">Diario</option>
                  <option value="month">Mensual</option>
                </select>
              </label>
            </div>
            <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
              Actualizar
            </Button>
            {error ? (
              <div role="alert" className="text-destructive my-4">
                {error}
              </div>
            ) : pending ? (
              <div role="status">Cargando…</div>
            ) : (
              <>
                <div className="my-4 font-display text-neon" data-testid="receipts-total">
                  Total: {euros(summary.reduce((sum, r) => sum + Number(r.total_cents), 0))}
                </div>
                <div className="grid gap-2 mb-6" data-testid="receipts-summary">
                  {summary.map((r) => (
                    <div
                      key={r.period + r.payment_method}
                      className="flex flex-wrap justify-between gap-2 border-b border-border py-2"
                    >
                      <span>
                        {r.period} ·{" "}
                        {PAYMENT_METHODS[r.payment_method as keyof typeof PAYMENT_METHODS]}
                      </span>
                      <span>
                        {r.receipts} operaciones · {euros(Number(r.total_cents))}
                      </span>
                    </div>
                  ))}
                </div>
                <h3 className="font-display mb-3">Histórico ({count})</h3>
                <div className="grid gap-3" data-testid="receipts-history">
                  {rows.map((r) => (
                    <article
                      key={r.id}
                      className="border border-neon/20 rounded-xl p-4 break-words"
                    >
                      <div className="flex flex-wrap justify-between gap-2">
                        <span>
                          {r.member_name} · #{r.member_number}
                        </span>
                        <strong className="text-neon">{euros(r.amount_cents)}</strong>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {new Date(r.recorded_at).toLocaleString("es-ES", {
                          timeZone: "Europe/Madrid",
                        })}{" "}
                        · {r.operator_name} ·{" "}
                        {PAYMENT_METHODS[r.payment_method as keyof typeof PAYMENT_METHODS]}
                      </div>
                      <div className="text-sm">{r.description}</div>
                      <div className="text-[10px] text-muted-foreground">{r.id}</div>
                    </article>
                  ))}
                </div>
                {!rows.length && <p>No hay operaciones en este periodo.</p>}
                <div className="flex gap-3 mt-4">
                  <Button
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="outline"
                    disabled={(page + 1) * 25 >= count}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </SnoopLayout>
  );
}
