import { z } from "zod";
import { resolveVoiceUtterance } from "./voice-intents.ts";
export const SnoopSymbol = z.enum([
  "create",
  "open",
  "find",
  "show",
  "change",
  "stop",
  "negate",
  "member",
  "product",
  "category",
  "stock",
  "cash",
  "report",
  "home",
  "settings",
  "activity",
  "order",
  "request",
  "commit",
]);
export const SnoopSketch = z
  .object({
    symbols: z.array(SnoopSymbol).max(40),
    screen: z.enum(["home", "member", "products", "cash", "other"]),
    references: z.array(z.enum(["r0"])).max(1),
  })
  .strict();
export type IntentSketch = z.infer<typeof SnoopSketch>;
const lexicon: Record<z.infer<typeof SnoopSymbol>, string[]> = {
  commit: [
    "guardar",
    "salvar",
    "salva",
    "cobrar",
    "pagar",
    "anular",
    "eliminar",
    "cancella",
    "conferma",
    "confirmar",
  ],
  create: [
    "crear",
    "crea",
    "creare",
    "creami",
    "registrar",
    "registra",
    "registrare",
    "nuevo",
    "nueva",
    "nuovo",
    "nuova",
    "alta",
    "añadir",
    "aggiungi",
  ],
  open: ["abre", "abrir", "apri", "aprire", "entra", "ir", "vai", "lleva", "llevar", "mostrar"],
  find: [
    "buscar",
    "busca",
    "búscame",
    "cerca",
    "cercare",
    "trovami",
    "trova",
    "encontrar",
    "encuentra",
  ],
  show: ["ver", "vedere", "vedi", "consultar", "consulta", "mostra"],
  change: ["cambia", "cambiare", "corrige", "correggi", "modifica"],
  stop: ["terminar", "termina", "fermati", "stop", "detener", "parar"],
  negate: ["no", "non", "oppure"],
  member: ["socio", "socios", "soci", "miembro", "miembros", "associato"],
  product: ["producto", "productos", "prodotto", "prodotti"],
  category: ["categoría", "categorias", "categoria", "categorie"],
  stock: ["stock", "inventario", "magazzino", "giacenze"],
  cash: ["caja", "cassa"],
  report: ["informe", "informes", "report", "rapporti", "resumen", "riepilogo"],
  home: ["home", "inicio"],
  settings: ["ajustes", "impostazioni"],
  activity: ["actividades", "attività", "historial", "storico"],
  order: ["pedido", "orden", "ordine"],
  request: ["quiero", "quisiera", "vorrei", "fammi", "puedes", "podria", "gustaria"],
};
const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const index = new Map(
  Object.entries(lexicon).flatMap(([key, words]) =>
    words.map((w) => [normalize(w), key as z.infer<typeof SnoopSymbol>] as const),
  ),
);
const fillers = new Set(
  "snoop hola oye por favor me mi un uno una el la il lo los las dei degli de del di da a en per che pagina pantalla seccion sección gestione gestione gestisci gestione llamado llamada nome nombre oggi hoy últimas ultima ultimo nuevas nuevos"
    .split(" ")
    .map(normalize),
);
export function projectSnoopTurn(raw: string, path: string) {
  const tokens = [...raw.matchAll(/[\p{L}\p{N}'’-]+/gu)].map((m) => ({
    word: m[0],
    at: m.index!,
    symbol: index.get(normalize(m[0])),
  }));
  const noun = tokens.find((t) => t.symbol === "member" || t.symbol === "product");
  const search = noun && tokens.some((t) => t.at < noun.at && t.symbol === "find");
  const semantic = search ? tokens.filter((t) => t.at <= noun.at) : tokens;
  const symbols = semantic.flatMap((t) => (t.symbol ? [t.symbol] : [])).slice(0, 40);
  const tail = search ? tokens.filter((t) => t.at > noun.at) : [];
  // Preserve exact names, including words that also occur in the command lexicon.
  // References are rebound locally after validation; the provider sees only r0.
  while (tail.length && fillers.has(normalize(tail[0].word))) tail.shift();
  const query = tail.length ? raw.slice(tail[0].at).trim().slice(0, 120) : "";
  const sketch: IntentSketch = {
    symbols,
    screen:
      path === "/soci/nuovo"
        ? "member"
        : path === "/productos"
          ? "products"
          : path === "/caja"
            ? "cash"
            : path === "/"
              ? "home"
              : "other",
    references: query ? ["r0"] : [],
  };
  return { sketch, localReference: query };
}
export function sketchSupports(command: string, sketch: IntentSketch): boolean {
  const s = new Set(sketch.symbols);
  if (s.has("negate") || s.has("commit") || s.has("stop")) return false;
  const domains = [
    "member",
    "product",
    "category",
    "stock",
    "cash",
    "home",
    "settings",
    "activity",
    "order",
  ].filter((x) => s.has(x as any));
  const productDomains = domains.filter((x) => !["category", "stock"].includes(x));
  if (productDomains.length > 1) return false;
  if (command === "Crear socio") return s.has("member") && s.has("create");
  if (command === "Buscar socio")
    return s.has("member") && (s.has("find") || s.has("open") || s.has("show"));
  if (command === "Crear producto") return s.has("product") && s.has("create");
  if (command === "Ver stock")
    return (
      s.has("stock") || (s.has("product") && (s.has("find") || s.has("show") || s.has("open")))
    );
  if (command === "Abrir caja" || command === "Ver caja de hoy") return s.has("cash");
  if (command === "Inicio") return s.has("home");
  if (command === "Ajustes") return s.has("settings");
  return false;
}
export function bindSnoopCommand(command: string, reference: string): string {
  return command === "Buscar socio" && reference
    ? `${command} ${reference}`
    : command === "Ver stock" && reference
      ? `Buscar producto ${reference}`
      : command;
}
export function planSnoopTurn(raw: string, path: string): ReturnType<typeof resolveVoiceUtterance> {
  const projection = projectSnoopTurn(raw, path),
    s = new Set(projection.sketch.symbols);
  // Stop is an explicit whole command; field values are never fuzzy-corrected.
  if (s.has("commit"))
    return {
      kind: "uncertain",
      message:
        "Revisa los datos y confirma con el botón del formulario. No guardo ni cobro por voz.",
    };
  const old = resolveVoiceUtterance(raw, path);
  if (old.kind !== "uncertain") return old;
  const candidates = [
    "Crear socio",
    "Buscar socio",
    "Crear producto",
    "Ver stock",
    "Abrir caja",
    "Inicio",
    "Ajustes",
  ].filter((c) => sketchSupports(c, projection.sketch));
  if (
    candidates.length === 1 &&
    !s.has("request") &&
    (s.has("create") || s.has("find") || s.has("open") || s.has("show"))
  )
    return { kind: "command", text: bindSnoopCommand(candidates[0], projection.localReference) };
  if (s.has("member"))
    return { kind: "uncertain", message: "¿Quieres registrar un socio o buscar una ficha?" };
  if (s.has("product") || s.has("category") || s.has("stock"))
    return {
      kind: "uncertain",
      message: "¿Quieres buscar un producto, crearlo o consultar inventario?",
    };
  if (s.has("cash") || s.has("report"))
    return { kind: "uncertain", message: "¿Quieres consultar la caja o su informe?" };
  return {
    kind: "uncertain",
    message: "¿Quieres trabajar con socios, productos, caja o informes?",
  };
}
