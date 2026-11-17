import { createFileRoute, Link } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Upload, FileSpreadsheet, Loader2, Check, Download, ArrowLeft } from "lucide-react";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/soci/importar")({
  component: ImportarSocios,
});

type FieldKey =
  | "ignore"
  | "full_name"
  | "first_name"
  | "last_name"
  | "birth_date"
  | "dni_number"
  | "email"
  | "phone"
  | "city"
  | "address"
  | "postal_code";

const FIELD_OPTIONS: Array<{ key: FieldKey; label: string }> = [
  { key: "ignore", label: "— Ignorar —" },
  { key: "full_name", label: "Nombre completo" },
  { key: "first_name", label: "Nombre" },
  { key: "last_name", label: "Apellidos" },
  { key: "birth_date", label: "Fecha de nacimiento" },
  { key: "dni_number", label: "DNI / NIE" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Teléfono" },
  { key: "city", label: "Ciudad" },
  { key: "address", label: "Dirección" },
  { key: "postal_code", label: "Código postal" },
];

function guessMapping(header: string): FieldKey {
  const h = header.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/(nombre completo|full.?name|nome completo)/.test(h)) return "full_name";
  if (/(^nombre|first.?name|^nome$)/.test(h)) return "first_name";
  if (/(apellid|last.?name|cognom|surname)/.test(h)) return "last_name";
  if (/(nacim|birth|nascita|dob|fecha.*nac)/.test(h)) return "birth_date";
  if (/(dni|nie|documento|document)/.test(h)) return "dni_number";
  if (/(email|correo|e.?mail)/.test(h)) return "email";
  if (/(tel|phone|movil|cell)/.test(h)) return "phone";
  if (/(ciudad|city|citta|localidad)/.test(h)) return "city";
  if (/(direcc|address|via|calle)/.test(h)) return "address";
  if (/(cp|c\.p|postal|zip|codice postale)/.test(h)) return "postal_code";
  return "ignore";
}

function parseDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      return `${d.y.toString().padStart(4, "0")}-${d.m.toString().padStart(2, "0")}-${d.d.toString().padStart(2, "0")}`;
    }
  }
  const s = String(v).trim();
  // ISO yyyy-mm-dd
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  // dd/mm/yyyy or dd-mm-yyyy
  const eu = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (eu) {
    let y = eu[3];
    if (y.length === 2) y = (Number(y) > 30 ? "19" : "20") + y;
    return `${y}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`;
  }
  return null;
}

function cleanStr(v: any): string {
  if (v == null) return "";
  return String(v).trim();
}

type ParsedFile = {
  headers: string[];
  rows: Record<string, any>[];
};

type ImportResult = {
  ok: number;
  skipped: Array<{ row: number; reason: string; data: Record<string, any> }>;
};

function ImportarSocios() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, FieldKey>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: false });
      if (rows.length === 0) {
        toast.error("El archivo está vacío");
        return;
      }
      const headers = Object.keys(rows[0]);
      const map: Record<string, FieldKey> = {};
      for (const h of headers) map[h] = guessMapping(h);
      setParsed({ headers, rows });
      setMapping(map);
      setStep(2);
    } catch (e: any) {
      toast.error("No se pudo leer el archivo: " + e.message);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  async function runImport() {
    if (!parsed) return;
    const { getCurrentClubId } = await import("@/lib/club");
    const clubId = await getCurrentClubId();
    if (!clubId) {
      toast.error("Sin club asignado");
      return;
    }

    const usedFields = new Set(Object.values(mapping));
    const hasName =
      usedFields.has("full_name") || (usedFields.has("first_name") && usedFields.has("last_name"));
    if (!hasName) {
      toast.error("Mapea al menos 'Nombre completo' o 'Nombre' + 'Apellidos'");
      return;
    }
    if (!usedFields.has("dni_number")) {
      toast.error("Debes mapear la columna del DNI / NIE");
      return;
    }

    setBusy(true);
    setStep(3);
    const skipped: ImportResult["skipped"] = [];
    let ok = 0;
    const seenDni = new Set<string>();
    setProgress({ done: 0, total: parsed.rows.length });

    // Build rows to insert
    const toInsert: any[] = [];
    parsed.rows.forEach((row, idx) => {
      const rec: Record<string, string> = {};
      for (const [col, field] of Object.entries(mapping)) {
        if (field === "ignore") continue;
        const raw = row[col];
        if (field === "birth_date") {
          const d = parseDate(raw);
          if (d) rec.birth_date = d;
        } else {
          rec[field] = cleanStr(raw);
        }
      }
      // Handle full_name split
      if (rec.full_name && (!rec.first_name || !rec.last_name)) {
        const parts = rec.full_name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
          rec.first_name = rec.first_name || parts[0];
          rec.last_name = rec.last_name || parts.slice(1).join(" ");
        } else if (parts.length === 1) {
          rec.first_name = rec.first_name || parts[0];
          rec.last_name = rec.last_name || "-";
        }
      }
      delete rec.full_name;

      if (!rec.first_name || !rec.last_name) {
        skipped.push({ row: idx + 2, reason: "Falta nombre o apellidos", data: row });
        return;
      }
      const dni = (rec.dni_number || "").replace(/\s+/g, "").toUpperCase();
      if (!dni) {
        skipped.push({ row: idx + 2, reason: "Falta DNI / NIE", data: row });
        return;
      }
      if (seenDni.has(dni)) {
        skipped.push({ row: idx + 2, reason: "DNI duplicado en el archivo", data: row });
        return;
      }
      seenDni.add(dni);

      const today = new Date().toISOString().slice(0, 10);
      const expires = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

      toInsert.push({
        _row: idx + 2,
        _raw: row,
        payload: {
          club_id: clubId,
          first_name: rec.first_name.trim(),
          last_name: rec.last_name.trim(),
          birth_date: rec.birth_date || "1900-01-01",
          dni_number: dni,
          email: rec.email?.toLowerCase() || null,
          phone: rec.phone || null,
          city: rec.city || null,
          address: rec.address || null,
          postal_code: rec.postal_code || null,
          dni_photo_path: "",
          signature_path: "",
          contract_version: "",
          joined_at: today,
          expires_at: expires,
          imported_at: new Date().toISOString(),
        },
      });
    });

    // Insert in batches
    const BATCH = 25;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      // Try batch insert first
      const { error } = await supabase.from("members").insert(chunk.map((c) => c.payload));
      if (error) {
        // Fallback: one-by-one to capture per-row errors
        for (const c of chunk) {
          const { error: e2 } = await supabase.from("members").insert(c.payload);
          if (e2) {
            const reason = /duplicate|unique/i.test(e2.message)
              ? "DNI ya existe en la base de datos"
              : e2.message;
            skipped.push({ row: c._row, reason, data: c._raw });
          } else {
            ok++;
          }
          setProgress((p) => ({ ...p, done: p.done + 1 }));
        }
      } else {
        ok += chunk.length;
        setProgress((p) => ({ ...p, done: p.done + chunk.length }));
      }
    }

    setResult({ ok, skipped });
    setBusy(false);
    if (ok > 0) toast.success(`${ok} socios importados`);
    if (skipped.length > 0) toast.warning(`${skipped.length} filas saltadas`);
  }

  function downloadErrorLog() {
    if (!result) return;
    const lines = ["fila,motivo,datos"];
    for (const s of result.skipped) {
      lines.push(`${s.row},"${s.reason.replace(/"/g, '""')}","${JSON.stringify(s.data).replace(/"/g, '""')}"`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "socios-no-importados.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setStep(1);
    setParsed(null);
    setMapping({});
    setResult(null);
    setProgress({ done: 0, total: 0 });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <SnoopLayout title="Importar socios" subtitle="Sube un CSV o Excel exportado de tu gestor actual">
      <div className="max-w-4xl">
        <Link
          to="/soci"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-neon mb-6 uppercase tracking-widest"
        >
          <ArrowLeft className="w-3 h-3" /> Volver
        </Link>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-6 text-[10px] uppercase tracking-[0.25em]">
          {["Subir archivo", "Mapear columnas", "Importar"].map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`h-6 w-6 rounded-full flex items-center justify-center border ${
                    active
                      ? "border-neon text-neon glow-neon-soft"
                      : done
                        ? "border-neon/60 bg-neon/20 text-neon"
                        : "border-neon/20 text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="w-3 h-3" /> : n}
                </span>
                <span className={active ? "text-neon" : done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                {n < 3 && <span className="w-8 h-px bg-neon/20 mx-1" />}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="rounded-2xl border-2 border-dashed border-neon/30 bg-card/40 backdrop-blur p-10 md:p-16 text-center hover:border-neon/60 transition cursor-pointer"
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div className="w-16 h-16 mx-auto rounded-full border border-neon/40 flex items-center justify-center mb-4">
              <Upload className="w-7 h-7 text-neon" />
            </div>
            <div className="font-display text-xl text-foreground mb-2">Arrastra tu archivo aquí</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Exporta tus socios desde tu gestor actual en formato <strong className="text-foreground">CSV</strong> o{" "}
              <strong className="text-foreground">Excel (.xlsx)</strong> y suelta el archivo aquí.
            </p>
            <div className="mt-4 text-[10px] uppercase tracking-[0.3em] text-neon-dim">o pulsa para seleccionar</div>
          </div>
        )}

        {step === 2 && parsed && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-neon/25 bg-card/60 backdrop-blur p-4 md:p-6">
              <div className="flex items-center gap-3 mb-4">
                <FileSpreadsheet className="w-5 h-5 text-neon" />
                <div className="text-sm">
                  <strong className="text-foreground">{parsed.rows.length}</strong>{" "}
                  <span className="text-muted-foreground">filas detectadas</span>
                </div>
              </div>

              <div className="text-[11px] uppercase tracking-[0.25em] text-neon-dim mb-3">Anteprima (5 filas)</div>
              <div className="overflow-x-auto rounded-lg border border-neon/15">
                <table className="min-w-full text-xs">
                  <thead className="bg-card/80">
                    <tr>
                      {parsed.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 border-b border-neon/15 text-neon-dim uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-b border-neon/10">
                        {parsed.headers.map((h) => (
                          <td key={h} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] truncate">
                            {String(r[h] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-neon/25 bg-card/60 backdrop-blur p-4 md:p-6">
              <div className="text-[11px] uppercase tracking-[0.25em] text-neon-dim mb-4">Mapear columnas</div>
              <div className="grid md:grid-cols-2 gap-3">
                {parsed.headers.map((h) => (
                  <div key={h} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted-foreground uppercase tracking-widest">Columna</div>
                      <div className="text-sm text-foreground truncate">{h}</div>
                    </div>
                    <select
                      value={mapping[h]}
                      onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as FieldKey }))}
                      className="bg-input border border-neon/25 rounded-lg px-3 py-2 text-sm text-foreground focus:border-neon focus:outline-none"
                    >
                      {FIELD_OPTIONS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-[11px] text-muted-foreground">
                Obligatorio: <strong className="text-foreground">Nombre completo</strong> (o Nombre + Apellidos) y{" "}
                <strong className="text-foreground">DNI / NIE</strong>. Los duplicados se saltarán automáticamente.
              </div>
            </div>

            <div className="flex justify-between">
              <button
                onClick={reset}
                className="px-4 py-2 rounded-lg border border-neon/25 text-sm text-muted-foreground hover:text-neon hover:border-neon/60"
              >
                Cancelar
              </button>
              <button
                onClick={runImport}
                disabled={busy}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-neon text-primary-foreground font-display uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
              >
                Confirmar e importar
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="rounded-2xl border border-neon/25 bg-card/60 backdrop-blur p-6 md:p-8">
            {busy ? (
              <div className="flex flex-col items-center py-8">
                <Loader2 className="w-8 h-8 text-neon animate-spin mb-4" />
                <div className="text-sm text-foreground mb-2">
                  Importando {progress.done} / {progress.total}
                </div>
                <div className="w-full max-w-md h-2 rounded-full bg-neon/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-neon transition-all"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : result ? (
              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-neon/40 bg-neon/5 p-5">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Importados</div>
                    <div className="text-4xl font-display text-neon mt-2">{result.ok}</div>
                  </div>
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-5">
                    <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Saltados</div>
                    <div className="text-4xl font-display text-destructive mt-2">{result.skipped.length}</div>
                  </div>
                </div>

                {result.skipped.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-[11px] uppercase tracking-[0.25em] text-neon-dim">Filas no importadas</div>
                      <button
                        onClick={downloadErrorLog}
                        className="flex items-center gap-2 text-xs text-neon hover:underline"
                      >
                        <Download className="w-3 h-3" /> Descargar log CSV
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-neon/15 divide-y divide-neon/10">
                      {result.skipped.slice(0, 50).map((s, i) => (
                        <div key={i} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                          <span className="text-muted-foreground">Fila {s.row}</span>
                          <span className="text-destructive flex-1 truncate">{s.reason}</span>
                        </div>
                      ))}
                      {result.skipped.length > 50 && (
                        <div className="px-3 py-2 text-[11px] text-muted-foreground text-center">
                          … y {result.skipped.length - 50} más (descarga el log completo)
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={reset}
                    className="px-4 py-2 rounded-lg border border-neon/25 text-sm text-muted-foreground hover:text-neon hover:border-neon/60"
                  >
                    Importar otro archivo
                  </button>
                  <Link
                    to="/soci/gestisci"
                    className="px-5 py-2 rounded-lg bg-gradient-neon text-primary-foreground font-display uppercase tracking-[0.2em] text-xs glow-neon"
                  >
                    Ver socios
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </SnoopLayout>
  );
}
