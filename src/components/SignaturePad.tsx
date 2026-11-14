import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Eraser } from "lucide-react";

export type SignaturePadHandle = {
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
};

export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number }>(function SignaturePad({ height = 200 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<number | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const setup = (ctx: CanvasRenderingContext2D, ratio: number) => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
    };
    const resize = () => {
      const width = Math.max(1, Math.round(canvas.getBoundingClientRect().width));
      const cssHeight = Math.max(1, Math.round(canvas.getBoundingClientRect().height));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.round(width * ratio);
      const nextHeight = Math.round(cssHeight * ratio);
      // iOS Safari fires resize while opening the keyboard or changing browser chrome.
      // Reassigning canvas.width/height erases a signature, even when they did not change.
      if (canvas.width === nextWidth && canvas.height === nextHeight) return;
      const backup = document.createElement("canvas");
      backup.width = canvas.width;
      backup.height = canvas.height;
      if (hasInk.current && backup.width && backup.height) {
        backup.getContext("2d")?.drawImage(canvas, 0, 0);
      }
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      setup(ctx, ratio);
      if (hasInk.current && backup.width && backup.height) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(backup, 0, 0, backup.width, backup.height, 0, 0, nextWidth, nextHeight);
        ctx.restore();
      }
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  function pos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some Safari versions cannot capture a pointer during touch startup.
    }
    drawing.current = e.pointerId;
    const p = pos(e);
    last.current = p;
    // A tap is still a mark, and its pixels must be preserved on resize.
    const ctx = e.currentTarget.getContext("2d");
    if (ctx) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.25, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      hasInk.current = true;
      setEmpty(false);
    }
  }
  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== e.pointerId || !last.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    hasInk.current = true;
    setEmpty(false);
  }
  function up(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawing.current !== e.pointerId) return;
    drawing.current = null;
    last.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
  }

  function clear() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    drawing.current = null;
    last.current = null;
    hasInk.current = false;
    setEmpty(true);
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasInk.current,
    clear,
    toBlob: () => new Promise<Blob | null>((resolve) => {
      const c = canvasRef.current;
      if (!c || !hasInk.current || c.width === 0 || c.height === 0) return resolve(null);
      const out = document.createElement("canvas");
      out.width = c.width; out.height = c.height;
      const ctx = out.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(c, 0, 0);
      out.toBlob(resolve, "image/png");
    }),
  }));

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        aria-label="Firma del socio"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ height, touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
        className="block w-full rounded-lg bg-input border border-neon/30 cursor-crosshair"
      />
      <button
        type="button"
        onClick={clear}
        className="absolute top-2 right-2 flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-neon bg-card/80 backdrop-blur px-2 py-1 rounded-md border border-border"
      >
        <Eraser className="w-3 h-3" /> Borrar
      </button>
      {empty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground text-xs uppercase tracking-[0.25em]">
          Firma aquí con el dedo
        </div>
      )}
    </div>
  );
});
