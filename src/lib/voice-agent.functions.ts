import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, generateObject, tool, stepCountIs } from "ai";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

// ---------- Transcription ----------
const TranscribeInput = z.object({
  audioBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TranscribeInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const bin = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const ext =
      data.mimeType.includes("mp4") ? "mp4" :
      data.mimeType.includes("mpeg") ? "mp3" :
      data.mimeType.includes("wav") ? "wav" : "webm";
    const blob = new Blob([bin], { type: data.mimeType.split(";")[0] });

    const fd = new FormData();
    fd.append("model", "openai/gpt-4o-mini-transcribe");
    fd.append("file", blob, `recording.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Lovable-API-Key": key },
      body: fd,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Transcripción falló: ${res.status} ${t.slice(0, 200)}`);
    }
    const j = (await res.json()) as { text?: string };
    return { text: (j.text ?? "").trim() };
  });

// ---------- Text-to-Speech (Snoop voice) ----------
const TTSInput = z.object({
  text: z.string().min(1).max(800),
});

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TTSInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
      method: "POST",
      headers: {
        "Lovable-API-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: data.text,
        voice: "ash",
        response_format: "mp3",
        speed: 1.05,
        instructions:
          "Habla en español con VOZ MASCULINA, joven, simpática y divertida, estilo personaje de dibujos animados (tipo Genio de Aladdin pero más calmado). Tono cálido, amigable y un punto travieso. Energía alegre sin gritar, ritmo natural, expresivo y cercano. NUNCA voz femenina.",
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`TTS falló: ${res.status} ${t.slice(0, 200)}`);
    }
    const buf = await res.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    return { audioBase64: b64, mimeType: "audio/mpeg" };
  });

// ---------- Field extraction for the new-socio page ----------
const ExtractInput = z.object({
  transcript: z.string().min(1),
  current: z.object({
    first_name: z.string().default(""),
    last_name: z.string().default(""),
    birth_date: z.string().default(""),
    city: z.string().default(""),
    phone: z.string().default(""),
    email: z.string().default(""),
    dni_number: z.string().default(""),
    plan_name: z.string().default(""),
  }),
  available_plans: z.array(z.string()).default([]),
});

const FieldsSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string(),
  city: z.string(),
  phone: z.string(),
  email: z.string(),
  dni_number: z.string(),
  plan_name: z.string(),
});

type MemberFields = z.infer<typeof FieldsSchema>;

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanExtractedValue(value: string) {
  return value
    .replace(/^[:\-\s]+/, "")
    .replace(/[,.\s]+$/g, "")
    .trim();
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeExtractedDate(value: string) {
  const s = value.trim();
  const numeric = s.match(/(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/);
  if (numeric) {
    let [, d, m, y] = numeric;
    if (y.length === 2) y = (Number(y) > 30 ? "19" : "20") + y;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = s.match(/(\d{4})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  return "";
}

function parseMemberFieldsFromTranscript(transcript: string, availablePlans: string[]): Partial<MemberFields> {
  const raw = transcript.replace(/[“”"']/g, " ").replace(/\s+/g, " ").trim();
  const normalized = stripAccents(raw).toLowerCase();
  const labels: Array<[keyof MemberFields, RegExp]> = [
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
    .sort((a, b) => a!.start - b!.start) as Array<{ key: keyof MemberFields; start: number; valueStart: number }>;

  const out: Partial<MemberFields> = {};
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const nextStart = hits[i + 1]?.start ?? raw.length;
    const value = cleanExtractedValue(raw.slice(hit.valueStart, nextStart));
    if (!value) continue;
    if (hit.key === "first_name" || hit.key === "last_name" || hit.key === "city") out[hit.key] = titleCase(value);
    else if (hit.key === "birth_date") out.birth_date = normalizeExtractedDate(value);
    else if (hit.key === "dni_number") out.dni_number = value.replace(/[^0-9a-z]/gi, "").toUpperCase();
    else if (hit.key === "phone") out.phone = value.replace(/(?!^\+)[^0-9]/g, "");
    else if (hit.key === "email") out.email = value.replace(/\s+/g, "").toLowerCase();
    else if (hit.key === "plan_name") out.plan_name = value;
  }

  const planText = stripAccents((out.plan_name || raw).toLowerCase()).replace(/^cuota\s+/, "").trim();
  const plan = availablePlans.find((p) => {
    const name = stripAccents(p.toLowerCase()).replace(/^cuota\s+/, "").trim();
    return planText.includes(name) || name.includes(planText) || normalized.includes(name);
  });
  if (plan) out.plan_name = plan;
  else if (/mensual|mensile|mes\b/.test(normalized)) out.plan_name = availablePlans.find((p) => stripAccents(p.toLowerCase()).includes("mens")) ?? out.plan_name;
  else if (/trimestral|trimestrale/.test(normalized)) out.plan_name = availablePlans.find((p) => stripAccents(p.toLowerCase()).includes("trimes")) ?? out.plan_name;
  else if (/anual|annuale|ano|anno/.test(normalized)) out.plan_name = availablePlans.find((p) => stripAccents(p.toLowerCase()).includes("anual") || stripAccents(p.toLowerCase()).includes("ann")) ?? out.plan_name;

  return out;
}

export const extractMemberFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ExtractInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");
    const deterministic = parseMemberFieldsFromTranscript(data.transcript, data.available_plans);

    const system = `Extraes datos de un socio dictados por voz (español o italiano) y devuelves un objeto con TODOS los campos.
Reglas:
- Devuelve SIEMPRE los 7 campos. Si un campo no se menciona, devuelve el valor previo del estado actual (o "" si no había).
- first_name / last_name: capitaliza correctamente.
- birth_date: formato estricto YYYY-MM-DD. Acepta dictados tipo "24 del 7 del 1995", "24/07/1995", "veinticuatro de julio de mil novecientos noventa y cinco" → "1995-07-24".
- dni_number: solo dígitos y letra final en mayúscula, sin espacios (ej "12345678A"). Acepta dictado tipo "uno dos tres cuatro cinco seis siete ocho A".
- phone: solo dígitos (puede empezar por +). Acepta dictado tipo "seis seis seis siete siete siete ocho ocho ocho".
- email: minúsculas, sin espacios, formato "x@y.z". Si no se menciona, devuelve "".
- city: nombre de ciudad.
- plan_name: DEBE coincidir EXACTAMENTE con uno de [${data.available_plans.join(", ") || "ninguno"}]. Mapea sinónimos (mensual→Mensual, trimestral→Trimestral, anual→Anual). Si no encaja, devuelve "".
- NUNCA inventes datos que no se hayan dicho.

Estado actual: ${JSON.stringify(data.current)}`;

    try {
      const { object } = await generateObject({
        model,
        system,
        schema: FieldsSchema,
        prompt: `Transcripción dictada por el usuario: "${data.transcript}"`,
      });
      // Merge: only overwrite when model returned a non-empty value
      const out = { ...data.current };
      for (const k of Object.keys(out) as Array<keyof typeof out>) {
        const v = (object as any)[k];
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      for (const k of Object.keys(deterministic) as Array<keyof MemberFields>) {
        const v = deterministic[k];
        if (typeof v === "string" && v.trim()) out[k] = v.trim();
      }
      return { fields: out };
    } catch (e: any) {
      console.error("extractMemberFields failed:", e?.message);
      const fallback = { ...data.current };
      for (const k of Object.keys(deterministic) as Array<keyof MemberFields>) {
        const v = deterministic[k];
        if (typeof v === "string" && v.trim()) fallback[k] = v.trim();
      }
      return { fields: fallback };
    }
  });

// ---------- OCR: extract fields from a photo of an ID document ----------
const DniImagesInput = z.object({
  images: z
    .array(z.object({ base64: z.string().min(1), mimeType: z.string().min(1) }))
    .min(1)
    .max(2),
});

const DniFieldsSchema = z.object({
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string(),
  dni_number: z.string(),
  address: z.string(),
  city: z.string(),
  postal_code: z.string(),
});

export const extractMemberFieldsFromImages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DniImagesInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const system = `Eres un OCR para documentos de identidad (DNI/NIE español, pasaporte o similar).
Extrae los datos que aparecen VISIBLES en las fotos y devuelve JSON.
Reglas:
- first_name: nombre de pila con capitalización correcta (ej. "María José").
- last_name: apellidos completos con capitalización correcta (ej. "García Pérez").
- birth_date: SIEMPRE en formato YYYY-MM-DD.
- dni_number: número completo tal cual aparece, sin espacios, con la letra en mayúscula (ej. "12345678A").
- address: dirección con calle y número, tal como figura en el reverso del DNI.
- city: municipio / localidad de residencia.
- postal_code: código postal (5 dígitos).
- Si un campo NO se ve o no estás seguro, devuelve cadena vacía "".
- Nunca inventes datos que no aparezcan en la imagen.`;

    try {
      const { object } = await generateObject({
        model,
        system,
        schema: DniFieldsSchema,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Extrae los datos del documento de identidad de estas fotos." },
              ...data.images.map((img) => ({
                type: "image" as const,
                image: `data:${img.mimeType};base64,${img.base64}`,
              })),
            ],
          },
        ],
      });
      return { fields: object };
    } catch (e: any) {
      console.error("extractMemberFieldsFromImages failed:", e?.message);
      throw new Error("No se pudieron leer los datos del documento.");
    }
  });



// ---------- Agent ----------
const AgentInput = z.object({
  transcript: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .max(40)
    .default([]),
});

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(date: string, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function normalizeDate(input: string): string | null {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 30 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export const agentRespond = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AgentInput.parse(d))
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const supabase = context.supabase;
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");

    const tools = {
      list_plans: tool({
        description: "Lista las cuotas/planes activos disponibles.",
        inputSchema: z.object({}),
        execute: async () => {
          const { data, error } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days,price_cents")
            .eq("active", true)
            .order("sort_order");
          if (error) return { error: error.message };
          return { plans: data };
        },
      }),
      list_recent_members: tool({
        description: "Lista los socios más recientes con su fecha de caducidad.",
        inputSchema: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
        execute: async ({ limit }) => {
          const { data, error } = await supabase
            .from("members")
            .select("id,first_name,last_name,phone,city,expires_at")
            .order("created_at", { ascending: false })
            .limit(limit);
          if (error) return { error: error.message };
          return { members: data };
        },
      }),
      find_members: tool({
        description: "Busca socios por número de socio (7 dígitos), nombre, apellido o DNI.",
        inputSchema: z.object({ query: z.string().min(1) }),
        execute: async ({ query }) => {
          const q = `%${query}%`;
          const { data, error } = await supabase
            .from("members")
            .select("id,member_number,first_name,last_name,phone,city,expires_at,plan_id,dni_number")
            .or(`first_name.ilike.${q},last_name.ilike.${q},dni_number.ilike.${q},member_number.ilike.${q}`)
            .limit(10);
          if (error) return { error: error.message };
          return { members: data };
        },
      }),
      create_member: tool({
        description:
          "Crea un nuevo socio con TODOS los datos dictados. Llama esta herramienta UNA SOLA VEZ cuando tengas: nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan. La foto del DNI y la firma del contrato son el ÚNICO paso aparte (se hacen en la ficha del socio después).",
        inputSchema: z.object({
          first_name: z.string().min(1),
          last_name: z.string().min(1),
          birth_date: z.string().describe("Fecha de nacimiento en formato YYYY-MM-DD o DD/MM/YYYY"),
          city: z.string().min(1),
          phone: z.string().min(3),
          dni_number: z.string().min(3),
          plan_name: z.string().describe("Nombre del plan (ej. Mensual, Trimestral, Anual)"),
        }),
        execute: async (input) => {
          const birth = normalizeDate(input.birth_date);
          if (!birth) return { error: "Fecha de nacimiento no válida. Usa DD/MM/AAAA." };
          const age = (Date.now() - new Date(birth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
          if (age < 18) return { error: "El socio debe ser mayor de edad." };

          const { data: planRows } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days")
            .eq("active", true);
          const plans = planRows ?? [];
          const target = input.plan_name.toLowerCase();
          const plan =
            plans.find((p) => p.name.toLowerCase() === target) ??
            plans.find((p) => p.name.toLowerCase().includes(target) || target.includes(p.name.toLowerCase()));
          if (!plan) return { error: `Plan no encontrado. Disponibles: ${plans.map((p) => p.name).join(", ")}` };

          const joined = todayISO();
          const expires = addDays(joined, plan.duration_days);

          const { data: clubIdData } = await supabase.rpc("current_club_id" as any);
          const clubId = clubIdData as string | null;
          if (!clubId) return { error: "Usuario sin club asignado." };

          const { data: created, error } = await supabase
            .from("members")
            .insert({
              club_id: clubId,
              first_name: input.first_name.trim(),
              last_name: input.last_name.trim(),
              birth_date: birth,
              city: input.city.trim(),
              phone: input.phone.trim(),
              dni_number: input.dni_number.trim().toUpperCase(),
              plan_id: plan.id,
              joined_at: joined,
              expires_at: expires,
              created_by: context.userId,
            })
            .select("id,first_name,last_name,expires_at")
            .single();
          if (error) return { error: error.message };
          return {
            created,
            navigate_to: `/soci/${created.id}`,
            note: "Socio creado. Ahora abre la ficha para subir la foto del DNI y firmar el contrato.",
          };
        },
      }),
      renew_member: tool({
        description: "Renueva la cuota de un socio existente. Suma los días del plan a la fecha de caducidad actual (o a hoy si ya caducó).",
        inputSchema: z.object({
          member_id: z.string().uuid(),
          plan_name: z.string(),
        }),
        execute: async ({ member_id, plan_name }) => {
          const { data: plans } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days")
            .eq("active", true);
          const target = plan_name.toLowerCase();
          const plan = (plans ?? []).find(
            (p) => p.name.toLowerCase() === target || p.name.toLowerCase().includes(target),
          );
          if (!plan) return { error: "Plan no encontrado." };
          const { data: m } = await supabase.from("members").select("expires_at").eq("id", member_id).maybeSingle();
          if (!m) return { error: "Socio no encontrado." };
          const base = m.expires_at < todayISO() ? todayISO() : m.expires_at;
          const newExpires = addDays(base, plan.duration_days);
          const { error } = await supabase
            .from("members")
            .update({ plan_id: plan.id, expires_at: newExpires })
            .eq("id", member_id);
          if (error) return { error: error.message };
          return { ok: true, expires_at: newExpires };
        },
      }),
    };

    const system = `Eres el asistente de voz de SNOOP, un club social de cannabis en España.
Hablas en español, respondes siempre MUY breve y natural (1-2 frases, como hablaría una persona, sin listas ni markdown).
Mantienes el contexto: si el usuario ya te dio un dato antes, NO lo vuelvas a pedir.

Para CREAR un socio necesitas TODOS estos datos: nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan.
Ve acumulando los datos que el usuario dicte en uno o varios turnos. Cuando tengas TODOS, llama create_member UNA SOLA VEZ con todo junto.
Si faltan datos, pide solo los que falten, todos juntos en una sola frase (ej: "Me falta ciudad y teléfono").
NO preguntes por la foto del DNI ni por la firma: esos son el único paso aparte, se hacen luego en la ficha del socio.
Después de crear, confirma con el nombre y di "abro la ficha para la foto del DNI y la firma".

También puedes: buscar socios, listar planes, renovar cuotas.
Fecha de hoy: ${todayISO()}.`;

    const { text, toolResults } = await generateText({
      model,
      system,
      messages: [
        ...data.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: data.transcript },
      ],
      tools,
      stopWhen: stepCountIs(50),
    });

    // Surface a navigation target if create_member returned one
    let navigateTo: string | null = null;
    for (const tr of toolResults ?? []) {
      const out = (tr as any).output ?? (tr as any).result;
      if (out && typeof out === "object" && typeof out.navigate_to === "string") {
        navigateTo = out.navigate_to;
      }
    }

    return { reply: text || "Hecho.", navigateTo };
  });

// ---------- Order item parsing ----------
const ParseOrderInput = z.object({
  transcript: z.string().min(1),
  products: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      unit_type: z.string(),
      sell_price: z.number(),
      stock: z.number(),
    }),
  ).default([]),
});

const ParsedItemsSchema = z.object({
  items: z.array(
    z.object({
      product_id: z.string().describe("ID exacto del producto del catálogo, o vacío si no hay match."),
      product_name: z.string(),
      quantity: z.number().positive(),
      unit_type: z.enum(["gr", "unit"]),
    }),
  ),
});

export const parseOrderItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ParseOrderInput.parse(d))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-2.5-flash");

    const catalog = data.products
      .map((p) => `- id=${p.id} | "${p.name}" | unidad=${p.unit_type} | precio=${(p.sell_price / 100).toFixed(2)}€ | stock=${p.stock}`)
      .join("\n");

    const system = `Extraes pedidos de un socio dictados en español/italiano.
Devuelves SOLO productos que existan en el catálogo. Para cada item:
- product_id: el id EXACTO del catálogo. Si no hay match claro, item se omite.
- quantity: cantidad numérica. Si el producto se vende en "gr", la cantidad es en gramos (acepta "medio gramo"=0.5, "un gramo"=1, "dos gramos"=2, "3.5"=3.5, "cinco euros de X" → calcula gramos = euros/precio_por_gramo). Si es "unit", cantidad entera de unidades.
- unit_type: "gr" o "unit", coincidente con el catálogo.

Catálogo disponible:
${catalog || "(vacío)"}

Ejemplos:
- "un gramo de amnesia y dos cervezas" → [{amnesia, 1, gr}, {cerveza, 2, unit}]
- "diez euros de critical" si critical cuesta 10€/g → [{critical, 1, gr}]
- "medio de og kush" → [{og kush, 0.5, gr}]`;

    try {
      const { object } = await generateObject({
        model,
        system,
        schema: ParsedItemsSchema,
        prompt: `Dictado: "${data.transcript}"`,
      });
      // Validate ids exist in catalog
      const validIds = new Set(data.products.map((p) => p.id));
      const items = object.items.filter((i) => validIds.has(i.product_id));
      return { items };
    } catch (e: any) {
      console.error("parseOrderItems failed:", e?.message);
      return { items: [] as Array<{ product_id: string; product_name: string; quantity: number; unit_type: "gr" | "unit" }> };
    }
  });
