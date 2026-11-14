import {
  memberConversation,
  memberAwaiting,
  memberQuestion,
  type ConversationState,
} from "@/lib/voice-conversation";
import { AdministrativePaymentDialog } from "@/components/AdministrativePaymentDialog";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Camera, Check, Loader2, Mic, ScanLine, Square, X } from "lucide-react";
import {
  CONTRACT_TEXT_ES,
  CONTRACT_VERSION,
  compressImage,
  formatPrice,
  uploadToSnoopDocs,
} from "@/lib/snoop";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  getAdministrativeAiStatus,
  extractMemberFields,
  extractMemberFieldsFromImages,
  transcribeAudio,
} from "@/lib/voice-agent.functions";
import {
  parseAdministrativeDictation,
  decodeMemberDraft,
  mergeUneditedValues,
  calendarDate,
  isAdult,
  madridToday,
  addCalendarDays,
} from "@/lib/member-administration";
import { useAuth } from "@/hooks/useAuth";
import { useWhisperDictation } from "@/hooks/useWhisperDictation";
import { scopedMemberDraft, voiceDraftSummary } from "@/lib/administrative-voice";
import { defaultFieldConfig, mergeFieldConfig, type FieldConfigMap } from "@/lib/member-fields";

export const Route = createFileRoute("/_authenticated/soci/nuovo")({
  component: NewSocio,
});

type Plan = {
  id: string;
  name: string;
  duration_days: number;
  price_cents: number;
};

function quickParseMemberTranscript(text: string, plans: Plan[]) {
  const fields = parseAdministrativeDictation(
    text,
    plans.map((p) => p.name),
  );
  return {
    ...fields,
    plan_id: plans.find((p) => p.name === fields.plan_name)?.id,
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function NewSocio() {
  const nav = useNavigate();
  const routeContext = Route.useRouteContext();
  const liveAuth = useAuth();
  const plansRef = useRef<Plan[]>([]);
  const [saving, setSaving] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [registrationError, setRegistrationError] = useState("");
  const failRegistration = (message: string) => {
    setRegistrationError(message);
    toast.error(message);
  };
  const registrationId = useRef(crypto.randomUUID());
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const savingRef = useRef(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  plansRef.current = plans;
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
  const [lastHeard, setLastHeard] = useState(""),
    [voiceSummary, setVoiceSummary] = useState("");
  const voiceMounted = useRef(true),
    plansReady = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;
  const voiceInitial = useRef(form);
  const conversation = useRef<ConversationState | null>(null);
  const aiStatus = useServerFn(getAdministrativeAiStatus);
  const transcribe = useServerFn(transcribeAudio);

  const extractFromImages = useServerFn(extractMemberFieldsFromImages);

  // Document scan (OCR of DNI / passport)
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning">("idle");
  const [scanPreviews, setScanPreviews] = useState<string[]>([]);

  useEffect(() => {
    voiceMounted.current = true;
    function applyPendingDraft(available: Plan[]) {
      if (!plansReady.current) return;
      const draft = scopedMemberDraft(window.sessionStorage.getItem("snoop:member-draft"), {
        userId: routeContext.user.id,
        clubId: routeContext.access.clubId ?? "",
      });
      window.sessionStorage.removeItem("snoop:member-draft");
      const planName = draft?.plan_name
        ? parseAdministrativeDictation(
            `cuota ${draft.plan_name}`,
            available.map((p) => p.name),
          ).plan_name
        : "";
      if (draft) {
        const { plan_name, ...patch } = draft;
        setForm((current) =>
          mergeUneditedValues(current, voiceInitial.current, {
            ...patch,
            plan_id: available.find((p) => p.name === planName)?.id ?? current.plan_id,
          }),
        );
        setVoiceSummary(
          voiceDraftSummary(draft) +
            (plan_name && !planName
              ? " · Cuota no identificada de forma única: selecciónala manualmente."
              : ""),
        );
      }
    }
    const onDraft = () => applyPendingDraft(plansRef.current);
    window.addEventListener("snoop:member-draft", onDraft);
    const resetConversation = () => {
      conversation.current = null;
    };
    const onConversation = (event: Event) => {
      const { text, language, respond } = (event as CustomEvent).detail;
      const current = formRef.current;
      const it = language === "it-IT";
      const state = conversation.current ?? memberAwaiting(current);
      if (text === null) {
        conversation.current = state;
        respond({ handled: true, message: memberQuestion(current, it) });
        return;
      }
      const reply = memberConversation(
        state,
        text,
        current,
        plansRef.current.map((p) => p.name),
        it,
      );
      if (!reply.handled) {
        respond(reply);
        return;
      }
      const { plan_name, ...patch } = reply.patch;
      const matchedPlan = plansRef.current.find((p) => p.name === plan_name);
      const changes = { ...patch, ...(matchedPlan ? { plan_id: matchedPlan.id } : {}) };
      setForm((previous) => {
        const next = { ...previous };
        for (const [key, value] of Object.entries(changes)) {
          const k = key as keyof typeof changes;
          if (previous[k] === current[k]) (next as Record<string, unknown>)[key] = value;
        }
        return next;
      });
      conversation.current = reply.state;
      setVoiceSummary(reply.summary ? reply.summary + " · " + reply.message : "");
      respond(reply);
    };
    const onAiForm = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.kind !== "member") return;
      const keys = ["first_name", "last_name", "birth_date", "city", "phone"] as const;
      const current = Object.fromEntries(keys.map((k) => [k, formRef.current[k]]));
      if (detail.patch)
        setForm((previous) => ({
          ...previous,
          ...Object.fromEntries(
            keys
              .filter((k) => typeof detail.patch[k] === "string")
              .map((k) => [k, detail.patch[k]]),
          ),
        }));
      detail.respond?.(current);
    };
    window.addEventListener("snoop:ai-form", onAiForm);
    window.addEventListener("snoop:member-conversation", onConversation);
    window.addEventListener("snoop:conversation-reset", resetConversation);

    const rememberInitial = () => {
      voiceInitial.current = { ...formRef.current };
    };
    window.addEventListener("snoop:microphone-owner", rememberInitial);
    supabase
      .from("membership_plans")
      .select("id,name,duration_days,price_cents")
      .eq("active", true)
      .eq("club_id", routeContext.access.clubId!)
      .order("sort_order")
      .then(({ data }) => {
        if (!voiceMounted.current) return;
        plansReady.current = true;
        const available = data ?? [];
        setPlans(available);
        applyPendingDraft(available);
      });
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
    return () => {
      window.removeEventListener("snoop:member-draft", onDraft);
      window.removeEventListener("snoop:ai-form", onAiForm);
      window.removeEventListener("snoop:member-conversation", onConversation);
      window.removeEventListener("snoop:conversation-reset", resetConversation);
      conversation.current = null;
      voiceMounted.current = false;
      window.removeEventListener("snoop:microphone-owner", rememberInitial);
    };
  }, []);

  useEffect(() => {
    // Ensure the form is empty when opening the page: drop any leftover transcript
    // from a previous socio creation.
    try {
      window.sessionStorage.removeItem("snoop:new-member-transcript");
    } catch {}
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

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
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
    return (
      plans.find((p) => {
        const name = normalizePlanName(p.name);
        return name === wanted || name.includes(wanted) || wanted.includes(name);
      }) ?? null
    );
  }

  async function applyTranscriptToForm(text: string) {
    if (
      !voiceMounted.current ||
      liveAuth.accessError ||
      !liveAuth.can("manage_members") ||
      liveAuth.user?.id !== routeContext.user.id ||
      liveAuth.access.clubId !== routeContext.access.clubId
    )
      return;
    setLastHeard(text);
    const fields = parseAdministrativeDictation(
      text,
      plansRef.current.map((p) => p.name),
    );
    const { plan_name, ...patch } = fields;
    const matchedPlan = plansRef.current.find((p) => p.name === plan_name);
    setForm((current) =>
      mergeUneditedValues(current, voiceInitial.current, {
        ...patch,
        plan_id: matchedPlan?.id ?? current.plan_id,
      }),
    );
    setVoiceSummary(
      voiceDraftSummary(fields) ||
        "No se identificaron campos. Di el nombre del campo y su valor. Nada guardado.",
    );
    if (!Object.keys(fields).length)
      toast.info("No se han cambiado los datos. Puedes completarlos manualmente.");
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
    const initial = { ...formRef.current };
    const status = await aiStatus();
    if (!status.documents)
      return toast.error(
        "Procesamiento de documentos no autorizado. Introduce los datos manualmente.",
      );
    if (!confirm("Las fotos del documento se enviarán al proveedor de IA configurado. ¿Continuar?"))
      return;
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
        compressed.map(async (b) => ({
          base64: await blobToBase64(b),
          mimeType: "image/jpeg",
        })),
      );

      const { fields } = await extractFromImages({ data: { images } });

      setForm((f) =>
        mergeUneditedValues(f, initial, {
          first_name: fields.first_name || f.first_name,
          last_name: fields.last_name || f.last_name,
          birth_date: fields.birth_date || f.birth_date,
          dni_number: (fields.dni_number || f.dni_number).toUpperCase(),
          address: fields.address || f.address,
          city: fields.city || f.city,
          postal_code: fields.postal_code || f.postal_code,
        }),
      );

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

  const voice = useWhisperDictation({
    scope: `${liveAuth.user?.id}:${liveAuth.access.clubId}:${liveAuth.access.role}:${liveAuth.access.status}:${liveAuth.access.permissions.join(",")}:member-form`,
    language: "es",
    getLanguage: () =>
      (window.localStorage.getItem("snoop:voice-language") || navigator.language).startsWith("it")
        ? "it"
        : "es",
    available: async () => {
      if (liveAuth.accessError || !liveAuth.can("manage_members")) return { available: false };
      return aiStatus();
    },
    transcribe: (data) => transcribe({ data }),
    onTranscript: applyTranscriptToForm,
  });
  const recStatus = voice.phase === "starting" ? "processing" : voice.phase;
  function toggleMic() {
    if (recStatus === "recording") voice.finish();
    else if (recStatus === "idle") {
      voiceInitial.current = { ...formRef.current };
      void voice.start();
    }
  }

  async function submit(confirmedCents?: number) {
    setRegistrationError("");
    if (savingRef.current || !navigator.onLine)
      return failRegistration("Espera a que termine el envío y comprueba la conexión.");
    if (!form.first_name.trim() || !form.last_name.trim())
      return failRegistration("Falta nombre y apellido");
    const req = (k: keyof FieldConfigMap) => fieldCfg[k].visible && fieldCfg[k].required;
    const vis = (k: keyof FieldConfigMap) => fieldCfg[k].visible;
    if (req("birth_date")) {
      if (!form.birth_date) return failRegistration("Falta la fecha de nacimiento");
      if (!calendarDate(form.birth_date)) return failRegistration("Fecha de nacimiento no válida");
      if (!isAdult(form.birth_date)) return failRegistration("El socio debe ser mayor de edad");
    }
    if (req("address") && !form.address.trim()) return failRegistration("Falta la dirección");
    if (req("city") && !form.city.trim()) return failRegistration("Falta la ciudad");
    if (req("postal_code") && !form.postal_code.trim())
      return failRegistration("Falta el código postal");
    if (req("phone") && !form.phone.trim()) return failRegistration("Falta el teléfono");
    if (req("email") && !form.email.trim()) return failRegistration("Falta el email");
    if (req("dni_number") && !form.dni_number.trim()) return failRegistration("Falta el número de DNI");
    if (req("dni_photo") && !form.dni_file) return failRegistration("Falta la foto del DNI");
    if (req("plan") && !form.plan_id) return failRegistration("Selecciona una cuota");
    if (req("signature")) {
      if (!form.contract_read) return failRegistration("Marca que has leído el contrato");
      if (sigRef.current?.isEmpty()) return failRegistration("Falta la firma del socio");
    }

    const due = selectedPlan?.price_cents ?? 0;
    if (due > 0 && confirmedCents === undefined) {
      setPaymentOpen(true);
      return;
    }
    if (confirmedCents !== undefined && confirmedCents !== due)
      return failRegistration("La cuota ha cambiado. Revisa el importe.");
    savingRef.current = true;
    setSaving(true);
    try {
      const { data: user, error: authError } = await supabase.auth.getUser();
      if (authError || !user.user) throw new Error("Inicia sesión antes de guardar");
      const { getCurrentClubId } = await import("@/lib/club");
      const clubId = await getCurrentClubId();
      if (!clubId) throw new Error("No tienes un club asignado");
      const memberId = registrationId.current;
      const dniPath = `clubs/${clubId}/members/${memberId}/dni.jpg`;
      const sigPath = `clubs/${clubId}/members/${memberId}/signature.png`;

      if (form.dni_file) await uploadToSnoopDocs(form.dni_file, dniPath);
      let sigUploaded = false;
      if (vis("signature") && !sigRef.current?.isEmpty()) {
        const sigBlob = await sigRef.current!.toBlob();
        if (!sigBlob || sigBlob.size === 0) throw new Error("No se pudo guardar la firma. Inténtalo de nuevo antes de crear el socio.");
        await uploadToSnoopDocs(sigBlob, sigPath);
        sigUploaded = true;
      }

      const joined = madridToday();
      const expires = selectedPlan ? addCalendarDays(joined, selectedPlan.duration_days) : joined;

      const { data: savedId, error } = await (supabase as any).rpc(
        form.plan_id ? "confirm_membership_with_receipt" : "save_membership_with_receipt",
        {
          ...(form.plan_id ? { p_confirmed_cents: due, p_expected: null } : {}),
          p_plan_id: form.plan_id || null,
          p_method: paymentMethod,
          p_request: memberId,
          p_renew: false,
          p_member: {
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
            plan_id: form.plan_id || null,
            joined_at: joined,
            expires_at: expires,
            signature_path: sigUploaded ? sigPath : "",
            contract_signed_at: sigUploaded ? new Date().toISOString() : null,
            contract_version: sigUploaded ? CONTRACT_VERSION : "",
            created_by: user.user?.id ?? null,
          },
        },
      );
      if (error) throw error;
      if (savedId !== memberId)
        throw new Error(
          "No se pudo verificar la inscripción. Consulta su estado antes de reintentar.",
        );

      setPaymentOpen(false);
      registrationId.current = crypto.randomUUID();
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
          const mail = await sendMemberQrEmail({
            memberId,
            memberNumber: (created as any)?.member_number ?? "",
            fullName: `${form.first_name} ${form.last_name}`.trim(),
            email: form.email.trim(),
            clubName: (club as any)?.name ?? "Club",
          });
          const { memberMailLabel } = await import("@/lib/member-mail-state");
          toast.success("Socio creado — " + memberMailLabel(mail.status));
        } else {
          toast.success("Socio creado (sin email: no se envió el QR)");
        }
      } catch (mailErr: any) {
        console.error("qr email failed", mailErr);
        toast.warning("Socio creado, pero el email del QR no se pudo enviar");
      }

      try {
        window.sessionStorage.removeItem("snoop:new-member-transcript");
      } catch {}
      nav({ to: "/soci/gestisci" });
      return true;
    } catch (e: any) {
      failRegistration(e?.message || "Error al registrar el socio. No repitas el pago sin comprobar el estado.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SnoopLayout title="Nuevo socio" subtitle="Dicta los datos o rellénalos a mano">
      <AdministrativePaymentDialog
        key={`${paymentOpen}:${form.plan_id}:${paymentMethod}`}
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        title="Confirmar inscripción"
        totalCents={selectedPlan?.price_cents ?? 0}
        method={paymentMethod}
        busy={saving}
        error={registrationError}
        onConfirm={() => submit(selectedPlan?.price_cents ?? 0)}
      />
      {registrationError && (
        <section role="alert" aria-live="assertive" className="max-w-3xl mb-5 rounded-lg border border-destructive/60 bg-destructive/10 p-4 text-sm text-destructive break-words" style={{ overflowWrap: "anywhere" }}>
          <strong>Error al registrar el socio</strong>
          <p className="mt-1">{registrationError}</p>
        </section>
      )}
      {(voiceSummary || voice.error) && (
        <section
          className="max-w-3xl mb-6 rounded-lg border border-neon/30 p-3"
          aria-label="Resumen del dictado"
        >
          <p role={voice.error ? "alert" : "status"}>{voice.error || voiceSummary}</p>
          <p className="text-sm mt-2">
            Audio a Cloudflare Whisper; campos interpretados localmente. Revisa el formulario y
            pulsa Crear socio para guardar.
          </p>
        </section>
      )}

      {(recStatus === "recording" || recStatus === "processing") && (
        <button
          type="button"
          className="mb-4 text-sm underline text-neon"
          onClick={() => voice.cancel()}
        >
          Cancelar dictado
        </button>
      )}

      {/* Document scan (OCR): take 1-2 photos of the DNI, fields auto-fill */}
      <div className="max-w-3xl mb-6 rounded-2xl border border-neon/30 bg-card/70 backdrop-blur p-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 rounded-full flex items-center justify-center bg-gradient-neon text-primary-foreground glow-neon">
            {scanStatus === "scanning" ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ScanLine className="w-6 h-6" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">
              Escanear documento
            </div>
            <p className="text-sm text-muted-foreground">
              Haz 1 o 2 fotos del DNI (frente y reverso) y se rellenarán los campos automáticamente.
            </p>
          </div>
          <label className="cursor-pointer shrink-0 text-[11px] uppercase tracking-widest px-4 py-2.5 rounded-full border border-neon/40 text-neon hover:bg-neon/10 flex items-center gap-2">
            <Camera className="w-4 h-4" />
            {scanStatus === "scanning"
              ? "Leyendo..."
              : scanPreviews.length
                ? "Volver a escanear"
                : "Escanear"}
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
                <img
                  src={src}
                  alt={`documento ${i + 1}`}
                  className="h-20 rounded-md border border-neon/30 object-cover"
                />
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

      <div
        data-snoop-member-form
        className="bg-card/60 border border-neon/20 rounded-2xl p-6 md:p-8 max-w-3xl backdrop-blur space-y-8"
      >
        {/* Datos personales */}
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">Datos del socio</h3>
          <div className="grid md:grid-cols-2 gap-4">
            <Inp label="Nombre *" value={form.first_name} onChange={(v) => set("first_name", v)} />
            <Inp label="Apellidos *" value={form.last_name} onChange={(v) => set("last_name", v)} />
            {fieldCfg.birth_date.visible && (
              <Inp
                label={`Fecha de nacimiento${fieldCfg.birth_date.required ? " *" : ""}`}
                type="date"
                value={form.birth_date}
                onChange={(v) => set("birth_date", v)}
              />
            )}
            {fieldCfg.dni_number.visible && (
              <Inp
                label={`Número de DNI / NIE${fieldCfg.dni_number.required ? " *" : ""}`}
                value={form.dni_number}
                onChange={(v) => set("dni_number", v.toUpperCase())}
                placeholder="12345678A"
              />
            )}
            {fieldCfg.address.visible && (
              <Inp
                label={`Dirección${fieldCfg.address.required ? " *" : ""}`}
                value={form.address}
                onChange={(v) => set("address", v)}
              />
            )}
            {fieldCfg.city.visible && (
              <Inp
                label={`Ciudad${fieldCfg.city.required ? " *" : ""}`}
                value={form.city}
                onChange={(v) => set("city", v)}
              />
            )}
            {fieldCfg.postal_code.visible && (
              <Inp
                label={`Código postal${fieldCfg.postal_code.required ? " *" : ""}`}
                value={form.postal_code}
                onChange={(v) => set("postal_code", v)}
              />
            )}
            {fieldCfg.phone.visible && (
              <Inp
                label={`Teléfono${fieldCfg.phone.required ? " *" : ""}`}
                type="tel"
                value={form.phone}
                onChange={(v) => set("phone", v)}
              />
            )}
            {fieldCfg.email.visible && (
              <Inp
                label={`Email${fieldCfg.email.required ? " *" : ""}`}
                type="email"
                value={form.email}
                onChange={(v) => set("email", v)}
                placeholder="socio@email.com"
              />
            )}
          </div>
        </section>

        {/* Plan */}
        {fieldCfg.plan.visible && (
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">
              Cuota{fieldCfg.plan.required ? " *" : ""}
            </h3>
            <div className="grid sm:grid-cols-3 gap-3">
              {plans.length === 0 && (
                <div className="text-muted-foreground text-sm col-span-3">
                  No hay cuotas. Pide al admin que las cree.
                </div>
              )}
              {plans.map((p) => {
                const active = form.plan_id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set("plan_id", p.id)}
                    aria-pressed={active}
                    className={`text-left rounded-xl p-4 border transition ${active ? "border-neon bg-neon/10 glow-neon-soft" : "border-border bg-input hover:border-neon/50"}`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                      {p.duration_days} días
                    </div>
                    <div className="font-display text-base mt-1">{p.name}</div>
                    <div
                      className={`mt-2 font-display text-xl ${active ? "text-neon" : "text-foreground"}`}
                    >
                      {formatPrice(p.price_cents)}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* DNI photo */}
        {fieldCfg.dni_photo.visible && (
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">
              Foto del DNI (frontal){fieldCfg.dni_photo.required ? " *" : ""}
            </h3>
            {form.dni_preview ? (
              <div className="relative inline-block">
                <img
                  src={form.dni_preview}
                  alt="DNI"
                  className="max-w-full max-h-64 rounded-lg border border-neon/30"
                />
                <label className="absolute bottom-2 right-2 cursor-pointer bg-card/90 border border-neon/40 text-neon text-[10px] uppercase tracking-widest px-3 py-1.5 rounded-md">
                  Cambiar
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])}
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 h-44 rounded-lg border-2 border-dashed border-neon/30 hover:border-neon/60 hover:bg-neon/5 transition cursor-pointer">
                <Camera className="w-8 h-8 text-neon" />
                <div className="text-sm text-foreground font-display">
                  Tomar foto / Subir imagen
                </div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Se comprimirá automáticamente
                </div>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleDniFile(e.target.files[0])}
                />
              </label>
            )}
          </section>
        )}

        {/* Contrato + firma (único paso separado) */}
        {fieldCfg.signature.visible && (
          <section className="border-t border-border pt-6">
            <h3 className="text-[11px] uppercase tracking-[0.3em] text-neon mb-4">
              Contrato y firma — versión {CONTRACT_VERSION}
            </h3>
            <div
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 10)
                  set("contract_read", true);
              }}
              className="bg-input border border-border rounded-lg p-5 h-56 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
            >
              {CONTRACT_TEXT_ES}
            </div>
            <label className="flex items-start gap-3 text-sm mt-3">
              <input
                type="checkbox"
                checked={form.contract_read}
                onChange={(e) => set("contract_read", e.target.checked)}
                className="mt-1 accent-[oklch(0.86_0.28_145)]"
              />
              <span>
                He leído y acepto íntegramente las normas, el contrato y la política de protección
                de datos.
              </span>
            </label>
            <div className="mt-4">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-2">
                Firma del socio
              </div>
              <SignaturePad ref={sigRef} height={220} />
            </div>
          </section>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:items-end justify-end pt-4 border-t border-border">
          <label className="block text-xs text-neon">
            Método de pago de la cuota
            <select
              aria-label="Método de pago de la cuota"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full bg-input border border-border p-2"
            >
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
              <option value="other">Otro</option>
            </select>
          </label>
          <button
            type="button"
            disabled={saving || recStatus === "processing" || scanStatus === "scanning"}
            onClick={() => submit()}
            className="flex items-center gap-2 px-6 py-3 rounded-lg bg-gradient-neon text-primary-foreground font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {saving ? "Guardando..." : "Crear socio"}
          </button>
        </div>
      </div>
    </SnoopLayout>
  );
}

function Inp({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-1.5">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-input border border-border rounded-md px-3 py-2.5 text-sm focus:border-neon focus:ring-2 focus:ring-neon/20 outline-none transition"
      />
    </label>
  );
}
