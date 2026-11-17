import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SnoopLayout } from "@/components/SnoopLayout";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ArrowLeft,
  Mic,
  Square,
  Loader2,
  Trash2,
  Plus,
  ShoppingBag,
  Send,
  Search,
} from "lucide-react";
import { parseOrderItems, transcribeAudio } from "@/lib/voice-agent.functions";
import { formatPrice } from "@/lib/snoop";

export const Route = createFileRoute("/_authenticated/soci/$id/pedido")({
  component: PedidoPage,
});

type Product = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  stock: number;
  /** stored as euros in the DB (numeric) */
  sell_price_eur: number;
  unit_type: "gr" | "unit";
};

type Cart = {
  product_id: string;
  product_name: string;
  unit_type: "gr" | "unit";
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
  merma: number;
};

function pickMime(): string | null {
  const c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of c)
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  return null;
}
async function blobToBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function PedidoPage() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const [member, setMember] = useState<{
    first_name: string;
    last_name: string;
    member_number: string;
  } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notes, setNotes] = useState("");
  // pending items awaiting manual or voice confirmation
  const [pending, setPending] = useState<{
    transcript: string;
    items: Array<{
      product_id: string;
      product_name: string;
      unit_type: "gr" | "unit";
      quantity: number;
    }>;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");
  // per-product input state for gr items: { [productId]: { qty, eur } }
  const [grInput, setGrInput] = useState<Record<string, { qty: string; eur: string }>>({});
  // raw text for merma input keyed by product_id (so user can type "0", "0.", "0,05")
  const [mermaText, setMermaText] = useState<Record<string, string>>({});
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const parse = useServerFn(parseOrderItems);
  const transcribe = useServerFn(transcribeAudio);

  useEffect(() => {
    (async () => {
      const [{ data: m }, { data: p }] = await Promise.all([
        supabase
          .from("members")
          .select("first_name,last_name,member_number")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("products")
          .select("id,category_id,name,stock,sell_price,product_categories(name,unit_type)")
          .order("name"),
      ]);
      setMember((m as any) ?? null);
      const flat: Product[] = ((p as any[]) ?? []).map((row) => ({
        id: row.id,
        category_id: row.category_id,
        category_name: row.product_categories?.name ?? "Sin categoría",
        name: row.name,
        stock: Number(row.stock ?? 0),
        sell_price_eur: Number(row.sell_price ?? 0),
        unit_type: (row.product_categories?.unit_type ?? "unit") as "gr" | "unit",
      }));
      setProducts(flat);
    })();
  }, [id]);

  // Listen to the floating assistant mic when we're on this page
  useEffect(() => {
    function onTx(e: Event) {
      const t = (e as CustomEvent).detail?.text as string | undefined;
      if (t) processTranscript(t);
    }
    window.addEventListener("snoop:pedido-transcript", onTx as EventListener);
    return () => window.removeEventListener("snoop:pedido-transcript", onTx as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, products]);

  const categories = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.category_id, p.category_name));
    return Array.from(m, ([id, name]) => ({ id, name }));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat !== "all" && p.category_id !== activeCat) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.category_name.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [products, search, activeCat]);

  const grouped = useMemo(() => {
    const g = new Map<string, Product[]>();
    filtered.forEach((p) => {
      const arr = g.get(p.category_name) ?? [];
      arr.push(p);
      g.set(p.category_name, arr);
    });
    return Array.from(g, ([name, items]) => ({ name, items }));
  }, [filtered]);

  const total = useMemo(() => cart.reduce((a, c) => a + c.line_total_cents, 0), [cart]);

  function priceCents(p: Product) {
    return Math.round(p.sell_price_eur * 100);
  }

  /** For gr items: split actual weight into billed + merma (tolerance 0.05 g per 1 g billed). */
  function splitGrTolerance(q: number): { billed: number; merma: number } {
    if (q <= 0) return { billed: 0, merma: 0 };
    const candidates = [Math.floor(q), Math.floor(q * 2) / 2, Math.round(q)];
    const valid = candidates.filter((b) => b > 0 && q + 1e-9 >= b && q - b <= 0.05 * b + 1e-9);
    const billed = valid.length ? Math.max(...valid) : q;
    const merma = Math.round((q - billed) * 1000) / 1000;
    return { billed: Math.round(billed * 1000) / 1000, merma };
  }

  function addToCart(productId: string, quantity: number, opts?: { autoTolerance?: boolean }) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    if (quantity <= 0) return;
    quantity = Math.round(quantity * 1000) / 1000;
    let billed = quantity;
    let autoMerma = 0;
    if (p.unit_type === "gr" && opts?.autoTolerance) {
      const s = splitGrTolerance(quantity);
      billed = s.billed;
      autoMerma = s.merma;
    }
    if (billed + autoMerma > p.stock) {
      toast.error(`Stock insuficiente de ${p.name} (disponible: ${p.stock})`);
      return;
    }
    const unitC = priceCents(p);
    const line_total_cents = Math.round(unitC * billed);
    setCart((prev) => {
      const i = prev.findIndex((c) => c.product_id === productId);
      if (i >= 0) {
        const merged = [...prev];
        const newQty = Math.round((merged[i].quantity + billed) * 1000) / 1000;
        const newMerma = Math.round((merged[i].merma + autoMerma) * 1000) / 1000;
        if (newQty + newMerma > p.stock) {
          toast.error(`Stock insuficiente de ${p.name}`);
          return prev;
        }
        merged[i] = {
          ...merged[i],
          quantity: newQty,
          merma: newMerma,
          line_total_cents: Math.round(unitC * newQty),
        };
        if (autoMerma > 0) setMermaText((s) => ({ ...s, [productId]: String(newMerma) }));
        return merged;
      }
      if (autoMerma > 0) setMermaText((s) => ({ ...s, [productId]: String(autoMerma) }));
      return [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          unit_type: p.unit_type,
          quantity: billed,
          unit_price_cents: unitC,
          line_total_cents,
          merma: autoMerma,
        },
      ];
    });
  }

  function updateLine(idx: number, patch: Partial<Cart>) {
    setCart((prev) => {
      const next = [...prev];
      const cur = { ...next[idx], ...patch };
      const p = products.find((x) => x.id === cur.product_id);
      if (p && cur.quantity + (cur.merma || 0) > p.stock) {
        toast.error(`Stock insuficiente de ${p.name}`);
        return prev;
      }
      cur.line_total_cents = Math.round(cur.unit_price_cents * cur.quantity);
      next[idx] = cur;
      return next;
    });
  }

  /** Local fallback: match product names in transcript when AI returns nothing. */
  function localMatch(transcript: string): Array<{ product_id: string; quantity: number }> {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    const t =
      " " +
      norm(transcript)
        .replace(/[^\w\s.,]/g, " ")
        .replace(/\s+/g, " ") +
      " ";
    const numWords: Record<string, number> = {
      medio: 0.5,
      media: 0.5,
      mezzo: 0.5,
      mezza: 0.5,
      un: 1,
      una: 1,
      uno: 1,
      dos: 2,
      due: 2,
      tres: 3,
      tre: 3,
      cuatro: 4,
      quattro: 4,
      cinco: 5,
      cinque: 5,
      seis: 6,
      sei: 6,
    };
    const out: Array<{ product_id: string; quantity: number }> = [];
    const seen = new Set<string>();
    for (const p of products) {
      const tokens = norm(p.name)
        .split(/\s+/)
        .filter((x) => x.length >= 3);
      if (!tokens.length) continue;
      let idx = -1;
      for (const tok of tokens) {
        const at = t.indexOf(" " + tok);
        if (at >= 0) {
          idx = at;
          break;
        }
      }
      if (idx < 0 || seen.has(p.id)) continue;
      seen.add(p.id);
      const before = t.slice(Math.max(0, idx - 40), idx);
      let qty = 1;
      const num = before.match(
        /(\d+(?:[.,]\d+)?)\s*(?:gr|g|gramos?|grammi)?\s*(?:de|di|del|della)?\s*$/,
      );
      if (num) qty = parseFloat(num[1].replace(",", "."));
      else {
        for (const [w, v] of Object.entries(numWords)) {
          if (
            new RegExp(`\\b${w}\\b\\s*(?:gramos?|grammi|gr|g)?\\s*(?:de|di|del|della)?\\s*$`).test(
              before,
            )
          ) {
            qty = v;
            break;
          }
        }
      }
      if (qty > 0) out.push({ product_id: p.id, quantity: qty });
    }
    return out;
  }

  function isYes(t: string) {
    return /\b(s[ií]|si|confirma(r|do)?|confirmo|ok|okey|okay|vale|dale|adelante|añade|añadir|agrega|agregar|conferma)\b/i.test(
      t,
    );
  }
  function isNo(t: string) {
    return /\b(no|cancela(r)?|cancelo|borra(r)?|anula(r)?|annulla)\b/i.test(t);
  }

  function applyPending() {
    if (!pending) return;
    for (const it of pending.items) {
      const p = products.find((x) => x.id === it.product_id);
      addToCart(it.product_id, it.quantity, { autoTolerance: p?.unit_type === "gr" });
    }
    toast.success(`Añadidos ${pending.items.length} item${pending.items.length > 1 ? "s" : ""}`);
    setPending(null);
    setText("");
  }

  async function processTranscript(t: string) {
    if (!t.trim()) return;
    // voice confirm / cancel for an existing pending batch
    if (pending) {
      if (isYes(t)) {
        applyPending();
        return;
      }
      if (isNo(t)) {
        setPending(null);
        toast("Cancelado");
        return;
      }
    }
    setBusy(true);
    try {
      let items: Array<{ product_id: string; quantity: number }> = [];
      try {
        const r = await parse({
          data: {
            transcript: t,
            products: products.map((p) => ({
              id: p.id,
              name: p.name,
              unit_type: p.unit_type,
              sell_price: priceCents(p),
              stock: p.stock,
            })),
          },
        });
        items = r.items;
      } catch {}
      if (!items.length) items = localMatch(t);
      if (!items.length) {
        toast.error('No encontré productos. Prueba: "dos gramos de amnesia, una cerveza"');
        return;
      }
      const enriched = items.map((it) => {
        const p = products.find((x) => x.id === it.product_id);
        return {
          product_id: it.product_id,
          product_name: p?.name ?? "?",
          unit_type: (p?.unit_type ?? "unit") as "gr" | "unit",
          quantity: it.quantity,
        };
      });
      setPending({ transcript: t, items: enriched });
    } catch (e: any) {
      toast.error(e?.message ?? "Error al interpretar");
    } finally {
      setBusy(false);
    }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      if (!mime) {
        stream.getTracks().forEach((t) => t.stop());
        toast.error("Navegador no compatible");
        return;
      }
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        if (blob.size < 1200) {
          setProcessing(false);
          return;
        }
        setProcessing(true);
        try {
          const b64 = await blobToBase64(blob);
          const { text: tx } = await transcribe({
            data: { audioBase64: b64, mimeType: rec.mimeType },
          });
          if (tx) await processTranscript(tx);
        } catch (e: any) {
          toast.error(e?.message ?? "Error transcribiendo");
        } finally {
          setProcessing(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      toast.error("Permiso de micrófono denegado");
    }
  }
  function stopRec() {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
  }

  function handleGrAdd(p: Product) {
    const st = grInput[p.id] ?? { qty: "", eur: "" };
    const qty = parseFloat(st.qty.replace(",", "."));
    const eur = parseFloat(st.eur.replace(",", "."));
    let q = 0;
    if (!isNaN(qty) && qty > 0) q = qty;
    else if (!isNaN(eur) && eur > 0 && p.sell_price_eur > 0) q = eur / p.sell_price_eur;
    if (q <= 0) {
      toast.error("Indica gramos o euros");
      return;
    }
    addToCart(p.id, q, { autoTolerance: true });
    setGrInput((s) => ({ ...s, [p.id]: { qty: "", eur: "" } }));
  }

  // Live €↔g conversion typing
  function setGrQty(pid: string, qty: string, price: number) {
    const v = parseFloat(qty.replace(",", "."));
    const eur = !isNaN(v) && v > 0 ? (v * price).toFixed(2) : "";
    setGrInput((s) => ({ ...s, [pid]: { qty, eur } }));
  }
  function setGrEur(pid: string, eur: string, price: number) {
    const v = parseFloat(eur.replace(",", "."));
    const qty = !isNaN(v) && v > 0 && price > 0 ? (v / price).toFixed(2) : "";
    setGrInput((s) => ({ ...s, [pid]: { qty, eur } }));
  }

  async function confirmar() {
    if (!cart.length) return toast.error("Carrito vacío");
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as any)("create_order_with_items", {
        _member_id: id,
        _notes: notes || null,
        _items: cart,
      });
      if (error) throw error;
      toast.success(`Pedido cerrado · ${formatPrice(total)}`);
      nav({ to: "/soci/$id", params: { id } });
    } catch (e: any) {
      toast.error(e?.message ?? "Error al guardar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SnoopLayout
      title="Nuevo pedido"
      subtitle={member ? `${member.first_name} ${member.last_name} · #${member.member_number}` : ""}
    >
      <Link
        to="/soci/$id"
        params={{ id }}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Volver a la ficha
      </Link>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Dictation */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim mb-3">
              Dicta o escribe el pedido
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder='ej. "un gramo de amnesia, dos cervezas y medio de critical"'
              rows={3}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-neon outline-none resize-none"
            />
            <div className="flex gap-2 mt-3 flex-wrap">
              <button
                onClick={recording ? stopRec : startRec}
                disabled={busy || processing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs uppercase tracking-widest font-display border transition ${
                  recording
                    ? "border-destructive text-destructive bg-destructive/10"
                    : "border-neon text-neon bg-neon/10 hover:bg-neon/20"
                }`}
              >
                {processing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : recording ? (
                  <Square className="w-4 h-4" />
                ) : (
                  <Mic className="w-4 h-4" />
                )}
                {processing ? "Transcribiendo…" : recording ? "Parar" : "Hablar"}
              </button>
              <button
                onClick={() => processTranscript(text)}
                disabled={busy || !text.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs uppercase tracking-widest font-display bg-gradient-neon text-primary-foreground glow-neon disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Añadir al carrito
              </button>
            </div>

            {/* Confirmation panel for voice/text input */}
            {pending && (
              <div className="bg-neon/5 border-2 border-neon/60 rounded-2xl p-5 glow-neon">
                <div className="text-[10px] uppercase tracking-[0.3em] text-neon mb-2">
                  Confirmar lo que entendí
                </div>
                <ul className="space-y-1.5 mb-4">
                  {pending.items.map((it, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-foreground truncate">{it.product_name}</span>
                      <span className="text-neon font-display whitespace-nowrap">
                        {it.quantity}
                        {it.unit_type === "gr" ? " g" : " ud"}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={applyPending}
                    className="flex-1 min-w-[120px] px-4 py-2 rounded-lg bg-gradient-neon text-primary-foreground text-xs uppercase tracking-widest font-display glow-neon"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => setPending(null)}
                    className="flex-1 min-w-[120px] px-4 py-2 rounded-lg border border-destructive text-destructive text-xs uppercase tracking-widest font-display hover:bg-destructive/10"
                  >
                    Cancelar
                  </button>
                </div>
                <div className="text-[10px] text-muted-foreground mt-3">
                  💡 También puedes decir <span className="text-neon">"sí"</span> o{" "}
                  <span className="text-neon">"no"</span> por micrófono.
                </div>
              </div>
            )}
          </div>

          {/* Quick catalog */}
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Catálogo</div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto por nombre…"
                className="w-full bg-input border border-border rounded-lg pl-8 pr-3 py-2 text-sm focus:border-neon outline-none"
              />
            </div>

            {categories.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => setActiveCat("all")}
                  className={`text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border ${activeCat === "all" ? "bg-neon/15 border-neon text-neon" : "border-border text-muted-foreground hover:border-neon/50"}`}
                >
                  Todas
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className={`text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border ${activeCat === c.id ? "bg-neon/15 border-neon text-neon" : "border-border text-muted-foreground hover:border-neon/50"}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {products.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No hay productos. Crea alguno en{" "}
                <Link to="/productos" className="text-neon underline">
                  Productos
                </Link>
                .
              </div>
            ) : grouped.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sin resultados.</div>
            ) : (
              <div className="space-y-4">
                {grouped.map((grp) => (
                  <div key={grp.name}>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-neon-dim mb-2">
                      {grp.name}
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {grp.items.map((p) => {
                        const isGr = p.unit_type === "gr";
                        const st = grInput[p.id] ?? { qty: "", eur: "" };
                        return (
                          <div
                            key={p.id}
                            className={`p-3 rounded-lg border ${p.stock <= 0 ? "opacity-40 border-border" : "border-border hover:border-neon/60"} transition`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm text-foreground truncate">{p.name}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {p.sell_price_eur.toFixed(2)} €/{p.unit_type} · stock {p.stock}
                                </div>
                              </div>
                            </div>
                            {isGr ? (
                              <div className="flex items-center gap-1.5 mt-2">
                                <input
                                  inputMode="decimal"
                                  value={st.qty}
                                  onChange={(e) => setGrQty(p.id, e.target.value, p.sell_price_eur)}
                                  placeholder="g"
                                  disabled={p.stock <= 0}
                                  className="w-full bg-input border border-border rounded px-2 py-1 text-xs focus:border-neon outline-none"
                                />
                                <span className="text-[10px] text-muted-foreground">↔</span>
                                <input
                                  inputMode="decimal"
                                  value={st.eur}
                                  onChange={(e) => setGrEur(p.id, e.target.value, p.sell_price_eur)}
                                  placeholder="€"
                                  disabled={p.stock <= 0}
                                  className="w-full bg-input border border-border rounded px-2 py-1 text-xs focus:border-neon outline-none"
                                />
                                <button
                                  onClick={() => handleGrAdd(p)}
                                  disabled={p.stock <= 0}
                                  className="px-2 py-1 rounded bg-neon/15 border border-neon text-neon text-xs disabled:opacity-40"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => addToCart(p.id, 1)}
                                disabled={p.stock <= 0}
                                className="w-full mt-2 px-2 py-1.5 rounded bg-neon/15 border border-neon text-neon text-xs uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-40"
                              >
                                <Plus className="w-3 h-3" /> Añadir 1 ud
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart */}
        <div className="space-y-4">
          <div className="bg-card/60 border border-neon/20 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <ShoppingBag className="w-4 h-4 text-neon" />
              <div className="font-display text-sm">Carrito</div>
            </div>
            {cart.length === 0 ? (
              <div className="text-xs text-muted-foreground">Vacío</div>
            ) : (
              <ul className="space-y-3">
                {cart.map((c, i) => (
                  <li key={i} className="border-b border-border/40 pb-3 last:border-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate">{c.product_name}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {c.quantity}
                          {c.unit_type === "gr" ? " g" : " ud"} × {formatPrice(c.unit_price_cents)}
                        </div>
                      </div>
                      <div className="text-neon font-display whitespace-nowrap">
                        {formatPrice(c.line_total_cents)}
                      </div>
                      <button
                        onClick={() => setCart((p) => p.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {c.unit_type === "gr" && (
                      <div className="flex items-center gap-2 mt-2">
                        <label className="text-[10px] uppercase tracking-widest text-neon-dim">
                          Merma
                        </label>
                        <input
                          inputMode="decimal"
                          value={mermaText[c.product_id] ?? (c.merma ? String(c.merma) : "")}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setMermaText((s) => ({ ...s, [c.product_id]: raw }));
                            if (raw.trim() === "") {
                              updateLine(i, { merma: 0 });
                              return;
                            }
                            const v = parseFloat(raw.replace(",", "."));
                            if (!isNaN(v) && v >= 0) updateLine(i, { merma: v });
                          }}
                          placeholder="0,05"
                          className="w-20 bg-input border border-border rounded px-2 py-1 text-xs focus:border-neon outline-none"
                        />
                        <span className="text-[10px] text-muted-foreground">
                          g extra a descontar del stock
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-neon/20">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Total</div>
              <div className="font-display text-2xl text-neon">{formatPrice(total)}</div>
            </div>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas (opcional)"
            rows={2}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs focus:border-neon outline-none resize-none"
          />

          <button
            onClick={confirmar}
            disabled={!cart.length || busy}
            className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Confirmar pedido"}
          </button>
        </div>
      </div>
    </SnoopLayout>
  );
}
