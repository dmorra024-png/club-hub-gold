import { loadAdministrativeCatalog } from "@/lib/administrative-catalog";
import { useAuth } from "@/hooks/useAuth";
import { useWhisperDictation } from "@/hooks/useWhisperDictation";
import { transcribeAudio } from "@/lib/voice-agent.functions";
import { productFormVoice } from "@/lib/product-form-voice";
import { createFileRoute } from "@tanstack/react-router";
import { SnoopLayout } from "@/components/SnoopLayout";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Package,
  Tag,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Mic,
  Square,
  Search,
  Loader2,
  Sparkles,
  ImageIcon,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { parseProductCommand } from "@/lib/products-voice.functions";
import { getAdministrativeAiStatus } from "@/lib/voice-agent.functions";
import { readCatalogImage } from "@/lib/catalog-image";
import type { CatalogImage } from "@/lib/catalog-enrichment.server";
import { enrichProduct } from "@/lib/products-enrich.functions";

export const Route = createFileRoute("/_authenticated/productos")({
  component: ProductosPage,
});

function compactVoiceText(text: string) {
  const words = text
    .replace(/[“”"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out: string[] = [];
  const normWord = (w: string) =>
    w
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  for (const word of words) {
    const current = normWord(word);
    const previous = out[out.length - 1] ? normWord(out[out.length - 1]) : "";
    if (current && current === previous) continue;
    out.push(word);
    // Chrome mobile can replay chunks: "stock más stock más stock más".
    // Collapse repeated phrases at the end, not only repeated single words.
    let changed = true;
    while (changed) {
      changed = false;
      const max = Math.min(6, Math.floor(out.length / 2));
      for (let size = max; size >= 1; size--) {
        const a = out
          .slice(out.length - size * 2, out.length - size)
          .map(normWord)
          .join(" ");
        const b = out
          .slice(out.length - size)
          .map(normWord)
          .join(" ");
        if (a && a === b) {
          out.splice(out.length - size, size);
          changed = true;
          break;
        }
      }
    }
  }
  return out.join(" ").trim();
}

function mergeVoiceText(previous: string, incoming: string) {
  const prev = compactVoiceText(previous);
  const next = compactVoiceText(incoming);
  if (!prev) return next;
  if (!next) return prev;
  const normWord = (w: string) =>
    w
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const a = prev.split(/\s+/).filter(Boolean);
  const b = next.split(/\s+/).filter(Boolean);
  const an = a.map(normWord);
  const bn = b.map(normWord);
  if (bn.join(" ").startsWith(an.join(" "))) return next;
  let overlap = 0;
  const max = Math.min(an.length, bn.length);
  for (let size = max; size >= 1; size--) {
    if (an.slice(-size).join(" ") === bn.slice(0, size).join(" ")) {
      overlap = size;
      break;
    }
  }
  return compactVoiceText([...a, ...b.slice(overlap)].join(" "));
}

// Web Speech dictation hook — manual stop: records until the user presses stop.
function useDictation(onText: (text: string) => void) {
  const status = useServerFn(getAdministrativeAiStatus),
    transcribe = useServerFn(transcribeAudio);
  const { user, access, can } = useAuth();
  const allowed = can("manage_products");
  const revision = useRef(0),
    started = useRef(0);
  useEffect(() => {
    const edit = () => {
      revision.current++;
    };
    document.addEventListener("input", edit);
    return () => document.removeEventListener("input", edit);
  }, []);
  const dict = useWhisperDictation({
    scope: JSON.stringify([user?.id, access.clubId, access.role, access.permissions, allowed]),
    language: "es",
    getLanguage: () =>
      localStorage.getItem("snoop:voice-language")?.startsWith("it") ? "it" : "es",
    available: async () => (can("manage_products") ? status() : { available: false }),
    transcribe: (data) => transcribe({ data }),
    onTranscript: (text) => {
      if (!can("manage_products")) return;
      if (revision.current !== started.current) {
        toast.info("Se conserva tu edición manual. Revisa el dictado.");
        return;
      }
      onText(text);
    },
  });
  useEffect(() => {
    if (!can("manage_products")) dict.cancel();
  }, [access.role, access.permissions.join(","), access.status, allowed]);
  useEffect(() => {
    if (dict.error) toast.error(dict.error);
  }, [dict.error]);
  return {
    listening: dict.phase === "recording",
    busy: dict.phase === "starting" || dict.phase === "processing",
    interim: dict.phase === "processing" ? "Procesando…" : "",
    start: () => {
      started.current = revision.current;
      void dict.start();
    },
    stop: dict.finish,
  };
}

type UnitType = "gr" | "unit";
type Strain = "indica" | "sativa" | "hibrida";
type Category = {
  id: string;
  name: string;
  unit_type: UnitType;
  is_smokeable: boolean;
  archived?: boolean;
};
type Product = {
  id: string;
  club_id: string;
  category_id: string;
  name: string;
  stock: number;
  buy_price: number;
  sell_price: number;
  strain: Strain | null;
  notes: string | null;
  image_url: string | null;
  description: string | null;
  active?: boolean;
  image_attribution?: CatalogImage | null;
};
type StockCommand = { text: string; at: number };

const TABS = [
  { id: "stock", label: "Stock" },
  { id: "nuevo", label: "Crear producto" },
  { id: "categoria", label: "Crear categoría" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function ProductosPage() {
  const { user, access, loading: authLoading, accessError, can } = useAuth();
  const catalogScope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
  ]);
  const [loadedScope, setLoadedScope] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const catalogRequest = useRef(0);
  const [tab, setTab] = useState<TabId>("stock");
  const [cats, setCats] = useState<Category[]>([]);
  const [prods, setProds] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockSearch, setStockSearch] = useState("");
  const [prefillProduct, setPrefillProduct] = useState<any>(null);
  const [prefillCategory, setPrefillCategory] = useState<any>(null);
  const [stockCommand, setStockCommand] = useState<StockCommand | null>(null);
  const [lastHeard, setLastHeard] = useState("");

  // Voice command (AI)
  const parseCmd = useServerFn(parseProductCommand);

  function cleanProductNameFromCommand(text: string) {
    return text
      .replace(/\bsnoop\b/gi, "")
      .replace(/\b(portami|lleva(?:me)?|apr[eimi]*|abrir|abre|vai|ve|ir|a)\b/gi, "")
      .replace(/\b(crea|crear|creare|nuevo|nuovo|nueva|alta|a[nñ]adir|agregar|registrar)\b/gi, "")
      .replace(/\b(prod(?:u[cç]?t[oa]|ott[oi])|produvto|productos?)\b/gi, "")
      .replace(/\b(en|nel|nella|nello|categoria|categor[ií]a)\b.*$/i, "")
      .replace(/\b(stock|compra|venta|precio|prezzo|indica|sativa|h[ií]brida|hibrida)\b.*$/i, "")
      .replace(/\d+([.,]\d+)?/g, "")
      .replace(/[.,;:!?]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isStockAdjustmentCommand(text: string) {
    const low = compactVoiceText(text)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (/\b(crea|crear|creare|nuevo|nuovo|nueva|alta)\b/.test(low)) return false;
    return (
      (/\b(stock|stok)\b/.test(low) &&
        (/\b(mas|menos|anad|agreg|sum|quit|rest|sac|remov)\w*\b\s+\d/.test(low) ||
          /\d+(?:[.,]\d+)?\s*(?:gramos?|gr|g|u|unidad(?:es)?)?\s+\b(mas|menos|anad|agreg|sum|quit|rest|sac|remov)\w*\b/.test(
            low,
          ) ||
          /[+-]\s*\d/.test(low))) ||
      /^\s*(?:mas|menos|anad|agreg|sum|quit|rest|sac|remov|[+-])\w*\s+\d/i.test(low) ||
      /\b(?:mas|menos|anad|agreg|sum|quit|rest|sac|remov|[+-])\w*\s+\d/i.test(low) ||
      /\b[a-z0-9]{2,}\b\s+(?:mas|menos|anad|agreg|sum|quit|rest|sac|remov|[+-])\w*\s+\d/i.test(low)
    );
  }

  // Fast local parser: fills fields instantly without waiting for AI.
  function localParse(text: string): {
    action: "create_product" | "create_category" | "search" | "none";
    prod?: any;
    cat?: any;
    query?: string;
  } {
    const t = text.trim();
    const low = t.toLowerCase();
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const isProd =
      /\b(crea|crear|creare|nuevo|nuovo|nueva|alta|a[nñ]adir|agregar|registrar)\b[\s\S]{0,25}\b(prod(?:u[cç]?t[oa]|ott[oi])|produvto|productos?)\b/i.test(
        low,
      );
    const isCat =
      /\b(crea|crear|creare|nueva|nuova|alta|a[nñ]adir|agregar)\b[\s\S]{0,25}\b(categor[ií]a|categoria|categorie)\b/i.test(
        low,
      );

    if (isProd) {
      const num = (rx: RegExp) => {
        const m = low.match(rx);
        return m ? parseFloat(m[1].replace(",", ".")) : 0;
      };
      const stock = num(/\bstock\s+(\d+(?:[.,]\d+)?)/i);
      const buy = num(/\b(?:compra|coste|costo)\s+(\d+(?:[.,]\d+)?)/i);
      const sell = num(/\b(?:venta|precio|prezzo|vende|vendita)\s+(\d+(?:[.,]\d+)?)/i);
      const strain = /\bindica\b/i.test(low)
        ? "indica"
        : /\bsativa\b/i.test(low)
          ? "sativa"
          : /\bh[ií]brida\b/i.test(low)
            ? "hibrida"
            : "";
      let category_id = "";
      const catM = low.match(/\ben\s+(?:categor[ií]a\s+)?([a-zá-úñ]+)/i);
      if (catM) {
        const guess = norm(catM[1]);
        const found = cats.find((c) => norm(c.name).includes(guess));
        if (found) category_id = found.id;
      }
      const name = cleanProductNameFromCommand(t);
      return {
        action: "create_product",
        prod: {
          category_id,
          name,
          stock,
          buy_price: buy,
          sell_price: sell,
          strain,
        },
      };
    }

    if (isCat) {
      const name = t
        .replace(
          /\b(crea|crear|creare|nueva|nuova|alta|a[nñ]adir|agregar)\b[\s\S]{0,25}\b(categor[ií]a|categoria|categorie)\b/i,
          "",
        )
        .replace(/\b(de|para|con)\b/gi, "")
        .replace(/\b(gramos?|gr|unidades?|fumables?)\b/gi, "")
        .replace(/[.,;:!?]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const unit_type = /\b(gramos?|gr)\b/i.test(low) ? "gr" : "unit";
      const is_smokeable = /\b(fumables?|flores?|hash|extracci|marihuana|cannabis)\b/i.test(low);
      return {
        action: "create_category",
        cat: { name, unit_type, is_smokeable },
      };
    }

    if (/\b(busca|buscar|buscame|encuentra|cerca|trova)\b/i.test(low)) {
      const query = t
        .replace(/\b(busca(?:me|r)?|encuentra|cerca(?:r|me)?|trova(?:mi)?)\b/gi, "")
        .replace(/[.,;:!?]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return { action: "search", query };
    }

    return { action: "none" };
  }

  async function applyProductCommand(text: string, requestedTab?: TabId) {
    const heard = compactVoiceText(text);
    setLastHeard(heard);
    const fields = productFormVoice(heard, cats);
    if (fields) {
      setPrefillProduct({ ...fields, _at: Date.now() });
      setTab("nuevo");
      return;
    }

    if (requestedTab === "nuevo" || requestedTab === "categoria" || requestedTab === "stock")
      setTab(requestedTab);

    // 1) Fast local parse — fill fields immediately.
    const local = localParse(heard);
    if (local.action === "create_product") {
      const complete =
        !!local.prod?.category_id &&
        !!local.prod?.name &&
        local.prod?.stock > 0 &&
        local.prod?.sell_price > 0;
      setPrefillProduct({ ...local.prod, _at: Date.now() });
      setTab("nuevo");
      toast.success(complete ? "Producto listo para revisar" : "Producto pre-rellenado");
    } else if (local.action === "create_category") {
      const complete = !!local.cat?.name;
      setPrefillCategory({ ...local.cat, _at: Date.now() });
      setTab("categoria");
      toast.success(complete ? "Categoría lista para revisar" : "Categoría pre-rellenada");
    } else if (local.action === "search") {
      setTab("stock");
      setStockSearch(local.query || text);
    } else if (isStockAdjustmentCommand(heard)) {
      setTab("stock");
      setStockCommand({ text: heard, at: Date.now() });
      toast.info("Movimiento de stock listo para revisar");
      return;
    }

    // 2) AI refinement in background — improves category match / name.
    try {
      const cmd = await parseCmd({
        data: {
          transcript: heard,
          categories: cats.map((c) => ({
            id: c.id,
            name: c.name,
            unit_type: c.unit_type,
            is_smokeable: c.is_smokeable,
          })),
        },
      });
      if (cmd.action === "search" && local.action === "none") {
        setTab("stock");
        setStockSearch(cmd.query || heard);
      } else if (cmd.action === "create_category") {
        const merged = {
          name: cmd.category_name || local.cat?.name || "",
          unit_type: cmd.unit_type || local.cat?.unit_type || "unit",
          is_smokeable: cmd.is_smokeable || local.cat?.is_smokeable || false,
        };
        setPrefillCategory({ ...merged, _at: Date.now() });
        setTab("categoria");
      } else if (cmd.action === "create_product") {
        const merged = {
          category_id: cmd.category_id || local.prod?.category_id || "",
          name: cmd.product_name || local.prod?.name || cleanProductNameFromCommand(heard),
          stock: cmd.stock || local.prod?.stock || 0,
          buy_price: cmd.buy_price || local.prod?.buy_price || 0,
          sell_price: cmd.sell_price || local.prod?.sell_price || 0,
          strain: cmd.strain || local.prod?.strain || "",
        };
        setPrefillProduct({ ...merged, _at: Date.now() });
        setTab("nuevo");
      } else if (requestedTab && local.action === "none") {
        if (requestedTab === "nuevo")
          setPrefillProduct({
            name: cleanProductNameFromCommand(heard),
            _at: Date.now(),
          });
        setTab(requestedTab);
      }
    } catch (e: any) {
      if (local.action === "none") {
        if (requestedTab === "nuevo") {
          setPrefillProduct({
            name: cleanProductNameFromCommand(heard),
            _at: Date.now(),
          });
          setTab("nuevo");
        } else if (!requestedTab) toast.error(e?.message || "Error de voz");
      }
    }
  }

  async function load() {
    const request = ++catalogRequest.current;
    if (authLoading || accessError || !access.clubId || !can("manage_products")) return;
    setLoading(true);
    setCatalogError("");
    try {
      const result = await loadAdministrativeCatalog(supabase, access.clubId);
      if (request !== catalogRequest.current) return;
      setCats(result.categories);
      setProds(result.products);
      setLoadedScope(catalogScope);
    } catch {
      if (request !== catalogRequest.current) return;
      setCatalogError("No se pudo cargar el catálogo. Vuelve a intentarlo.");
    } finally {
      if (request === catalogRequest.current) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    return () => {
      catalogRequest.current++;
    };
    // A transient access error hides the existing form in SnoopLayout. Retrying
    // that same verified scope must not reload/unmount it and erase its draft.
    // Identity, club or permission changes still trigger a fresh scoped read.
  }, [catalogScope, authLoading]);

  // Reacciona a Snoop cuando navega aquí pidiendo un tab y/o un comando
  useEffect(() => {
    if (loading) return;
    try {
      const wantedTab = window.localStorage.getItem("snoop:productos-tab");
      if (wantedTab === "nuevo" || wantedTab === "categoria" || wantedTab === "stock") {
        setTab(wantedTab as TabId);
        window.localStorage.removeItem("snoop:productos-tab");
      }
      const cmdRaw = window.sessionStorage.getItem("snoop:productos-cmd");
      if (cmdRaw) {
        const { text, at } = JSON.parse(cmdRaw);
        window.sessionStorage.removeItem("snoop:productos-cmd");
        if (Date.now() - at < 15000) {
          applyProductCommand(text, wantedTab as TabId | undefined);
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cats]);

  useEffect(() => {
    if (loading) return;
    function onCommand(e: Event) {
      const detail = (e as CustomEvent).detail as { text?: string; tab?: TabId } | undefined;
      const text = detail?.text?.trim();
      if (!text) return;
      applyProductCommand(text, detail?.tab);
    }
    window.addEventListener("snoop:productos-command", onCommand as EventListener);
    return () => window.removeEventListener("snoop:productos-command", onCommand as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cats]);

  return (
    <SnoopLayout title="Productos" subtitle="Stock, categorías y altas">
      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 mb-4 sm:mb-6 sm:flex-wrap scrollbar-thin">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 sm:px-4 py-2 rounded-lg text-[11px] sm:text-xs uppercase tracking-[0.18em] font-display border transition ${
              tab === t.id
                ? "border-neon text-neon bg-neon/10 glow-neon-soft"
                : "border-border text-muted-foreground hover:text-neon hover:border-neon/40"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {catalogError ? (
        <div role="alert" className="space-y-2">
          <p>{catalogError}</p>
          <button onClick={load} className="text-neon">
            Reintentar catálogo
          </button>
        </div>
      ) : authLoading || loading || loadedScope !== catalogScope ? (
        <div className="text-muted-foreground">Cargando…</div>
      ) : tab === "stock" ? (
        <Stock
          cats={cats.filter((c) => !c.archived)}
          prods={prods.filter(
            (p) => p.active !== false && !cats.find((c) => c.id === p.category_id)?.archived,
          )}
          onChange={load}
          search={stockSearch}
          setSearch={setStockSearch}
          stockCommand={stockCommand}
          clearStockCommand={() => setStockCommand(null)}
        />
      ) : tab === "nuevo" ? (
        <NuevoProducto
          cats={cats.filter((c) => !c.archived)}
          onCreated={load}
          onVoice={applyProductCommand}
          prefill={prefillProduct}
          clearPrefill={() => setPrefillProduct(null)}
        />
      ) : (
        <NuevaCategoria
          categories={cats}
          products={prods}
          onCreated={load}
          prefill={prefillCategory}
          clearPrefill={() => setPrefillCategory(null)}
        />
      )}
      {loadedScope === catalogScope &&
        !catalogError &&
        !loading &&
        prods.some((p) => p.active === false) && (
          <div className="mt-5 border border-border p-3 rounded space-y-2">
            <h3 className="text-sm text-neon">Productos archivados</h3>
            {prods
              .filter((p) => p.active === false)
              .map((p) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span>{p.name}</span>
                  <button
                    className="text-neon"
                    onClick={async () => {
                      if (!confirm(`¿Reactivar ${p.name}?`)) return;
                      const { error } = await supabase
                        .from("products")
                        .update({ active: true })
                        .eq("id", p.id)
                        .eq("club_id", p.club_id);
                      if (error) toast.error(error.message);
                      else load();
                    }}
                  >
                    Reactivar producto
                  </button>
                </div>
              ))}
          </div>
        )}
    </SnoopLayout>
  );
}

/* ---------------- STOCK ---------------- */

function Stock({
  cats,
  prods,
  onChange,
  search,
  setSearch,
  stockCommand,
  clearStockCommand,
}: {
  cats: Category[];
  prods: Product[];
  onChange: () => void;
  search: string;
  setSearch: (v: string) => void;
  stockCommand: StockCommand | null;
  clearStockCommand: () => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [manualProductId, setManualProductId] = useState("");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [pendingAdj, setPendingAdj] = useState<{
    prod: Product;
    delta: number;
    newStock: number;
    raw: string;
  } | null>(null);
  const [pendingChoice, setPendingChoice] = useState<{
    delta: number;
    raw: string;
    candidates: Product[];
  } | null>(null);
  const dict = useDictation((t) => applyVoice(t));

  const q = norm(search);

  function norm(s: string) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }
  async function applyVoice(text: string) {
    const raw = compactVoiceText(text.trim());
    const t = norm(raw)
      .replace(/[.,;:!?]+$/g, "")
      .replace(/\b(stok)\b/g, "stock")
      .replace(/\b(stock)(?:\s+\1\b)+/g, "$1")
      .replace(
        /\bstock\s+(?=(?:mas|menos|a[nñ]ad\w*|agreg\w*|sum\w*|quit\w*|rest\w*|sac\w*|remov\w*|\+|-))/g,
        "",
      )
      .trim();
    if (!t) return;

    // --- Stock adjustment: "stock <nombre> añadir/quitar N", "más 10 gr amnesia", "amnesia +10"
    const adjRx =
      /^(?:stock\s+)?(.+?)\s+(a[nñ]ad\w*|agreg\w*|sum\w*|mas|\+|quit\w*|rest\w*|menos|-|remov\w*|sac\w*)\s+(\d+(?:[.,]\d+)?)\s*(?:gramos?|gr|g|unidades?|unidad|u)?\b(?:\s+(?:gramos?|gr|g|unidades?|unidad|u)\b)*$/i;
    const addToRx =
      /^(?:stock\s+)?(?:a[nñ]ad\w*|sum\w*|agreg\w*|met\w*|pon\w*|mas|\+)\s+(\d+(?:[.,]\d+)?)\s*(?:gramos?|gr|g|unidades?|unidad|u)?\b(?:\s+(?:al|del|a|en|de)\b)?\s*(.*?)(?:\s+(?:gramos?|gr|g|unidades?|unidad|u)\b)*$/i;
    const removeFromRx =
      /^(?:stock\s+)?(?:quit\w*|rest\w*|sac\w*|remov\w*|menos|-)\s+(\d+(?:[.,]\d+)?)\s*(?:gramos?|gr|g|unidades?|unidad|u)?\b(?:\s+(?:del|al|de|a|en)\b)?\s*(.*?)(?:\s+(?:gramos?|gr|g|unidades?|unidad|u)\b)*$/i;
    const qtyFirstRx =
      /^(?:stock\s+)?(\d+(?:[.,]\d+)?)\s*(?:gramos?|gr|g|unidades?|unidad|u)?\b\s+(mas|menos|a[nñ]ad\w*|agreg\w*|sum\w*|quit\w*|rest\w*|sac\w*|remov\w*|\+|-)\s*(.*?)(?:\s+(?:gramos?|gr|g|unidades?|unidad|u)\b)*$/i;

    let adjName = "";
    let adjSign = 0;
    let adjQty = 0;
    let m = t.match(adjRx);
    if (m) {
      adjName = m[1];
      const op = m[2].toLowerCase();
      adjSign = /a[nñ]ad|sumar|mas|\+/.test(op) ? 1 : -1;
      adjQty = parseFloat(m[3].replace(",", "."));
    } else if ((m = t.match(addToRx))) {
      adjSign = 1;
      adjQty = parseFloat(m[1].replace(",", "."));
      adjName = m[2];
    } else if ((m = t.match(removeFromRx))) {
      adjSign = -1;
      adjQty = parseFloat(m[1].replace(",", "."));
      adjName = m[2];
    } else if ((m = t.match(qtyFirstRx))) {
      adjQty = parseFloat(m[1].replace(",", "."));
      const op = m[2].toLowerCase();
      adjSign = /a[nñ]ad|agreg|sum|mas|\+/.test(op) ? 1 : -1;
      adjName = m[3];
    }

    if (adjQty > 0 && adjSign !== 0) {
      const target = norm(adjName)
        .replace(/\b(stock|gramos?|gr|g|unidades?|unidad|u)\b/g, " ")
        .replace(/^(el|la|los|las)\s+/, "")
        .replace(/\s+/g, " ")
        .trim();
      const visible = prods.filter((p) => {
        if (filter !== "all" && p.category_id !== filter) return false;
        if (q && !norm(p.name).includes(norm(q))) return false;
        return true;
      });
      const prod = target
        ? prods.find((p) => {
            const n = norm(p.name);
            return n === target || n.includes(target) || target.includes(n);
          })
        : visible.length === 1
          ? visible[0]
          : null;
      if (!prod) {
        const delta = adjSign * adjQty;
        if (!target && visible.length > 1) {
          setPendingChoice({ delta, raw, candidates: visible.slice(0, 12) });
          toast.info("Elige el producto y confirma el movimiento");
          return;
        }
        toast.error(
          target ? `Producto no encontrado: ${adjName}` : "Di también el nombre del producto",
        );
        return;
      }
      const delta = adjSign * adjQty;
      const newStock = Number(prod.stock) + delta;
      if (newStock < 0) {
        toast.error(`Stock insuficiente (${prod.stock}) para restar ${adjQty}`);
        return;
      }
      // Stage the change: user must confirm before we write it.
      setPendingChoice(null);
      setPendingAdj({ prod, delta, newStock, raw });
      toast.info(`Revisa y confirma: ${prod.name} ${delta > 0 ? "+" : ""}${delta}`);
      return;
    }

    // Strip filler verbs for category / search matching
    const cleaned = t
      .replace(
        /^(ver|mostrar|abre|abrir|categor[ií]a|filtra|filtrar|ir a|ve a|busca|buscar|buscame|stock)\s+/i,
        "",
      )
      .trim();
    const match = cats.find((c) => {
      const n = norm(c.name);
      return n === cleaned || n.includes(cleaned) || cleaned.includes(n);
    });
    if (match) {
      setFilter(match.id);
      setSearch("");
      toast.success(`Categoría: ${match.name}`);
      return;
    }
    if (/^(todas|todo|todos|all)$/i.test(cleaned)) {
      setFilter("all");
      setSearch("");
      return;
    }
    setFilter("all");
    setSearch(cleaned);
  }

  useEffect(() => {
    if (!stockCommand) return;
    applyVoice(stockCommand.text);
    clearStockCommand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockCommand?.at]);

  // Listen to voice agent broadcasts
  useEffect(() => {
    function onVoice(e: any) {
      applyVoice(String(e?.detail?.text || ""));
    }
    window.addEventListener("snoop:productos-voice", onVoice);
    // Pending filter from another route
    try {
      const raw = window.sessionStorage.getItem("snoop:productos-pending");
      if (raw) {
        const { text, at } = JSON.parse(raw);
        if (Date.now() - at < 10000) applyVoice(text);
        window.sessionStorage.removeItem("snoop:productos-pending");
      }
    } catch {}
    return () => window.removeEventListener("snoop:productos-voice", onVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of prods) {
      if (filter !== "all" && p.category_id !== filter) continue;
      if (q && !norm(p.name).includes(q)) continue;
      const arr = map.get(p.category_id) ?? [];
      arr.push(p);
      map.set(p.category_id, arr);
    }
    return map;
  }, [prods, filter, q]);

  if (cats.length === 0)
    return (
      <div className="bg-card/60 border border-neon/20 rounded-2xl p-8 text-center">
        <Tag className="w-8 h-8 mx-auto text-neon mb-3" />
        <p className="text-sm text-muted-foreground">
          Aún no hay categorías. Crea una primero desde{" "}
          <strong className="text-neon">Crear categoría</strong>.
        </p>
      </div>
    );

  async function confirmPending() {
    if (!pendingAdj) return;
    const { prod, delta, newStock, raw } = pendingAdj;
    const { error } = await (supabase as any).rpc("adjust_administrative_stock", {
      p_id: prod.id,
      p_delta: Math.round(delta * 100) / 100,
      p_expected: Number(prod.stock),
      p_notes: raw,
    });
    if (error) return toast.error(error.message);
    toast.success(`${prod.name}: ${delta > 0 ? "+" : ""}${delta} → ${newStock}`);
    setPendingAdj(null);
    onChange();
  }

  function choosePendingProduct(prod: Product) {
    if (!pendingChoice) return;
    const newStock = Math.round((Number(prod.stock) + pendingChoice.delta) * 100) / 100;
    if (newStock < 0) {
      toast.error(`Stock insuficiente (${prod.stock})`);
      return;
    }
    setPendingAdj({
      prod,
      delta: pendingChoice.delta,
      newStock,
      raw: pendingChoice.raw,
    });
    setPendingChoice(null);
  }

  return (
    <div className="space-y-6">
      {pendingChoice && (
        <div className="rounded-2xl border-2 border-neon bg-neon/10 p-4 glow-neon-soft">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">
                Elige producto
              </div>
              <div className="text-sm text-foreground">
                Movimiento:{" "}
                <span className={pendingChoice.delta > 0 ? "text-neon" : "text-destructive"}>
                  {pendingChoice.delta > 0 ? "+" : ""}
                  {pendingChoice.delta}
                </span>
              </div>
              <div className="text-xs italic text-muted-foreground truncate">
                "{pendingChoice.raw}"
              </div>
            </div>
            <button
              onClick={() => setPendingChoice(null)}
              className="px-3 py-1.5 rounded-lg border border-border text-xs uppercase tracking-widest text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {pendingChoice.candidates.map((p) => (
              <button
                key={p.id}
                onClick={() => choosePendingProduct(p)}
                className="text-left rounded-lg bg-input/40 border border-border px-3 py-2 hover:border-neon"
              >
                <div className="text-sm text-foreground truncate">{p.name}</div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Stock actual {Number(p.stock).toFixed(2)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingAdj && (
        <div className="rounded-2xl border-2 border-neon bg-neon/10 p-4 flex flex-col sm:flex-row sm:items-center gap-3 glow-neon-soft">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">
              Confirmar movimiento
            </div>
            <div className="text-sm">
              <strong className="text-neon">{pendingAdj.prod.name}</strong>: {pendingAdj.prod.stock}{" "}
              → <strong>{pendingAdj.newStock}</strong>{" "}
              <span className={pendingAdj.delta > 0 ? "text-neon" : "text-destructive"}>
                ({pendingAdj.delta > 0 ? "+" : ""}
                {pendingAdj.delta})
              </span>
            </div>
            <div className="text-xs italic text-muted-foreground truncate">"{pendingAdj.raw}"</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmPending}
              className="px-4 py-2 rounded-lg bg-gradient-neon text-primary-foreground text-xs uppercase tracking-widest font-display glow-neon"
            >
              Confirmar
            </button>
            <button
              onClick={() => setPendingAdj(null)}
              className="px-4 py-2 rounded-lg border border-border text-xs uppercase tracking-widest text-muted-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Stock corrections are adjustments, never deletions of audit history. */}
      <div className="rounded-xl border border-neon/30 bg-card/60 p-4 space-y-3">
        <h3 className="font-display text-sm text-neon uppercase tracking-wide">Corregir stock</h3>
        <p className="text-xs text-muted-foreground">
          Selecciona un producto y la cantidad final. El movimiento queda registrado en el
          historial.
        </p>
        <select
          aria-label="Producto para ajustar stock"
          value={manualProductId}
          onChange={(e) => setManualProductId(e.target.value)}
          className="w-full rounded-lg bg-input border border-border p-2 text-sm"
        >
          <option value="">Selecciona producto</option>
          {prods.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} — actual: {product.stock}
            </option>
          ))}
        </select>
        <input
          aria-label="Cantidad final de stock"
          type="number"
          min="0"
          step="any"
          placeholder="Cantidad final"
          value={manualQuantity}
          onChange={(e) => setManualQuantity(e.target.value)}
          className="w-full rounded-lg bg-input border border-border p-2 text-sm"
        />
        <input
          aria-label="Motivo de la corrección"
          maxLength={160}
          placeholder="Motivo de la corrección"
          value={manualReason}
          onChange={(e) => setManualReason(e.target.value)}
          className="w-full rounded-lg bg-input border border-border p-2 text-sm"
        />
        <button
          type="button"
          className="rounded-lg border border-neon/50 px-4 py-2 text-sm text-neon"
          onClick={() => {
            const product = prods.find((p) => p.id === manualProductId);
            const quantity = Number(manualQuantity);
            if (
              !product ||
              manualQuantity.trim() === "" ||
              !Number.isFinite(quantity) ||
              quantity < 0 ||
              Math.round(quantity * 100) / 100 !== quantity
            )
              return toast.error("Selecciona un producto y una cantidad válida");
            if (!manualReason.trim())
              return toast.error("Indica un motivo para conservar el historial");
            const delta = Math.round((quantity - Number(product.stock)) * 100) / 100;
            if (delta === 0) return toast.info("El stock ya tiene esa cantidad");
            setPendingAdj({
              prod: product,
              delta,
              newStock: quantity,
              raw: `Corrección manual: ${manualReason.trim()}`,
            });
            toast.info("Revisa el movimiento y pulsa Confirmar");
          }}
        >
          Preparar corrección
        </button>
      </div>

      {/* Search bar (works on all categories) */}
      <div className="flex items-center gap-2 bg-input/40 border border-border rounded-lg px-3 py-2 focus-within:border-neon">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar en todos los productos…"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <button
          disabled={dict.busy}
          onClick={dict.listening ? dict.stop : dict.start}
          className={`p-1.5 rounded ${dict.listening ? "text-neon glow-neon" : "text-muted-foreground hover:text-neon"}`}
          title="Dictar búsqueda"
        >
          {dict.listening ? (
            <Square className="w-4 h-4 fill-current" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border ${
            filter === "all" ? "border-neon text-neon" : "border-border text-muted-foreground"
          }`}
        >
          Todas
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] uppercase tracking-widest border ${
              filter === c.id ? "border-neon text-neon" : "border-border text-muted-foreground"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <StockHistory products={prods} key={prods.map((p) => p.id + ":" + p.stock).join(",")} />
      {cats
        .filter((c) => filter === "all" || c.id === filter)
        .map((c) => {
          const list = grouped.get(c.id) ?? [];
          return (
            <div key={c.id} className="bg-card/60 border border-neon/20 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-display text-lg text-neon tracking-wide">{c.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.unit_type === "gr" ? "Gramos" : "Unidades"}
                    {c.is_smokeable && " · fumable"}
                  </div>
                </div>
              </div>
              {list.length === 0 ? (
                <div className="text-xs text-muted-foreground">Sin productos.</div>
              ) : (
                <div className="space-y-2">
                  {list.map((p) => (
                    <ProductRow key={p.id} p={p} cat={c} onChange={onChange} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}

function StockHistory({ products }: { products: Product[] }) {
  const [people, setPeople] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("stock_movements")
      .select("id,product_id,delta,reason,notes,created_by,created_at")
      .order("created_at", { ascending: false })
      .limit(100)
      .then(async ({ data, error }) => {
        const ids = [...new Set((data ?? []).map((r) => r.created_by).filter(Boolean))] as string[];
        if (ids.length) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id,full_name")
            .in("id", ids);
          if (!cancelled)
            setPeople(
              Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name || "Colaborador"])),
            );
        }
        if (!cancelled) {
          setRows(data ?? []);
          setError(error ? "No se pudo cargar el historial" : "");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <details className="rounded-xl border border-border p-3">
      <summary className="text-sm text-neon">Historial de inventario (últimos 100)</summary>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <div key={r.id} className="text-xs border-t border-border py-2 break-words">
          {new Date(r.created_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} ·{" "}
          {products.find((p) => p.id === r.product_id)?.name ?? "Producto archivado"} ·{" "}
          {Number(r.delta) > 0 ? "+" : ""}
          {r.delta} · {r.reason} · {r.notes} · Operador: {people[r.created_by] ?? "Colaborador"}
        </div>
      ))}
    </details>
  );
}

function ProductRow({ p, cat, onChange }: { p: Product; cat: Category; onChange: () => void }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Product>(p);
  const [enriching, setEnriching] = useState(false);
  const [proposal, setProposal] = useState<Awaited<ReturnType<typeof enrichProduct>> | null>(null);
  const [chosenDescription, setChosenDescription] = useState("");
  const [chosenImage, setChosenImage] = useState<CatalogImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const enrich = useServerFn(enrichProduct);
  useEffect(() => setForm(p), [p]);

  async function save(values: Product = form) {
    const { error } = await (supabase as any).rpc("save_administrative_product_checked", {
      p_id: p.id,
      p_expected: Number(p.stock),
      p_values: {
        name: values.name,
        category_id: cat.id,
        stock: Number(p.stock),
        buy_price: values.buy_price,
        sell_price: values.sell_price,
        strain: cat.is_smokeable ? values.strain : null,
        notes: values.notes,
        description: values.description,
        image_url: values.image_url,
        image_attribution: values.image_attribution ?? null,
      },
    });
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("Producto actualizado");
    setEdit(false);
    onChange();
    return true;
  }
  async function remove() {
    if (!confirm(`¿Archivar ${p.name}? Se conservarán su stock y todo el historial.`)) return;
    const { error } = await supabase
      .from("products")
      .update({ active: false })
      .eq("id", p.id)
      .eq("club_id", p.club_id);
    if (error) return toast.error(error.message);
    toast.success("Producto archivado; historial conservado");
    onChange();
  }
  async function runEnrich() {
    setEnriching(true);
    try {
      const r = await enrich({
        data: {
          name: p.name,
          // Stored strain is a classification (indica/sativa), not the lookup name.
          strain: "",
          is_smokeable: cat.is_smokeable,
          category_name: cat.name,
        },
      });
      setProposal(r);
      setChosenDescription("");
      setChosenImage(null);
      if (r.warning) toast.info(r.warning);
    } catch (e: any) {
      toast.error(e?.message ?? "Error enriqueciendo");
    } finally {
      setEnriching(false);
    }
  }

  const proposalView = proposal && (
    <div className="border border-neon/40 rounded p-3 space-y-3">
      <p className="text-xs text-neon">Propuesta de ficha — revisa antes de guardar</p>
      <p className="text-xs text-muted-foreground">Borrador IA sin verificación externa</p>
      <textarea
        aria-label="Descripción propuesta"
        className="w-full bg-input border border-border p-2 text-sm"
        value={proposal.description}
        onChange={(event) => {
          setChosenDescription("");
          setProposal({ ...proposal, description: event.target.value });
        }}
      />
      {proposal.descriptions?.map((candidate) => (
        <label
          key={candidate.source}
          className="block rounded border border-border p-2 text-xs space-y-2"
        >
          <input
            type="radio"
            name={`catalog-description-${p.id}`}
            checked={chosenDescription === candidate.source}
            onChange={() => {
              setChosenDescription(candidate.source);
              setProposal({
                ...proposal,
                description: candidate.excerpt + "\nFuente: " + candidate.source,
              });
            }}
          />
          <span>{candidate.excerpt}</span>
          <a
            className="block text-neon underline"
            href={candidate.source}
            target="_blank"
            rel="noreferrer"
          >
            {candidate.title} — Fuente
          </a>
        </label>
      ))}
      <p className="text-xs text-muted-foreground">{proposal.warning}</p>
      {proposal.images?.map((image) => (
        <label key={image.url} className="block text-xs space-y-1">
          <input
            type="radio"
            name={`catalog-image-${p.id}`}
            checked={chosenImage?.url === image.url}
            onChange={() => setChosenImage(image)}
          />{" "}
          Seleccionar tras comprobar coincidencia exacta
          <img
            src={image.url}
            alt={image.title}
            referrerPolicy="no-referrer"
            className="w-24 h-24 object-contain"
          />
          <a href={image.source} target="_blank" rel="noreferrer" className="text-neon underline">
            {image.title}
          </a>
          <span>
            {" "}
            — {image.author} — {image.license}
          </span>
        </label>
      ))}
      <button
        disabled={busy || (!proposal.description && !chosenImage && !chosenDescription)}
        className="text-neon border border-neon/40 rounded p-2 text-xs"
        onClick={async () => {
          setBusy(true);
          try {
            const patch: any = {};
            const selected = proposal.descriptions?.find(
              (candidate) => candidate.source === chosenDescription,
            );
            if (selected) patch.description = selected.excerpt + "\nFuente: " + selected.source;
            else if (proposal.description) patch.description = proposal.description;
            if (chosenImage) {
              patch.image_url = chosenImage.url;
              patch.image_attribution = chosenImage;
            }
            if (edit) {
              if (await save({ ...form, ...patch })) setProposal(null);
              return;
            }
            const { error } = await supabase
              .from("products")
              .update(patch)
              .eq("id", p.id)
              .eq("club_id", p.club_id);
            if (error) throw error;
            setProposal(null);
            toast.success("Propuesta confirmada");
            onChange();
          } catch (e: any) {
            toast.error(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Confirmar ficha
      </button>
      <button onClick={() => setProposal(null)} className="text-xs p-2">
        Cancelar propuesta
      </button>
    </div>
  );

  if (!edit) {
    return (
      <div className="rounded-lg bg-input/40 p-3 space-y-3">
        {proposalView}
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-md bg-background/60 border border-border overflow-hidden flex items-center justify-center shrink-0">
            {p.image_url ? (
              <img
                src={p.image_url}
                alt={p.name}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            ) : (
              <ImageIcon className="w-5 h-5 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm text-foreground truncate">
              {p.name}
              {p.strain && (
                <span className="ml-2 text-[10px] uppercase tracking-widest text-neon-dim">
                  {p.strain}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Stock:{" "}
              <span className="text-foreground">
                {Number(p.stock)} {cat.unit_type === "gr" ? "gr" : "u"}
              </span>
              {" · "}Compra: €{Number(p.buy_price).toFixed(2)} · Venta: €
              {Number(p.sell_price).toFixed(2)}
            </div>
            {p.image_attribution && (
              <a
                href={p.image_attribution.source}
                target="_blank"
                rel="noreferrer"
                className="block text-[10px] text-neon underline"
              >
                {p.image_attribution.author} · {p.image_attribution.license}
              </a>
            )}
            {p.description && (
              <div className="text-[11px] text-muted-foreground mt-1">
                <div className={expanded ? "whitespace-pre-wrap" : "line-clamp-2"}>
                  {p.description}
                </div>
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-0.5 text-neon hover:underline text-[10px] uppercase tracking-widest"
                >
                  {expanded ? "Leer menos" : "Leer más"}
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-1 shrink-0">
            <button
              onClick={runEnrich}
              disabled={enriching}
              className="p-2 text-muted-foreground hover:text-neon disabled:opacity-50"
              title="Proponer descripción e imágenes con licencia"
            >
              {enriching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
            </button>
            <button
              aria-label={`Editar ${p.name}`}
              onClick={() => setEdit(true)}
              className="p-2 text-muted-foreground hover:text-neon"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              aria-label={`Archivar ${p.name}`}
              onClick={remove}
              className="p-2 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-input/40 rounded-lg p-3 space-y-2">
      <button
        type="button"
        title="Proponer descripción e imágenes con licencia"
        onClick={runEnrich}
        disabled={enriching}
        className="text-neon p-2"
      >
        {enriching ? "Buscando…" : "✨"}
      </button>
      {proposalView}
      <input
        className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
        aria-label="Nombre del producto"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <div className="grid grid-cols-3 gap-2">
        <p className="text-xs">Stock: {p.stock}. Usa Corregir stock para registrar cambios.</p>
        <MoneyField
          label="Compra €"
          value={form.buy_price}
          onChange={(v) => setForm({ ...form, buy_price: v })}
        />
        <MoneyField
          label="Venta €"
          value={form.sell_price}
          onChange={(v) => setForm({ ...form, sell_price: v })}
        />
      </div>
      <label className="block text-xs">
        Descripción manual
        <textarea
          aria-label="Descripción manual"
          value={form.description ?? ""}
          maxLength={2000}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="block w-full bg-input border border-border p-2"
        />
      </label>
      <label className="block text-xs">
        Cargar imagen propia (JPG, PNG, WebP, máx. 5 MB)
        <input
          aria-label="Cargar imagen propia"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const image = await readCatalogImage(file);
              setForm({ ...form, image_url: image, image_attribution: null });
            } catch (error: any) {
              toast.error(error.message);
            }
            e.target.value = "";
          }}
        />
      </label>
      {cat.is_smokeable && (
        <select
          value={form.strain ?? ""}
          onChange={(e) =>
            setForm({
              ...form,
              strain: (e.target.value || null) as Strain | null,
            })
          }
          className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
        >
          <option value="">— tipo —</option>
          <option value="indica">Indica</option>
          <option value="sativa">Sativa</option>
          <option value="hibrida">Híbrida</option>
        </select>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => {
            setEdit(false);
            setForm(p);
          }}
          className="px-3 py-1.5 text-xs border border-border rounded"
        >
          <X className="w-3 h-3 inline mr-1" /> Cancelar
        </button>
        <button
          onClick={() => save()}
          className="px-3 py-1.5 text-xs bg-gradient-neon text-primary-foreground rounded font-semibold"
        >
          <Save className="w-3 h-3 inline mr-1" /> Guardar
        </button>
      </div>
    </div>
  );
}

// Keep the user's decimal text while editing: converting on every keystroke
// turns "3." into 3 and makes entering "3.2" impossible on mobile.
function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [raw, setRaw] = useState(() => (value === 0 ? "" : String(value)));
  useEffect(() => {
    setRaw(value === 0 ? "" : String(value));
  }, [value]);
  return (
    <label className="block min-w-0">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        placeholder="0,00"
        value={raw}
        onChange={(event) => {
          const input = event.target.value.replace(",", ".");
          if (!/^\d*(?:\.\d{0,2})?$/.test(input)) return;
          // A typed zero must not remain as a prefix: 0 → 03 → 03.2
          // becomes 0 → 3 → 3.2, preserving 0.25 and decimal input.
          const next = input.replace(/^0+(?=\d)/, "");
          setRaw(next);
          onChange(next === "" || next === "." ? 0 : Number(next));
        }}
        onBlur={() => setRaw(value === 0 ? "" : value.toFixed(2))}
        className="w-full min-w-0 bg-input border border-border rounded-lg px-2 py-2 text-sm"
      />
    </label>
  );
}

/* ---------------- NUEVO PRODUCTO ---------------- */

function NuevoProducto({
  cats,
  onCreated,
  prefill,
  clearPrefill,
  onVoice,
}: {
  onVoice: (text: string) => void;
  cats: Category[];
  onCreated: () => void;
  prefill: any;
  clearPrefill: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [stock, setStock] = useState(0);
  const [buy, setBuy] = useState(0);
  const [sell, setSell] = useState(0);
  const [strain, setStrain] = useState<Strain | "">("");
  const [saving, setSaving] = useState(false);
  const cat = cats.find((c) => c.id === categoryId);

  useEffect(() => {
    if (!prefill) return;
    if (typeof prefill.category_id === "string") setCategoryId(prefill.category_id);
    if (typeof prefill.name === "string") setName(prefill.name);
    if (typeof prefill.stock === "number") setStock(prefill.stock);
    if (typeof prefill.buy_price === "number") setBuy(prefill.buy_price);
    if (typeof prefill.sell_price === "number") setSell(prefill.sell_price);
    if (typeof prefill.strain === "string") setStrain(prefill.strain as Strain);
    clearPrefill();
  }, [prefill]);

  const nameDict = useDictation((t) => {
    if (productFormVoice(t, cats)) onVoice(t);
    else if (/\b(crea|crear|creare|categoria|categoría|cantidad|quantità)\b/i.test(t))
      toast.error("No identifiqué los campos. Revisa el dictado.");
    else setName(t.trim().slice(0, 120));
  });

  const enrich = useServerFn(enrichProduct);

  async function submit() {
    if (!categoryId) return toast.error("Selecciona categoría");
    if (!name.trim()) return toast.error("Nombre obligatorio");
    setSaving(true);
    const { getCurrentClubId } = await import("@/lib/club");
    const clubId = await getCurrentClubId();
    if (!clubId) {
      setSaving(false);
      return toast.error("No tienes un club asignado");
    }
    const productName = name.trim();
    const { error } = await (supabase as any).rpc("save_administrative_product", {
      p_id: null,
      p_values: {
        category_id: categoryId,
        name: productName,
        stock,
        buy_price: buy,
        sell_price: sell,
        strain: cat?.is_smokeable && strain ? strain : null,
      },
    });
    if (error) {
      setSaving(false);
      return toast.error(error.message);
    }
    toast.success("Producto creado. Puedes solicitar una propuesta de IA desde la ficha.");
    setName("");
    setStock(0);
    setBuy(0);
    setSell(0);
    setStrain("");
    setSaving(false);
    onCreated();
  }
  if (cats.length === 0)
    return (
      <div className="bg-card/60 border border-neon/20 rounded-2xl p-8 text-center">
        <p className="text-sm text-muted-foreground">Crea primero una categoría.</p>
      </div>
    );

  return (
    <div
      data-snoop-product-form
      className="max-w-xl bg-card/60 border border-neon/20 rounded-2xl p-6 space-y-4"
    >
      <Field label="Categoría">
        <select
          aria-label="Categoría"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none"
        >
          <option value="">— elegir —</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.unit_type === "gr" ? "gr" : "u"})
            </option>
          ))}
        </select>
      </Field>

      <Field label="Nombre del producto">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ej. Amnesia Haze"
            className="flex-1 bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none"
          />
          <button
            type="button"
            disabled={nameDict.busy}
            onClick={nameDict.listening ? nameDict.stop : nameDict.start}
            className={`px-3 rounded-lg border ${nameDict.listening ? "border-neon text-neon glow-neon" : "border-border text-muted-foreground"}`}
            title="Dictar nombre"
          >
            {nameDict.listening ? (
              <Square className="w-4 h-4 fill-current" />
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </button>
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <MoneyField
          label={`Stock${cat ? ` (${cat.unit_type})` : ""}`}
          value={stock}
          onChange={setStock}
        />
        <MoneyField label="P. compra €" value={buy} onChange={setBuy} />
        <MoneyField label="P. venta €" value={sell} onChange={setSell} />
      </div>

      {cat?.is_smokeable && (
        <Field label="Tipo (fumable)">
          <select
            value={strain}
            onChange={(e) => setStrain(e.target.value as Strain | "")}
            className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none"
          >
            <option value="">— sin especificar —</option>
            <option value="indica">Indica</option>
            <option value="sativa">Sativa</option>
            <option value="hibrida">Híbrida</option>
          </select>
        </Field>
      )}

      <button
        onClick={submit}
        disabled={saving}
        className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
      >
        <Plus className="w-4 h-4 inline mr-2" /> {saving ? "Creando…" : "Crear producto"}
      </button>
    </div>
  );
}

/* ---------------- NUEVA CATEGORIA ---------------- */

function NuevaCategoria({
  categories,
  products,
  onCreated,
  prefill,
  clearPrefill,
}: {
  categories: Category[];
  products: Product[];
  onCreated: () => void;
  prefill: any;
  clearPrefill: () => void;
}) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [editName, setEditName] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<UnitType>("unit");
  const [smokeable, setSmokeable] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!prefill) return;
    const nm = prefill.name || "";
    if (nm) setName(nm);
    if (prefill.unit_type) setUnit(prefill.unit_type);
    if (typeof prefill.is_smokeable === "boolean") setSmokeable(prefill.is_smokeable);
    clearPrefill();
  }, [prefill]);

  async function submit() {
    if (!name.trim()) return toast.error("Nombre obligatorio");
    setSaving(true);
    const { getCurrentClubId } = await import("@/lib/club");
    const clubId = await getCurrentClubId();
    if (!clubId) {
      setSaving(false);
      return toast.error("No tienes un club asignado");
    }
    const { error } = await supabase.from("product_categories").insert({
      club_id: clubId,
      name: name.trim(),
      unit_type: unit,
      is_smokeable: smokeable,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Categoría creada");
    setName("");
    setUnit("unit");
    setSmokeable(false);
    onCreated();
  }
  async function updateCategory(category: Category, archived: boolean, newName = category.name) {
    if (!newName.trim()) return toast.error("Nombre obligatorio");
    if (
      archived !== !!category.archived &&
      !confirm(
        archived
          ? "¿Archivar la categoría? Sus productos e historial se conservan."
          : "¿Reactivar la categoría?",
      )
    )
      return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("manage_administrative_category", {
        p_id: category.id,
        p_name: newName.trim(),
        p_archived: archived,
      });
      if (error) throw error;
      setEditing(null);
      onCreated();
      toast.success("Categoría actualizada");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function removeCategory(category: Category) {
    if (products.some((product) => product.category_id === category.id)) {
      toast.error(
        "Esta categoría contiene productos: usa Archivar para conservar todos los datos.",
      );
      return;
    }
    if (!confirm(`¿Eliminar la categoría "${category.name}"? Esta acción no se puede deshacer.`))
      return;
    setSaving(true);
    try {
      const { getCurrentClubId } = await import("@/lib/club");
      const clubId = await getCurrentClubId();
      if (!clubId) throw new Error("No tienes un club asignado");
      const { count, error: checkError } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("club_id", clubId)
        .eq("category_id", category.id);
      if (checkError) throw checkError;
      if (count !== 0)
        throw new Error("Esta categoría tiene productos asociados y no se puede eliminar.");
      const { data, error } = await supabase
        .from("product_categories")
        .delete()
        .eq("id", category.id)
        .eq("club_id", clubId)
        .select("id");
      if (error) throw error;
      if (!data?.length)
        throw new Error("No se pudo eliminar la categoría. Verifica los permisos del club.");
      toast.success("Categoría eliminada");
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo eliminar la categoría");
    } finally {
      setSaving(false);
    }
  }
  const ejemplos = ["Flores", "Hash", "Extracciones", "Bebidas", "Parafernalia", "Prerolled"];

  return (
    <div className="max-w-xl bg-card/60 border border-neon/20 rounded-2xl p-6 space-y-4">
      <Field label="Nombre">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ej. Flores"
          className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-neon outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {ejemplos.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setName(ex)}
              className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border border-border text-muted-foreground hover:text-neon hover:border-neon/40"
            >
              {ex}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Unidad de medida">
        <div className="grid grid-cols-2 gap-2">
          {(["gr", "unit"] as UnitType[]).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={`py-2.5 rounded-lg text-xs uppercase tracking-widest border ${
                unit === u
                  ? "border-neon text-neon bg-neon/10"
                  : "border-border text-muted-foreground"
              }`}
            >
              {u === "gr" ? "Gramos" : "Unidades"}
            </button>
          ))}
        </div>
      </Field>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={smokeable}
          onChange={(e) => setSmokeable(e.target.checked)}
          className="w-4 h-4 accent-[var(--neon)]"
        />
        <span className="text-sm">Producto fumable (mostrará indica / sativa / híbrida)</span>
      </label>

      <button
        onClick={submit}
        disabled={saving}
        className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
      >
        <Plus className="w-4 h-4 inline mr-2" /> {saving ? "Creando…" : "Crear categoría"}
      </button>
      <div className="border-t border-border pt-4 space-y-2">
        <h3 className="text-xs uppercase tracking-widest text-neon">Categorías existentes</h3>
        {categories.length === 0 && (
          <p className="text-sm text-muted-foreground">Aún no hay categorías.</p>
        )}
        {categories.map((category) => (
          <div
            key={category.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
          >
            <div className="min-w-0 flex-1 text-sm">
              {category.name}
              {category.archived && " (archivada)"}
              {editing?.id === category.id && (
                <div className="space-y-2 mt-2">
                  <input
                    aria-label="Nuevo nombre de categoría"
                    maxLength={120}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-input border border-border p-2"
                  />
                  <button
                    disabled={saving}
                    onClick={() => updateCategory(category, !!category.archived, editName)}
                    className="text-neon p-2"
                  >
                    Guardar categoría
                  </button>
                </div>
              )}
            </div>
            <button
              disabled={saving}
              onClick={() => {
                setEditing(category);
                setEditName(category.name);
              }}
              className="text-xs text-neon"
            >
              Editar
            </button>
            <button
              disabled={saving}
              onClick={() => updateCategory(category, !category.archived)}
              className="text-xs text-neon"
            >
              {category.archived ? "Reactivar" : "Archivar"}
            </button>
            <button
              type="button"
              disabled={saving || products.some((p) => p.category_id === category.id)}
              onClick={() => removeCategory(category)}
              title={
                products.some((p) => p.category_id === category.id)
                  ? "Primero retira los productos asociados"
                  : "Eliminar categoría vacía"
              }
              className="px-3 py-1.5 rounded border border-red-500/40 text-red-300 text-xs disabled:opacity-40"
            >
              Eliminar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.25em] text-neon-dim">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
