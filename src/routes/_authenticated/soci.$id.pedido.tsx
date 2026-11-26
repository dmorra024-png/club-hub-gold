import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { useAuth } from "@/hooks/useAuth";
import { walletMemberStatus, walletCheckout } from "@/lib/wallet-management.functions";
import {getClubMermaSettings} from "@/lib/club-merma.functions";
import {
  readOnlyCatalog,
  filterReadOnlyCatalog,
  catalogReadMessage,
  type ReadOnlyCatalog,
  type ReadOnlyCatalogProduct,
} from "@/lib/read-only-catalog";

export const Route = createFileRoute("/_authenticated/soci/$id/pedido")({
  component: PedidoPage,
});

type Product = ReadOnlyCatalogProduct;

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
  const [discardOpen, setDiscardOpen] = useState(false);
  const [member, setMember] = useState<{
    first_name: string;
    last_name: string;
    member_number: string;
  } | null>(null);
  const { user, access, loading: authLoading, accessError, can, retryAccess } = useAuth();
  const catalogAllowed = can("use_cash") || can("manage_products") || can("view_reports");
  const catalogScope = JSON.stringify([
    user?.id,
    access.clubId,
    access.role,
    access.status,
    [...access.permissions].sort(),
  ]);
  const [catalogState, setCatalogState] = useState<{
    scope: string;
    data?: ReadOnlyCatalog;
    error?: string;
    loading: boolean;
  } | null>(null);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const catalog = catalogState?.scope === catalogScope ? catalogState : null;
  const [dispenserStock,setDispenserStock] = useState<Record<string,number>>({});
  const [dispenserReady,setDispenserReady] = useState(false);
  const [dispenserError,setDispenserError] = useState(false);
  // Do not use the global product total for checkout: only dispensary stock is sellable.
  useEffect(()=>{
    if(!access.clubId||!catalog?.data||!catalogAllowed)return;
    let active=true;
    setDispenserReady(false);setDispenserError(false);
    void (async()=>{
      const {data,error}=await (supabase as any).from("snoop_stock_locations")
        .select("product_id,quantity").eq("club_id",access.clubId).eq("location","dispensario").limit(1000);
      if(!active)return;
      if(error){setDispenserStock({});setDispenserError(true);}
      else setDispenserStock(Object.fromEntries((data??[]).map((x:any)=>[x.product_id,Number(x.quantity)])));
      setDispenserReady(true);
    })();
    return ()=>{active=false;};
  },[access.clubId,catalog?.data,catalogAllowed]);
  const products: Product[] = !accessError && catalogAllowed ? (catalog?.data?.products ?? []).map(p=>({
    ...p,stock:dispenserReady && !dispenserError ? (dispenserStock[p.id]??0) : 0
  })) : [];
  const [cart, setCart] = useState<Cart[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [walletState, setWalletState] = useState<{enabled:boolean;clubEnabled:boolean;balanceCents:number|null}|null>(null);
  const [walletStatusError, setWalletStatusError] = useState(false);
  const [walletConfirmed, setWalletConfirmed] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<""|"cash"|"card"|"transfer"|"wallet">("");
  const [walletUncertain, setWalletUncertain] = useState(false);
  const walletMode = walletState?.clubEnabled === true;
  const formatCheckoutAmount = (cents:number) => walletMode ? `${(cents/100).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2})} créditos` : formatPrice(cents);
  const walletOperation = useRef<string|null>(null);
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
  const [grInput, setGrInput] = useState<Record<string, { qty: string; eur: string; source?: "qty" | "eur" }>>({});
  // raw text for merma input keyed by product_id (so user can type "0", "0.", "0,05")
  const [mermaText, setMermaText] = useState<Record<string, string>>({});
  const [mermaLimit,setMermaLimit]=useState<number|null>(null);
  const [mermaConfigError,setMermaConfigError]=useState(false);
  useEffect(()=>{
    if(authLoading||!access.clubId)return;
    let active=true;setMermaLimit(null);setMermaConfigError(false);
    getClubMermaSettings().then(result=>{
      if(active)setMermaLimit(result.maxMermaPerGram);
    }).catch(()=>{if(active)setMermaConfigError(true);});
    return()=>{active=false;};
  },[authLoading,access.clubId]);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const parse = useServerFn(parseOrderItems);
  const transcribe = useServerFn(transcribeAudio);

  useEffect(() => {
    if (authLoading || !access.clubId || !can("manage_members")) return;
    let active = true;
    setMember(null);
    supabase
      .from("members")
      .select("first_name,last_name,member_number")
      .eq("id", id)
      .eq("club_id", access.clubId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setMember(data ?? null);
      });
    return () => {
      active = false;
    };
  }, [id, catalogScope, authLoading]);

  useEffect(() => {
    if (authLoading || !access.clubId || !catalogAllowed) return;
    let active = true;
    setCatalogState({ scope: catalogScope, loading: true });
    readOnlyCatalog(supabase, access.clubId)
      .then((data) => {
        if (active) setCatalogState({ scope: catalogScope, data, loading: false });
      })
      .catch((error) => {
        if (active)
          setCatalogState({
            scope: catalogScope,
            error: catalogReadMessage(error),
            loading: false,
          });
      });
    return () => {
      active = false;
    };
  }, [catalogScope, authLoading, catalogRetry]);

  useEffect(() => {
    if (authLoading || accessError || !access.clubId || !can("use_cash")) return;
    let active=true;
    setWalletState(null);setWalletStatusError(false);setWalletConfirmed(false);setWalletUncertain(false);
    walletMemberStatus({data:{memberId:id}})
      .then(result=>{if(active){setWalletState(result);setPaymentChoice(result.clubEnabled?"wallet":"");}})
      .catch(()=>{if(active)setWalletStatusError(true);});
    return()=>{active=false;};
  },[id,catalogScope,authLoading,accessError]);

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

  const categories = !accessError && catalogAllowed ? (catalog?.data?.categories ?? []) : [];

  const filtered = useMemo(
    () => filterReadOnlyCatalog(products, activeCat, search),
    [products, search, activeCat],
  );

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

  /** Split measured weight into billed grams + authorized club merma. */
  function splitGrTolerance(q: number): { billed: number; merma: number } {
    if (q <= 0) return { billed: 0, merma: 0 };
    const candidates = [Math.floor(q), Math.floor(q * 2) / 2, Math.round(q)];
    const valid = candidates.filter((b) => b > 0 && q + 1e-9 >= b && q - b <= (mermaLimit??0) * b + 1e-9);
    const billed = valid.length ? Math.max(...valid) : q;
    const merma = Math.round((q - billed) * 1000) / 1000;
    return { billed: Math.round(billed * 1000) / 1000, merma };
  }

  function addToCart(productId: string, quantity: number, opts?: { autoTolerance?: boolean; exactAmountCents?: number }) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    if (quantity <= 0) return;
    quantity = Math.round(quantity * 1000) / 1000;
    let billed = quantity;
    let autoMerma = 0;
    if (p.unit_type === "gr" && opts?.autoTolerance) {
      if(mermaLimit===null)return toast.error("No se pudo verificar la merma permitida del club.");
      const s = splitGrTolerance(quantity);
      billed = s.billed;
      autoMerma = s.merma;
    }
    if (billed + autoMerma > p.stock) {
      toast.error(`Stock insuficiente de ${p.name} (disponible: ${p.stock})`);
      return;
    }
    const unitC = priceCents(p);
    const line_total_cents = opts?.exactAmountCents ?? Math.round(unitC * billed);
    setCart((prev) => {
      const i = prev.findIndex((c) => c.product_id === productId);
      if (i >= 0) {
        const merged = [...prev];
        const newQty = Math.round((merged[i].quantity + billed) * 1000) / 1000;
        const newMerma = Math.round((merged[i].merma + autoMerma) * 1000) / 1000;
        if (newMerma>newQty*(mermaLimit??0)+0.000001){toast.error("Merma superior al límite autorizado por el club.");return prev;}
        if (newQty + newMerma > p.stock) {
          toast.error(`Stock insuficiente de ${p.name}`);
          return prev;
        }
        merged[i] = {
          ...merged[i],
          quantity: newQty,
          merma: newMerma,
          line_total_cents: merged[i].line_total_cents + line_total_cents,
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
      if(cur.unit_type==="gr"&&cur.merma>cur.quantity*(mermaLimit??0)+0.000001){
        toast.error("Merma superior al límite permitido por el club.");
        return prev;
      }
      if (p && cur.quantity + (cur.merma || 0) > p.stock) {
        toast.error(`Stock insuficiente de ${p.name}`);
        return prev;
      }
      if (patch.quantity !== undefined || patch.unit_price_cents !== undefined) {
        cur.line_total_cents = Math.round(cur.unit_price_cents * cur.quantity);
      }
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
    const enteredEuros = st.source === "eur" && Number.isFinite(eur) && eur > 0;
    if (enteredEuros && p.sell_price_eur > 0) q = eur / p.sell_price_eur;
    else if (!isNaN(qty) && qty > 0) q = qty;
    else if (!isNaN(eur) && eur > 0 && p.sell_price_eur > 0) q = eur / p.sell_price_eur;
    if (q <= 0) {
      toast.error("Indica gramos o euros");
      return;
    }
    addToCart(p.id, q, {
      autoTolerance: true,
      // The euro amount entered by the operator is authoritative; display rounding
      // of the derived grams must not alter the sale price.
      ...(enteredEuros ? { exactAmountCents: Math.round(eur * 100) } : {}),
    });
    setGrInput((s) => ({ ...s, [p.id]: { qty: "", eur: "" } }));
  }

  // Live €↔g conversion typing
  function setGrQty(pid: string, qty: string, price: number) {
    const v = parseFloat(qty.replace(",", "."));
    const eur = !isNaN(v) && v > 0 ? (v * price).toFixed(2) : "";
    setGrInput((s) => ({ ...s, [pid]: { qty, eur, source: "qty" } }));
  }
  function setGrEur(pid: string, eur: string, price: number) {
    const v = parseFloat(eur.replace(",", "."));
    const qty = !isNaN(v) && v > 0 && price > 0 ? (v / price).toFixed(2) : "";
    setGrInput((s) => ({ ...s, [pid]: { qty, eur, source: "eur" } }));
  }

  async function confirmar() {
    if (!cart.length) return toast.error("Carrito vacío");
    if(mermaLimit===null||mermaConfigError)return toast.error("No se puede verificar la merma permitida del club.");
    if(cart.some(c=>(c.unit_type!=="gr"&&c.merma!==0)||
       (c.unit_type==="gr"&&c.merma>c.quantity*mermaLimit+0.000001)))
       return toast.error("La merma excede el límite del club. Corrige el pedido.");
    // Fail closed while verifying club mode: an enabled Monedero club must
    // never offer direct cash/card/transfer checkout.
    if(walletUncertain) return toast.error("Hay un pago anterior sin confirmar. Consulta el historial antes de otro pedido.");
    if (!walletState || walletStatusError) return toast.error("No se ha podido verificar la configuración de Monedero del club.");
    if (!paymentChoice || (walletMode && paymentChoice!=="wallet") || (!walletMode && paymentChoice==="wallet")) return toast.error("Forma de pago no válida para este club.");
    const payingWallet=paymentChoice==="wallet";
    if(payingWallet && (!walletState || walletStatusError || walletUncertain ||
       !walletState.clubEnabled)){
      return toast.error("No se puede verificar Monedero. Reintenta o consulta la ficha del socio.");
    }
    if(payingWallet && !walletState?.enabled)
      return toast.error("El Monedero de este socio no está disponible.");
    if (payingWallet && (!walletConfirmed || (walletState?.balanceCents??0)<total))
      return toast.error("Confirma el pago y comprueba el saldo del monedero.");
    setBusy(true);
    try {
      if (payingWallet) {
        walletOperation.current??=crypto.randomUUID();
        const result=await walletCheckout({data:{
          memberId:id,notes:notes||"",items:cart,
          operationId:walletOperation.current,confirmed:true
        }});
        if(result.status==="rejected"){
          // Definitive DB rollback: safe to let the operator correct the cart.
          walletOperation.current=null;
          setWalletUncertain(false);
          toast.error(result.reason);
          return;
        }
        walletOperation.current=null;
        toast.success(`Pedido pagado con Monedero · ${formatCheckoutAmount(result.amountCents)}`);
      } else {
        const {error}=await (supabase.rpc as any)("create_order_with_items_and_payment",{
          _member_id:id,_notes:notes||null,_items:cart,_payment_method:paymentChoice
        });
        if(error)throw error;
        toast.success(`Pedido cerrado · ${formatCheckoutAmount(total)}`);
      }
      nav({to:"/soci/$id",params:{id}});
    } catch(e:any){
      if(payingWallet){
        setWalletUncertain(true);
        toast.error("Resultado del pago no confirmado. Consulta el historial antes de otro pedido.");
      }else toast.error(e?.message??"Error al guardar");
    }finally{setBusy(false);}
  }

  return (
    <SnoopLayout
      title="Nuevo pedido"
      contentClassName="snoop-order-page"
      subtitle={member ? `${member.first_name} ${member.last_name} · #${member.member_number}` : ""}
    >
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar borrador</DialogTitle>
            <DialogDescription>
              Los cambios sin confirmar se perderán. No se registrará ninguna operación.
            </DialogDescription>
          </DialogHeader>
          <button
            className="border border-border rounded p-3"
            onClick={() => setDiscardOpen(false)}
          >
            Seguir editando
          </button>
          <button
            className="border border-destructive rounded p-3"
            onClick={() => nav({ to: "/soci/$id", params: { id } })}
          >
            Descartar y volver
          </button>
        </DialogContent>
      </Dialog>
      <Link
        onClick={(e) => {
          if (busy) {
            e.preventDefault();
            return;
          }
          if (cart.length || text.trim() || notes.trim()) {
            e.preventDefault();
            setDiscardOpen(true);
          }
        }}
        to="/soci/$id"
        params={{ id }}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-neon mb-6"
      >
        <ArrowLeft className="w-4 h-4" /> Cancelar borrador
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

          {/* Quick catalog: read-only loading and filtering. */}
          <div
            data-testid="catalogo-lectura"
            className="bg-card/60 border border-neon/20 rounded-2xl p-5 space-y-3"
          >
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

            {accessError ? (
              <div role="alert" className="text-sm">
                No se pudo verificar el acceso al catálogo.{" "}
                <button onClick={retryAccess} className="text-neon underline">
                  Reintentar acceso
                </button>
              </div>
            ) : !authLoading && !catalogAllowed ? (
              <p role="alert" className="text-sm">
                No tienes permiso para consultar este catálogo.
              </p>
            ) : authLoading || !catalog || catalog.loading ? (
              <p role="status" className="text-sm text-muted-foreground">
                Cargando catálogo…
              </p>
            ) : catalog.error ? (
              <div role="alert" className="text-sm space-y-2">
                <p>{catalog.error}</p>
                <button
                  onClick={() => setCatalogRetry((n) => n + 1)}
                  className="text-neon underline"
                >
                  Reintentar catálogo
                </button>
              </div>
            ) : !dispenserReady ? (
              <p role="status" className="text-sm text-muted-foreground">Cargando stock disponible en dispensario…</p>
            ) : dispenserError ? (
              <p role="alert" className="text-sm text-destructive">No se pudo verificar el stock del dispensario. Recarga antes de registrar pedidos.</p>
            ) : products.length === 0 ? (
              <p role="status" className="text-sm text-muted-foreground">
                {catalog.data!.hiddenRowCount > 0
                  ? "No hay productos activos en las categorías disponibles."
                  : "No hay productos visibles en el catálogo de este club."}
              </p>
            ) : grouped.length === 0 ? (
              <div role="status" className="text-sm text-muted-foreground">
                No hay coincidencias para estos filtros.{" "}
                <button
                  className="text-neon underline"
                  onClick={() => {
                    setSearch("");
                    setActiveCat("all");
                  }}
                >
                  Limpiar filtros
                </button>
              </div>
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
                            className={`snoop-order-product p-3 rounded-lg border ${p.stock <= 0 ? "opacity-40 border-border" : "border-border hover:border-neon/60"} transition`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm text-foreground truncate">{p.name}</div>
                                <div className="text-[10px] text-muted-foreground mt-0.5">
                                  {p.sell_price_eur.toFixed(2)} {walletMode?"créditos":"€"}/{p.unit_type} · dispensario {p.stock}
                                </div>
                              </div>
                            </div>
                            {isGr ? (
                              <div className="snoop-order-amounts mt-2">
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
                                  placeholder={walletMode?"créditos":"€"}
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
                          {c.unit_type === "gr" ? " g" : " ud"} × {formatCheckoutAmount(c.unit_price_cents)}
                        </div>
                      </div>
                      <div className="text-neon font-display whitespace-nowrap">
                        {formatCheckoutAmount(c.line_total_cents)}
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
                          g extra de stock · Máx. {mermaLimit===null?"…":(c.quantity*mermaLimit).toLocaleString("es-ES",{maximumFractionDigits:3})} g
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-neon/20">
              <div className="text-[10px] uppercase tracking-[0.3em] text-neon-dim">Total</div>
              <div className="font-display text-2xl text-neon">{formatCheckoutAmount(total)}</div>
            </div>
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas (opcional)"
            rows={2}
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs focus:border-neon outline-none resize-none"
          />

          {walletStatusError && <p role="alert" className="text-amber-300 text-sm">
            No se puede verificar la configuración del Monedero. No se registrará ningún pedido hasta comprobarla.
          </p>}
          {!walletState && !walletStatusError && <p role="status" className="text-sm text-muted-foreground">Verificando la configuración del club…</p>}
          {walletMode ? (
            <section className="rounded-xl border border-neon/30 p-3 space-y-3" aria-label="Pago con créditos">
              <strong>Pago con créditos del Monedero</strong>
              <p className="text-sm">Saldo disponible: <strong>{formatCheckoutAmount(walletState.balanceCents??0)}</strong></p>
              {!walletState.enabled && <p role="alert" className="text-red-400 text-sm">
                Monedero no disponible para este socio. Comprueba su membresía y tarjeta en la ficha del socio.
              </p>}
              {(walletState.balanceCents??0)<total && <p role="alert" className="text-red-400 text-sm">
                Créditos insuficientes. Recarga desde la ficha del socio.
              </p>}
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" disabled={busy||walletUncertain||!walletState.enabled}
                  checked={walletConfirmed} onChange={e=>setWalletConfirmed(e.target.checked)}/>
                Confirmo el descuento de {formatCheckoutAmount(total)} del Monedero de este socio.
              </label>
            </section>
          ) : walletState && (
            <div className="rounded-xl border border-neon/30 p-3 space-y-3" aria-label="Forma de pago">
              <strong>Forma de pago</strong>
              <div className="flex flex-wrap gap-4 text-sm">
                {(["cash","card","transfer"] as const).map(method => (
                  <label key={method} className="flex items-center gap-2">
                    <input type="radio" name="order-payment-method" value={method}
                      checked={paymentChoice===method} disabled={busy||walletUncertain}
                      onChange={()=>{setPaymentChoice(method);setWalletConfirmed(false);}}/>
                    {method==="cash"?"Efectivo":method==="card"?"Tarjeta / POS":"Transferencia"}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Registra el método utilizado; Tarjeta / POS no realiza un cargo al terminal.</p>
            </div>
          )}
          {walletUncertain && (
            <p role="alert" className="text-red-400 text-sm">
              Operación pendiente de comprobación. No vuelvas a confirmar: consulta el historial.
            </p>
          )}
          <button
            onClick={confirmar}
            disabled={!cart.length || !walletState || walletStatusError || !paymentChoice || busy || walletUncertain || (walletMode && paymentChoice!=="wallet") || (paymentChoice==="wallet" &&
              (!walletState || walletStatusError || walletUncertain || !walletState.clubEnabled ||
               !walletState.enabled || !walletConfirmed || (walletState.balanceCents??0)<total))}
            className="w-full bg-gradient-neon text-primary-foreground py-3 rounded-xl font-display font-semibold uppercase tracking-[0.2em] text-xs glow-neon disabled:opacity-50"
          >
            {busy ? "Guardando…" : "Confirmar pedido"}
          </button>
        </div>
      </div>
    </SnoopLayout>
  );
}
