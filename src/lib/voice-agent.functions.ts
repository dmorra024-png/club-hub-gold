import { createServerFn } from "@tanstack/react-start";
import {
  requireSupabaseClubAuth,
  requireClubMemberAuth,
  requireClubCashAuth,
} from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateText, generateObject, tool, stepCountIs } from "ai";
import { administrativeModel } from "./administrative-ai.server";
import {
  parseAdministrativeDictation,
  calendarDate,
  isAdult,
  madridToday,
  addCalendarDays,
} from "./member-administration";

// ---------- Transcription ----------
const TranscribeInput = z.object({
  audioBase64: z.string().min(1).max(12_000_000),
  mimeType: z.string().min(1).max(80),
  language: z.enum(["it", "es"]).optional(),
});

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((d: unknown) => TranscribeInput.parse(d))
  .handler(async ({ data }) => {
    const { transcribeAdministrativeAudio } = await import("./administrative-ai.server");
    return transcribeAdministrativeAudio(data);
  });

// ---------- Text-to-Speech (Snoop voice) ----------
const TTSInput = z.object({
  text: z.string().min(1).max(800),
});

export const synthesizeSpeech = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((d: unknown) => TTSInput.parse(d))
  .handler(async ({ data }) => {
    const { administrativeSpeech } = await import("./administrative-ai.server");
    return administrativeSpeech(data.text);
  });

// ---------- Field extraction for the new-socio page ----------
const ExtractInput = z.object({
  transcript: z.string().min(1).max(12_000),
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

export const extractMemberFields = createServerFn({ method: "POST" })
  .middleware([requireClubMemberAuth])
  .inputValidator((d: unknown) => ExtractInput.parse(d))
  .handler(async ({ data }) => {
    const { administrativeModel } = await import("./administrative-ai.server");
    const deterministic = parseAdministrativeDictation(data.transcript, data.available_plans);
    if (process.env.AI_PROVIDER === "cloudflare" && process.env.AI_VOICE_ONLY === "true") {
      return {
        fields: {
          ...data.current,
          ...Object.fromEntries(Object.entries(deterministic).filter(([, value]) => value)),
        },
        source: "local" as const,
        warning: null,
      };
    }

    const system = `Extraes datos de un socio dictados por voz (español o italiano) y devuelves un objeto con TODOS los campos.
Reglas:
- Devuelve SIEMPRE los 8 campos. Si un campo no se menciona, devuelve el valor previo del estado actual (o "" si no había).
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
        model: administrativeModel(),
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
      return { fields: out, source: "ai" as const, warning: null };
    } catch (e: any) {
      console.warn("AI extraction unavailable; using local field parser");
      const fallback = { ...data.current };
      for (const k of Object.keys(deterministic) as Array<keyof MemberFields>) {
        const v = deterministic[k];
        if (typeof v === "string" && v.trim()) fallback[k] = v.trim();
      }
      return {
        fields: fallback,
        source: "local" as const,
        warning:
          "IA no disponible: se ha usado el parser local. Revisa los campos antes de guardar.",
      };
    }
  });

// ---------- OCR: extract fields from a photo of an ID document ----------
const DniImagesInput = z.object({
  images: z
    .array(
      z.object({
        base64: z
          .string()
          .min(1)
          .max(10_000_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      }),
    )
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
  .middleware([requireClubMemberAuth])
  .inputValidator((d: unknown) => DniImagesInput.parse(d))
  .handler(async ({ data }) => {
    const { administrativeModel } = await import("./administrative-ai.server");

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
        model: administrativeModel("documents"),
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
      console.warn("ID OCR provider unavailable");
      throw new Error("No se pudieron leer los datos del documento.");
    }
  });

// ---------- Agent ----------
const AgentInput = z.object({
  transcript: z.string().min(1).max(12_000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(6000) }))
    .max(40)
    .default([]),
});

function todayISO() {
  return madridToday();
}
function addDays(date: string, days: number) {
  return addCalendarDays(date, days);
}
function normalizeDate(input: string) {
  return calendarDate(input);
}

export const agentRespond = createServerFn({ method: "POST" })
  .middleware([requireSupabaseClubAuth])
  .inputValidator((d: unknown) => AgentInput.parse(d))
  .handler(async ({ data, context }) => {
    const { administrativeModel } = await import("./administrative-ai.server");
    if (process.env.AI_PROVIDER === "cloudflare" && process.env.AI_VOICE_ONLY === "true") {
      const { privateVoiceCommand } = await import("./private-voice.ts");
      const command = privateVoiceCommand(data.transcript, data.history);
      if (command.permission) {
        const { requireOperationalClub } = await import("./club-access.server");
        await requireOperationalClub(context, command.permission);
      }
      return {
        reply: command.reply,
        navigateTo: command.navigateTo,
        memberDraft: command.memberDraft,
      };
    }
    const model = administrativeModel();
    const supabase = context.supabase;

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
          const q = `%${query.replace(/[%_.,()\\]/g, "").slice(0, 120)}%`;
          const { data, error } = await supabase
            .from("members")
            .select(
              "id,member_number,first_name,last_name,phone,city,expires_at,plan_id,dni_number",
            )
            .or(
              `first_name.ilike.${q},last_name.ilike.${q},dni_number.ilike.${q},member_number.ilike.${q}`,
            )
            .limit(10);
          if (error) return { error: error.message };
          return { members: data };
        },
      }),
      create_member: tool({
        description:
          "Prepara el formulario de un nuevo socio con TODOS los datos dictados. No guardes sin confirmación manual. Llama esta herramienta UNA SOLA VEZ cuando tengas: nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan. La foto del DNI y la firma del contrato son el ÚNICO paso aparte (se hacen en la ficha del socio después).",
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
          if (!isAdult(birth)) return { error: "El socio debe ser mayor de edad." };

          const { data: planRows } = await supabase
            .from("membership_plans")
            .select("id,name,duration_days")
            .eq("active", true);
          const plans = planRows ?? [];
          const target = input.plan_name.toLowerCase();
          const plan =
            plans.find((p) => p.name.toLowerCase() === target) ??
            plans.find(
              (p) => p.name.toLowerCase().includes(target) || target.includes(p.name.toLowerCase()),
            );
          if (!plan)
            return {
              error: `Plan no encontrado. Disponibles: ${plans.map((p) => p.name).join(", ")}`,
            };

          return {
            navigate_to: "/soci/nuovo",
            draft: {
              first_name: input.first_name.trim(),
              last_name: input.last_name.trim(),
              birth_date: birth,
              city: input.city.trim(),
              phone: input.phone.trim(),
              dni_number: input.dni_number.trim().toUpperCase(),
              plan_name: plan.name,
              email: "",
            },
            note: "Borrador preparado. Revisa los datos y confirma Crear socio en el formulario; todavía no se ha guardado.",
          };
        },
      }),
      renew_member: tool({
        description:
          "Renueva la cuota de un socio existente. Suma los días del plan a la fecha de caducidad actual (o a hoy si ya caducó).",
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
          const { data: m } = await supabase
            .from("members")
            .select("expires_at")
            .eq("id", member_id)
            .maybeSingle();
          if (!m) return { error: "Socio no encontrado." };
          return {
            navigate_to: `/soci/${member_id}`,
            note: "Abre la ficha, selecciona la cuota y confirma Renovar. Todavía no se ha modificado la cuota.",
          };
        },
      }),
    };

    const system = `Eres el asistente de voz de SNOOP, un club social de cannabis en España.
Responde en italiano si el usuario habla italiano; en español si habla español. Responde siempre MUY breve y natural (1-2 frases, como hablaría una persona, sin listas ni markdown).
Mantienes el contexto: si el usuario ya te dio un dato antes, NO lo vuelvas a pedir.

Para CREAR un socio necesitas TODOS estos datos: nombre, apellido, fecha de nacimiento, DNI, ciudad, teléfono y plan.
Ve acumulando los datos que el usuario dicte en uno o varios turnos. Cuando tengas TODOS, llama create_member UNA SOLA VEZ para preparar el formulario. No se guarda nada hasta que el usuario pulse Crear socio.
Si faltan datos, pide solo los que falten, todos juntos en una sola frase (ej: "Me falta ciudad y teléfono").
NO preguntes por la foto del DNI ni por la firma: esos son el único paso aparte, se hacen luego en la ficha del socio.
Explica que solo has preparado un borrador y que el usuario debe revisar y guardar. Para renovar, abre la ficha y pide confirmación manual.

También puedes: buscar socios, listar planes, renovar cuotas.
Fecha de hoy: ${todayISO()}.`;

    const { text, steps } = await generateText({
      model,
      system,
      messages: [
        ...data.history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: data.transcript },
      ],
      tools,
      stopWhen: stepCountIs(8),
    }).catch(() => {
      throw new Error(
        "El proveedor de IA no ha podido completar la solicitud. No se han guardado cambios.",
      );
    });

    // Surface a navigation target if create_member returned one
    let navigateTo: string | null = null;
    let memberDraft: Record<string, string> | null = null;
    for (const tr of steps.flatMap((step) => step.toolResults)) {
      const out = tr.output as { navigate_to?: string; draft?: Record<string, string> } | undefined;
      if (out?.draft) memberDraft = out.draft;
      if (out && typeof out === "object" && typeof out.navigate_to === "string") {
        navigateTo = out.navigate_to;
      }
    }

    return { reply: text || "Revisa el formulario antes de confirmar.", navigateTo, memberDraft };
  });

// ---------- Order item parsing ----------
const ParseOrderInput = z.object({
  transcript: z.string().min(1).max(12_000),
  products: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        unit_type: z.string(),
        sell_price: z.number(),
        stock: z.number(),
      }),
    )
    .default([]),
});

const ParsedItemsSchema = z.object({
  items: z.array(
    z.object({
      product_id: z
        .string()
        .describe("ID exacto del producto del catálogo, o vacío si no hay match."),
      product_name: z.string(),
      quantity: z.number().positive(),
      unit_type: z.enum(["gr", "unit"]),
    }),
  ),
});

export const parseOrderItems = createServerFn({ method: "POST" })
  .middleware([requireClubCashAuth])
  .inputValidator((d: unknown) => ParseOrderInput.parse(d))
  .handler(async ({ data }) => {
    const model = administrativeModel();

    const catalog = data.products
      .map(
        (p) =>
          `- id=${p.id} | "${p.name}" | unidad=${p.unit_type} | precio=${(p.sell_price / 100).toFixed(2)}€ | stock=${p.stock}`,
      )
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
      return {
        items: [] as Array<{
          product_id: string;
          product_name: string;
          quantity: number;
          unit_type: "gr" | "unit";
        }>,
      };
    }
  });

export const getAdministrativeAiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseClubAuth])
  .handler(async () => {
    const { administrativeAiStatus } = await import("./administrative-ai.server");
    return administrativeAiStatus();
  });
