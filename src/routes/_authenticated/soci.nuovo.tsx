import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Check, Loader2, Mic, ScanLine, Square, X } from "lucide-react";
import { CONTRACT_TEXT_ES, CONTRACT_VERSION, compressImage, formatPrice, uploadToSnoopDocs } from "@/lib/snoop";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { extractMemberFields, extractMemberFieldsFromImages, transcribeAudio } from "@/lib/voice-agent.functions";
import { defaultFieldConfig, mergeFieldConfig, type FieldConfigMap } from "@/lib/member-fields";

export const Route = createFileRoute("/_authenticated/soci/nuovo")({
  component: NewSocio,
});

type Plan = { id: string; name: string; duration_days: number; price_cents: number };

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanDictatedValue(value: string) {
  return value.replace(/^[:\-\s]+/, "").replace(/[,.\s]+$/g, "").trim();
}

function toTitle(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toDateInput(value: string) {
  const numeric = value.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/);
  if (numeric) {
    let [, d, m, y] = numeric;
    if (y.length === 2) y = (Number(y) > 30 ? "19" : "20") + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return "";
}

function quickParseMemberTranscript(text: string, plans: Plan[]) {
  const raw = text.replace(/[“”"']/g, " ").replace(/\s+/g, " ").trim();
  const labels: Array<["first_name" | "last_name" | "birth_date" | "dni_number" | "city" | "phone" | "email" | "plan_name", RegExp]> = [
    ["first_name", /\b(?:nombre|nome)\b\s*:?\s*/i],
    ["last_name", /\b(?:apellidos?|apellido|cognome|cognomi)\b\s*:?\s*/i],
    ["birth_date", /\b(?:fecha\s+de\s+nacimiento|nacimiento|data\s+di\s+nascita|nascita)\b\s*:?\s*/i],
    ["dni_number", /\b(?:numero\s+de\s+dni|numero\s+dni|dni|nie|documento)\b\s*:?\s*/i],
    ["city", /\b(?:ciudad|citta|residencia)\b\s*:?\s*/i],
    ["phone", /\b(?:telefono|teléfono|phone|movil|móvil|cellulare)\b\s*:?\s*/i],
    ["email", /\b(?:email|correo|e-?mail|mail)\b\s*:?\s*/i],
    ["plan_name", /\b(?:plan|cuota|quota|abono)\b\s*:?\s*/i],
  ];
  const hits = labels
    .map(([key, pattern]) => {
      const match = raw.match(pattern);
      return match?.index === undefined ? null : { key, start: match.index, valueStart: match.index + match[0].length };
    })
    .filter(Boolean)
    .sort((a, b) => a!.start - b!.start) as Array<{ key: string; start: number; valueStart: number }>;
  const out: Record<string, string> = {};
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const value = cleanDictatedValue(raw.slice(hit.valueStart, hits[i + 1]?.start ?? raw.length));
    if (!value) continue;
    if (["first_name", "last_name", "city"].includes(hit.key)) out[hit.key] = toTitle(value);
    if (hit.key === "birth_date") out.birth_date = toDateInput(value);
    if (hit.key === "dni_number") out.dni_number = value.replace(/[^0-9a-z]/gi, "").toUpperCase();
    if (hit.key === "phone") out.phone = value.replace(/(?!^\+)[^0-9]/g, "");
    if (hit.key === "email") out.email = value.replace(/\s+/g, "").toLowerCase();
    if (hit.key === "plan_name") out.plan_name = value;
  }
  const normalized = stripAccents(raw.toLowerCase());
  const plan = plans.find((p) => normalized.includes(stripAccents(p.name.toLowerCase())))
    ?? (/mensual|mensile/.test(normalized) ? plans.find((p) => stripAccents(p.name.toLowerCase()).includes("mens")) : undefined)
    ?? (/trimestral|trimestrale/.test(normalized) ? plans.find((p) => stripAccents(p.name.toLowerCase()).includes("trimes")) : undefined)
    ?? (/anual|annuale/.test(normalized) ? plans.find((p) => stripAccents(p.name.toLowerCase()).includes("anual") || stripAccents(p.name.toLowerCase()).includes("ann")) : undefined);
  if (plan) out.plan_id = plan.id;
  return out;
}

function pickMime(): string | null {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return null;
}
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function NewSocio() {
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const sigRef = useRef<SignaturePadHandle>(null);

  const [fieldCfg, setFieldCfg] = useState<FieldConfigMap>(defaultFieldConfig());

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    birth_date: "",
    address: "",
    city: "",
    postal_code: "",
    phone: "",
    email: "",
    plan_id: "",
    dni_number: "",
    dni_file: null as File | null,
    dni_preview: "" as string,
    contract_read: false,
  });

  // Voice
  const [recStatus, setRecStatus] = useState<"idle" | "recording" | "processing">("idle");
  const [lastHeard, setLastHeard] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const formRef = useRef(form);
  formRef.current = form;
  const transcribe = useServerFn(transcribeAudio);
  const extract = useServerFn(extractMemberFields);
  const extractFromImages = useServerFn(extractMemberFieldsFromImages);

  // Document scan (OCR of DNI / passport)
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning">("idle");
  const [scanPreviews, setScanPreviews] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("membership_plans").select("id,name,duration_days,price_cents").eq("active", true).order("sort_order")
      .then(({ data }) => setPlans((data as any) ?? []));
    (async () => {
      const { getCurrentClubId } = await import("@/lib/club");
      const clubId = await getCurrentClubId();
      if (!clubId) return;
      const { data } = await supabase
        .from("club_member_field_config")
        .select("field_key, visible, required")
        .eq("club_id", clubId);
      setFieldCfg(mergeFieldConfig((data as any) ?? []));
    })();
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  useEffect(() => {
    // Ensure the form is empty when opening the page: drop any leftover transcript
    // from a previous socio creation.
    try { window.localStorage.removeItem("snoop:new-member-transcript"); } catch {}
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "snoop:new-member-transcript" || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { text?: string };
        if (parsed.text) applyTranscriptToForm(parsed.text);
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [plans]);

  function set<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  const selectedPlan = plans.find((p) => p.id === form.plan_id);

  function normalizePlanName(value: string) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^cuota\s+/, "")
      .trim();
  }

  function findDictatedPlan(planName: string) {
    const wanted = normalizePlanName(planName);
    if (!wanted) return null;
    return plans.find((p) => {
      const name = normalizePlanName(p.name);
      return name === wanted || name.includes(wanted) || wanted.includes(name);
    }) ?? null;
  }

  async function applyTranscriptToForm(text: string) {
    setLastHeard(text);
    setRecStatus("processing");
    const quick = quickParseMemberTranscript(text, plans);
    setForm((f) => ({
      ...f,
      first_name: quick.first_name || f.first_name,
      last_name: quick.last_name || f.last_name,
      birth_date: quick.birth_date || f.birth_date,
      city: quick.city || f.city,
      phone: quick.phone || f.phone,
      email: quick.email || f.email,
      dni_number: quick.dni_number || f.dni_number,
      plan_id: quick.plan_id || f.plan_id,
    }));
    try {
      const current = formRef.current;
      const planForId = plans.find((p) => p.id === current.plan_id);
      const { fields } = await extract({
        data: {
          transcript: text,
          current: {
            first_name: current.first_name,
            last_name: current.last_name,
            birth_date: current.birth_date,
            city: current.city,
            phone: current.phone,
            email: current.email,
            dni_number: current.dni_number,
            plan_name: planForId?.name ?? "",
          },
          available_plans: plans.map((p) => p.name),
        },
      });
      const matchedPlan = fields.plan_name ? findDictatedPlan(fields.plan_name) : null;
      setForm((f) => ({
        ...f,
        first_name: fields.first_name || f.first_name,
        last_name: fields.last_name || f.last_name,
        birth_date: fields.birth_date || f.birth_date,
        city: fields.city || f.city,
        phone: fields.phone || f.phone,
        email: (fields as any).email || f.email,
        dni_number: fields.dni_number || f.dni_number,
        plan_id: matchedPlan?.id ?? f.plan_id,
      }));
      toast.success("Casillas rellenadas");
    } catch (e: any) {
      toast.error(e.message ?? "Error en dictado");
    } finally {
      setRecStatus("idle");
    }
  }

  async function handleDniFile(file: File) {
    try {
      const blob = await compressImage(file, 1600, 0.85);
      set("dni_file", new File([blob], "dni.jpg", { type: "image/jpeg" }));
      const reader = new FileReader();
      reader.onload = () => set("dni_preview", reader.result as string);
      reader.readAsDataURL(blob);
    } catch (e: any) {
      toast.error("Error procesando la imagen: " + e.message);
    }
  }

  // --- Document OCR: take up to 2 photos of the DNI / passport and auto-fill fields ---
  async function scanDocuments(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 2);
    if (list.length === 0) return;
    setScanStatus("scanning");
    try {
      // Compress + convert each file
      const compressed: Blob[] = [];
      for (const f of list) compressed.push(await compressImage(f, 1600, 0.85));

      // Preview URLs
      const previews = await Promise.all(
        compressed.map(
          (b) =>
            new Promise<string>((res) => {
              const r = new FileReader();
              r.onload = () => res(r.result as string);
              r.readAsDataURL(b);
            }),
        ),
      );
      setScanPreviews(previews);

      // Base64 payload for the AI Gateway
      const images = await Promise.all(
        compressed.map(async (b) => ({ base64: await blobToBase64(b), mimeType: "image/jpeg" })),
      );

      const { fields } = await extractFromImages({ data: { images } });

      setForm((f) => ({
        ...f,
        first_name: fields.first_name || f.first_name,
        last_name: fields.last_name || f.last_name,
        birth_date: fields.birth_date || f.birth_date,
        dni_number: (fields.dni_number || f.dni_number).toUpperCase(),
        address: fields.address || f.address,
        city: fields.city || f.city,
        postal_code: fields.postal_code || f.postal_code,
      }));

      // Reuse the front photo (first image) as the required DNI photo
      const front = compressed[0];
      set("dni_file", new File([front], "dni.jpg", { type: "image/jpeg" }));
      set("dni_preview", previews[0]);

      toast.success("Datos rellenados desde el documento");
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo leer el documento");
    } finally {
      setScanStatus("idle");
    }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      if (!mime) { stream.getTracks().forEach((t) => t.stop()); toast.error("Navegador no compatible."); return; }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        if (blob.size < 1500) { setRecStatus("idle"); toast.error("No te he oído, vuelve a intentar."); return; }
        setRecStatus("processing");
        try {
          const b64 = await blobToBase64(blob);
          const { text } = await transcribe({ data: { audioBase64: b64, mimeType: rec.mimeType } });
          if (!text) { setRecStatus("idle"); toast.error("No se entendió nada."); return; }
          await applyTranscriptToForm(text);
        } catch (e: any) {
          toast.error(e.message ?? "Error en dictado");
        } finally {
          setRecStatus("idle");
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecStatus("recording");
    } catch {
      toast.error("Permiso de micrófono denegado.");
    }
  }
  function stopRec() { recorderRef.current?.stop(); }
  function toggleMic() {
    if (recStatus === "recording") stopRec();
    else if (recStatus === "idle") startRec();
  }

  async function submit() {
    if (!form.first_name.trim() || !form.last_name.trim()) return toast.error("Falta nombre y apellido");
    const req = (k: keyof FieldConfigMap) => fieldCfg[k].visible && fieldCfg[k].required;
    const vis = (k: keyof FieldConfigMap) => fieldCfg[k].visible;
    if (req("birth_date")) {
      if (!form.birth_date) return toast.error("Falta la fecha de nacimiento");
      const age = (Date.now() - new Date(form.birth_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 18) return toast.error("El socio debe ser mayor de edad");
    }
    if (req("address") && !form.address.trim()) return toast.error("Falta la dirección");
    if (req("city") && !form.city.trim()) return toast.error("Falta la ciudad");
    if (req("postal_code") && !form.postal_code.trim()) return toast.error("Falta el código postal");
    if (req("phone") && !form.phone.trim()) return toast.error("Falta el teléfono");
    if (req("email") && !form.email.trim()) return toast.error("Falta el email");
    if (req("dni_number") && !form.dni_number.trim()) return toast.error("Falta el número de DNI");
    if (req("dni_photo") && !form.dni_file) return toast.error("Falta la foto del DNI");
    if (req("plan") && !form.plan_id) return toast.error("Selecciona una cuota");
    if (req("signature")) {
      if (!form.contract_read) return toast.error("Marca que has leído el contrato");
      if (sigRef.current?.isEmpty()) return toast.error("Falta la firma del socio");
    }

    setSaving(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const memberId = crypto.randomUUID();
      const dniPath = `members/${memberId}/dni.jpg`;
      const sigPath = `members/${memberId}/signature.png`;

      if (form.dni_file) await uploadToSnoopDocs(form.dni_file, dniPath);
      let sigUploaded = false;
      if (vis("signature") && !sigRef.current?.isEmpty()) {
        const sigBlob = await sigRef.current!.toBlob();
        if (sigBlob) { await uploadToSnoopDocs(sigBlob, sigPath); sigUploaded = true; }
      }

      const joined = new Date();
      const expires = selectedPlan ? new Date(joined.getTime() + selectedPlan.duration_days * 86400000) : null;

      const { getCurrentClubId } = await import("@/lib/club");
      const clubId = await getCurrentClubId();
      if (!clubId) throw new Error("No tienes un club asignado");
      const { error } = await supabase.from("members").insert({
        club_id: clubId,
        id: memberId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        birth_date: form.birth_date || "1900-01-01",
        address: form.address.trim() || null,
        city: form.city.trim(),
        postal_code: form.postal_code.trim() || null,
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        dni_number: form.dni_number.trim().toUpperCase(),
        dni_photo_path: form.dni_file ? dniPath : "",
        plan_id: form.plan_id || "",
        joined_at: joined.toISOString().slice(0, 10),
        expires_at: expires ? expires.toISOString().slice(0, 10) : joined.toISOString().slice(0, 10),
        signature_path: sigUploaded ? sigPath : "",
        contract_signed_at: sigUploaded ? new Date().toISOString() : null,
        contract_version: sigUploaded ? CONTRACT_VERSION : "",
        created_by: user.user?.id ?? null,
      });
      if (error) throw error;

      // Send the QR carnet by email if the socio provided one
      try {
        if (form.email.trim()) {
          const { data: created } = await supabase
            .from("members")
            .select("member_number")
            .eq("id", memberId)
            .maybeSingle();
          const { data: club } = await supabase
            .from("clubs")
            .select("name")
            .eq("id", clubId)
            .maybeSingle();
          const { sendMemberQrEmail } = await import("@/lib/member-qr");
          await sendMemberQrEmail({
            memberId,
            memberNumber: (created as any)?.member_number ?? "",
            fullName: `${form.first_name} ${form.last_name}`.trim(),
            email: form.email.trim(),
            clubName: (club as any)?.name ?? "Club",
          });
          toast.success("Socio creado — QR enviado por email");
        } else {
          toast.success("Socio creado (sin email: no se envió el QR)");
        }
      } catch (mailErr: any) {
        console.error("qr email failed", mailErr);
        toast.warning("Socio creado, pero el email del QR no se pudo enviar");
      }

      try { window.localStorage.removeItem("snoop:new-member-transcript"); } catch {}
      nav({ to: "/soci/gestisci" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SnoopLayout title="Nuevo socio" subtitle="Dicta los datos o rellénalos a mano">
      {/* Voice dictation bar */}
      <div className="max-w-3xl mb-6 rounded-2xl border border-neon/30 bg-card/70 backdrop-blur p-4 flex items-center gap-4">
        <button
          type="button"
          onClick={toggleMic}
          disabled={recStatus === "processing"}
          className={`h-14 w-14 shrink-0 rounded-full flex items-center justify-center transition
            ${recStatus === "recording" ? "bg-destructive text-destructive-foreground animate-pulse"
              : "bg-gradient-neon text-primary-foreground glow-neon"} disabled:opacity-60`}
          aria-label="Dictar datos"
        >
          {recStatus === "processing" ? <Loader2 className="w-5 h-5 animate-spin" />
            : recStatus === "recording" ? <Square className="w-5 h-5" />
            : <Mic className="w-6 h-6" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Dictado por voz</div>
          {recStatus === "recording" && <p className="text-sm text-destructive animate-pulse">● Escuchando… pulsa para parar</p>}
          {recStatus === "processing" && <p className="text-sm text-neon-dim">Procesando…</p>}
          {recStatus === "idle" && !lastHeard && (
            <p className="text-sm text-muted-foreground">Pulsa y di: "Nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan".</p>
          )}
          {recStatus === "idle" && lastHeard && (
            <p className="text-sm text-muted-foreground italic truncate">"{lastHeard}"</p>
          )}
        </div>
      </div>



      {/* Document scan (OCR): take 1-2 photos of the DNI, fields auto-fill */}
      <div className="max-w-3xl mb-6 rounded-2xl border border-neon/30 bg-card/70 backdrop-blur p-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 rounded-full flex items-center justify-center bg-gradient-neon text-primary-foreground glow-neon">
            {scanStatus === "scanning" ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanLine className="w-6 h-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Escanear documento</div>
            <p className="text-sm text-muted-foreground">
              Haz 1 o 2 fotos del DNI (frente y reverso) y se rellenarán los campos automáticamente.
            </p>
          </div>
          <label className="cursor-pointer shrink-0 text-[11px] uppercase tracking-widest px-4 py-2.5 rounded-full border border-neon/40 text-neon hover:bg-neon/10 flex items-center gap-2">
            <Camera className="w-4 h-4" />
            {scanStatus === "scanning" ? "Leyendo..." : scanPreviews.length ? "Volver a escanear" : "Escanear"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              disabled={scanStatus === "scanning"}
              onChange={(e) => {
                if (e.target.files && e.target.files.length) scanDocuments(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {scanPreviews.length > 0 && (
          <div className="mt-3 flex gap-2">
            {scanPreviews.map((src, i) => (
              <div key={i} className="relative">
                <img src={src} alt={`documento ${i + 1}`} className="h-20 rounded-md border border-neon/30 object-cover" />
                <button
                  type="button"
                  onClick={() => setScanPreviews((p) => p.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 bg-card border border-neon/40 rounded-full p-0.5 text-neon-dim hover:text-neon"
                  aria-label="Quitar"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-card/60 border border-neon/20 rounded-2xl p-6 md:p-8 max-w-3xl backdrop-blur space-y-8">

        {/* Datos personales */}
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Datos del socio</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="Nombre *" value={form.first_name} onChange={(v) => set("first_name", v)} />
            <Inp label="Apellidos *" value={form.last_name} onChange={(v) => set("last_name", v)} />
            {fieldCfg.birth_date.visible && (
              <Inp label={`Fecha de nacimiento${fieldCfg.birth_date.required ? " *" : ""}`} type="date" value={form.birth_date} onChange={(v) => set("birth_date", v)} />
            )}
            {fieldCfg.dni_number.visible && (
              <Inp label={`Número de DNI / NIE${fieldCfg.dni_number.required ? " *" : ""}`} value={form.dni_number} onChange={(v) => set("dni_number", v.toUpperCase())} placeholder="12345678A" />
            )}
            {fieldCfg.address.visible && (
              <Inp label={`Dirección${fieldCfg.address.required ? " *" : ""}`} value={form.address} onChange={(v) => set("address", v)} />
            )}
            {fieldCfg.city.visible && (
              <Inp label={`Ciudad${fieldCfg.city.required ? " *" : ""}`} value={form.city} onChange={(v) => set("city", v)} />
            )}
            {fieldCfg.postal_code.visible && (
              <Inp label={`Código postal${fieldCfg.postal_code.required ? " *" : ""}`} value={form.postal_code} onChange={(v) => set("postal_code", v)} />
            )}
            {fieldCfg.phone.visible && (
              <Inp label={`Teléfono${fieldCfg.phone.required ? " *" : ""}`} type="tel" value={form.phone} onChange={(v) => set("phone", v)} />
            )}
            {fieldCfg.email.visible && (
              <Inp label={`Email${fieldCfg.email.required ? " *" : ""}`} type="email" value={form.email} onChange={(v) => set("email", v)} placeholder="socio@email.com" />
            )}
          </div>
        </section>

        {/* Plan */}
        {fieldCfg.plan.visible && (
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Cuota{fieldCfg.plan.required ? " *" : ""}</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {plans.length === 0 && <div className="text-muted-foreground text-sm col-span-3">No hay cuotas. Pide al admin que las cree.</div>}
              {plans.map((p) => {
                const active = form.plan_id === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => set("plan_id", p.id)}
                    className={`text-left rounded-xl p-4 border transition ${active ? "border-neon bg-neon/10 glow-neon-soft" : "border-border bg-input hover:border-neon/50"}`}>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{p.duration_days} días</div>
                    <div className="font-display text-base mt-1">{p.name}</div>
                    <div className={`mt-2 font-display text-xl ${active ? "text-neon" : "text-foreground"}`}>{formatPrice(p.price_cents)}</div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* DNI photo */}
        {fieldCfg.dni_photo.visible && (
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Foto del DNI (frontal){fieldCfg.dni_photo.required ? " *" : ""}</h3>
            {form.dni_preview ? (
              <div className="relative inline-block">
                <img src={form.dni_preview} alt="DNI" className="max-w-full max-h-64 rounded-lg border border-neon/30" />
                <label className="absolute bottom-2 right-2 cursor-pointer bg-card/90 border border-neon/40 text-neon text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-md">
                  Cambiar
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])} />
                </label>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 h-44 rounded-lg border-2 border-dashed border-neon/30 hover:border-neon/60 hover:bg-neon/5 transition cursor-pointer">
                <Camera className="w-8 h-8 text-neon" />
                <div className="text-sm text-foreground font-display">Tomar foto / Subir imagen</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Se comprimirá automáticamente</div>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])} />
              </label>
            )}
          </section>
        )}

        {/* Contrato + firma (único paso separado) */}
        {fieldCfg.signature.visible && (
          <section className="border-t border-border pt-6">
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Contrato y firma — versión {CONTRACT_VERSION}</h3>
            <div
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10) set("contract_read", true);
              }}
              className="bg-input border border-border rounded-lg p-5 h-56 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
            >
              {CONTRACT_TEXT_ES}
            </div>
            <label className="flex items-start gap-3 text-sm mt-3">
              <input type="checkbox" checked={form.contract_read} onChange={(e) => set("contract_read", e.target.checked)} className="mt-1 accent-[oklch(0.86_0.28_145)]" />
              <span>He leído y acepto íntegramente las normas, el contrato y la política de protección de datos.</span>
            </label>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-2">Firma del socio</div>
              <SignaturePad ref={sigRef} height={220} />
            </div>
          </section>
        )}

        <div className="flex items-center justify-end pt-4 border-t border-border">
          <button type="button" disabled={saving} onClick={submit}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-neon text-primary-foreground font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Guardando..." : "Crear socio"}
          </button>
        </div>
      </div>
    </SnoopLayout>
  );
}

function Inp({ label, value, onChange, type = "text", placeholder, className = "" }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1.5">{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm focus:border-neon focus:ring-2 focus:ring-neon/20 outline-none transition" />
    </label>
  );
}
