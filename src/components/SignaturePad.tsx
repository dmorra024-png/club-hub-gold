import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Eraser } from "lucide-react";

export type SignaturePadHandle = {
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
};

export const SignaturePad = forwardRef<SignaturePadHandle, { height?: number }>(function SignaturePad({ height = 200 }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function pos(e: React.PointerEvent) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    setEmpty(false);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !last.current) return;
    const p = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    setEmpty(true);
  }

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear,
    toBlob: () => new Promise<Blob | null>((resolve) => {
      const c = canvasRef.current;
      if (!c) return resolve(null);
      // Composite on dark bg for legibility
      const out = document.createElement("canvas");
      out.width = c.width; out.height = c.height;
      const ctx = out.getContext("2d")!;
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
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
        style={{ height, touchAction: "none" }}
        className="w-full rounded-lg bg-input border border-neon/30 cursor-crosshair"
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
