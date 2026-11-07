import { useId } from "react";
import type { ReceiptPoint } from "@/lib/membership-timeline";
export function MembershipSparkline({ points }: { points: ReceiptPoint[] }) {
  const id = useId().replace(/:/g, "");
  if (points.length < 4) return null;
  const first = points[0],
    last = points[points.length - 1];
  if (last.at <= first.at || last.cents <= 0) return null;
  const xy = points.map((p) => ({
    x: 8 + ((p.at - first.at) / (last.at - first.at)) * 176,
    y: 100 - (p.cents / last.cents) * 84,
  }));
  const path = xy.slice(1).reduce((d, p, i) => {
    const before = xy[i],
      mid = (before.x + p.x) / 2;
    return d + `C${mid} ${before.y} ${mid} ${p.y} ${p.x} ${p.y}`;
  }, `M${xy[0].x} ${xy[0].y}`);
  return (
    <figure className="premium-membership-chart">
      <svg
        viewBox="0 0 200 112"
        role="img"
        aria-label="Evolución real de las cuotas asociativas de hoy"
      >
        <title>Cuotas asociativas: importe acumulado de los registros de hoy, no de ventas.</title>
        <defs>
          <linearGradient id={`${id}-gold`}>
            <stop stopColor="#ad7f29" stopOpacity="0" />
            <stop offset=".3" stopColor="#e0b94e" />
            <stop offset="1" stopColor="#fff0ad" />
          </linearGradient>
          <filter id={`${id}-glow`} x="-30%" y="-40%" width="160%" height="180%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <path
          d={path}
          fill="none"
          stroke="#ffd781"
          strokeWidth="3.5"
          opacity=".32"
          filter={`url(#${id}-glow)`}
        />
        <path d={path} fill="none" stroke={`url(#${id}-gold)`} strokeWidth="1.3" />
        <circle
          cx={xy[xy.length - 1].x}
          cy={xy[xy.length - 1].y}
          r="5"
          fill="#ffcd6c"
          filter={`url(#${id}-glow)`}
        />
        <circle cx={xy[xy.length - 1].x} cy={xy[xy.length - 1].y} r="3" fill="#fff2bc" />
      </svg>
      <figcaption>
        Cuotas:{" "}
        {new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
          last.cents / 100,
        )}
      </figcaption>
    </figure>
  );
}
